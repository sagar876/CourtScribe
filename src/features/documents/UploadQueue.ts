import { validateUpload } from '../../../shared/documents.ts';
import { MAX_UPLOAD_BYTES } from './config.ts';
import { sha256Hex, type DocumentService, type UploadHandle } from './DocumentService.ts';
import type { DocumentLibrary } from './DocumentLibrary.ts';

export type UploadStatus = 'queued' | 'checking' | 'duplicate' | 'uploading' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'rejected';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  type: string;
  status: UploadStatus;
  sent: number;
  error?: string;
  /** Bytes already on the server/in storage from an earlier, interrupted attempt. */
  resumedFrom?: number;
  duplicateOf?: string;
}

const CONCURRENCY = 2;
const ACTIVE: UploadStatus[] = ['queued', 'checking', 'uploading', 'paused', 'duplicate'];

/** Upload queue: validation, duplicate detection, concurrency, pause/resume/cancel/retry. */
export class UploadQueue {
  private items: UploadItem[] = [];
  private files = new Map<string, File>();
  private hashes = new Map<string, string>();
  private handles = new Map<string, UploadHandle>();
  private listeners = new Set<() => void>();
  private snapshot: readonly UploadItem[] = [];

  constructor(
    private readonly service: DocumentService,
    private readonly library: DocumentLibrary,
  ) {
    if (typeof window !== 'undefined')
      window.addEventListener('beforeunload', (e) => {
        if (!this.items.some((i) => i.status === 'uploading' || i.status === 'checking')) return;
        e.preventDefault();
        e.returnValue = '';
      });
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = () => this.snapshot;

  add(files: Iterable<File>): void {
    for (const file of files) {
      const id = crypto.randomUUID();
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      const problem = validateUpload(file.name, file.size, MAX_UPLOAD_BYTES);
      const already = this.items.find((i) => `${i.name}|${i.size}|${this.files.get(i.id)?.lastModified}` === key && ACTIVE.includes(i.status));
      const item: UploadItem = { id, name: file.name, size: file.size, type: file.type, status: 'queued', sent: 0 };
      if (problem) Object.assign(item, { status: 'rejected', error: problem });
      else if (already) Object.assign(item, { status: 'rejected', error: `“${file.name}” is already in the upload list.` });
      else this.files.set(id, file);
      this.items = [...this.items, item];
    }
    this.publish();
    this.pump();
  }

  pause(id: string): void {
    const h = this.handles.get(id);
    if (!h || this.item(id)?.status !== 'uploading') return;
    h.pause();
    this.update(id, { status: 'paused' });
    this.pump();
  }

  resume(id: string): void {
    const h = this.handles.get(id);
    if (!h || this.item(id)?.status !== 'paused') return;
    if (this.activeCount() >= CONCURRENCY) return this.update(id, { status: 'queued' });
    this.update(id, { status: 'uploading' });
    h.resume();
  }

  async cancel(id: string): Promise<void> {
    const h = this.handles.get(id);
    this.update(id, { status: 'cancelled' });
    this.handles.delete(id);
    this.files.delete(id);
    await h?.cancel();
    this.pump();
  }

  retry(id: string): void {
    const item = this.item(id);
    if (!item || item.status !== 'failed') return;
    this.update(id, { status: 'queued', error: undefined });
    this.pump();
  }

  /** The user confirmed a file that matches an existing document should be uploaded anyway. */
  uploadAnyway(id: string): void {
    if (this.item(id)?.status !== 'duplicate') return;
    this.update(id, { status: 'queued', duplicateOf: undefined, error: undefined });
    this.hashes.set(`${id}:confirmed`, '1');
    this.pump();
  }

  clearFinished(): void {
    this.items = this.items.filter((i) => ACTIVE.includes(i.status) || i.status === 'failed');
    this.publish();
  }

  // ---------- internals ----------

  private item(id: string) {
    return this.items.find((i) => i.id === id);
  }

  private activeCount() {
    return this.items.filter((i) => i.status === 'uploading' || i.status === 'checking').length;
  }

  private pump(): void {
    while (this.activeCount() < CONCURRENCY) {
      const next = this.items.find((i) => i.status === 'queued');
      if (!next) return;
      const paused = this.handles.get(next.id);
      if (paused) {
        this.update(next.id, { status: 'uploading' });
        paused.resume();
        continue;
      }
      void this.start(next.id);
    }
  }

  private async start(id: string): Promise<void> {
    const file = this.files.get(id);
    if (!file) return;
    this.update(id, { status: 'checking' });
    let sha = this.hashes.get(id);
    if (!sha) {
      try {
        sha = await sha256Hex(file);
      } catch {
        this.update(id, { status: 'failed', error: 'The file could not be read. Check it is still available and retry.' });
        return this.pump();
      }
      this.hashes.set(id, sha);
    }
    if (this.item(id)?.status !== 'checking') return; // cancelled meanwhile
    const existing = this.library.getSnapshot().documents.find((d) => d.sha256 === sha);
    if (existing && !this.hashes.has(`${id}:confirmed`)) {
      this.update(id, { status: 'duplicate', duplicateOf: existing.name });
      return this.pump();
    }
    this.update(id, { status: 'uploading' });
    const handle = this.service.startUpload(file, sha, {
      onProgress: (sent) => this.update(id, { sent }),
      onResumed: (from) => this.update(id, { resumedFrom: from, sent: from }),
      onSuccess: () => {
        this.handles.delete(id);
        this.update(id, { status: 'completed', sent: file.size });
        void this.library.refresh();
        this.pump();
      },
      onError: (message, retryable) => {
        if (this.item(id)?.status === 'cancelled') return;
        this.handles.delete(id);
        this.update(id, { status: retryable ? 'failed' : 'rejected', error: message });
        this.pump();
      },
    });
    this.handles.set(id, handle);
  }

  private update(id: string, patch: Partial<UploadItem>): void {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    this.publish();
  }

  private publish(): void {
    this.snapshot = this.items;
    for (const l of this.listeners) l();
  }
}
