import { ALLOWED_EXTENSIONS, contentMatchesExtension, extensionOf, type DocumentRecord, type DocumentStatus } from '../../../shared/documents.ts';
import { makeTextPdf } from '../../../shared/samplePdf.ts';
import { zip as zipFiles } from 'fflate';
import { UPLOAD_CHUNK_BYTES } from './config.ts';
import { sha256Hex, type DocumentService, type DownloadProgress, type UploadCallbacks, type UploadHandle } from './DocumentService.ts';
import { transferStats } from './transferStats.ts';

/**
 * Browser-only mode (no document server configured, e.g. on a static deployment): files are
 * stored in this browser's IndexedDB in chunks. Uploads can be paused and resumed, and resume
 * after a refresh when the same file is added again — but nothing leaves the browser, so this is
 * NOT server-side resumability. Processing uses the same lifecycle with simulated steps.
 */
const DB_NAME = 'courtscribe-documents';

interface PendingUpload {
  key: string; // name + size + lastModified
  docId: string;
  offset: number;
  chunkSize: number;
  chunks: number;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class BrowserDocumentService implements DocumentService {
  readonly mode = 'browser' as const;
  private db: Promise<IDBDatabase> | null = null;
  private processing = new Set<string>();
  private seeding: Promise<void> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('docs', { keyPath: 'id' });
        db.createObjectStore('chunks', { keyPath: ['docId', 'index'] }).createIndex('byDoc', 'docId');
        db.createObjectStore('pending', { keyPath: 'key' });
        db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async put(doc: DocumentRecord): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('docs', 'readwrite');
    tx.objectStore('docs').put(doc);
    await done(tx);
  }

  async list(): Promise<DocumentRecord[]> {
    const db = await this.open();
    this.seeding ??= this.seedSamples(db);
    await this.seeding;
    const docs = (await request(db.transaction('docs').objectStore('docs').getAll())) as DocumentRecord[];
    // Processing interrupted by a reload: pick it up again.
    for (const d of docs) if (!['available', 'failed'].includes(d.status) && !this.processing.has(d.id)) void this.process(d);
    return docs.sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  async remove(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['docs', 'chunks'], 'readwrite');
    tx.objectStore('docs').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    await done(tx);
  }

  async reprocess(id: string): Promise<void> {
    const db = await this.open();
    const doc = (await request(db.transaction('docs').objectStore('docs').get(id))) as DocumentRecord | undefined;
    if (doc) void this.process(doc);
  }

  startUpload(file: File, sha256: string, cb: UploadCallbacks): UploadHandle {
    let paused = false;
    let cancelled = false;
    let running = false;
    const key = `${file.name}|${file.size}|${file.lastModified}`;
    const run = async () => {
      if (running) return;
      running = true;
      transferStats.activeUploads++;
      try {
        const db = await this.open();
        let pending = (await request(db.transaction('pending').objectStore('pending').get(key))) as PendingUpload | undefined;
        if (pending && pending.offset > 0) cb.onResumed?.(pending.offset);
        pending ??= { key, docId: crypto.randomUUID(), offset: 0, chunkSize: UPLOAD_CHUNK_BYTES, chunks: 0 };
        while (pending.offset < file.size) {
          if (paused || cancelled) return;
          const end = Math.min(file.size, pending.offset + pending.chunkSize);
          const chunk = file.slice(pending.offset, end);
          const tx = db.transaction(['chunks', 'pending'], 'readwrite');
          tx.objectStore('chunks').put({ docId: pending.docId, index: pending.chunks, data: chunk });
          const next: PendingUpload = { ...pending, offset: end, chunks: pending.chunks + 1 };
          tx.objectStore('pending').put(next);
          await done(tx); // the offset only advances once the chunk is stored
          transferStats.uploadProgress(end - pending.offset);
          pending = next;
          cb.onProgress(pending.offset, file.size);
        }
        // Verify what was stored matches the original before registering it.
        const stored = await this.assemble(pending.docId, file.type);
        if ((await sha256Hex(stored)) !== sha256) {
          await this.dropUpload(db, pending);
          cb.onError('Integrity check failed: the stored copy does not match the original. Please add the file again.', false);
          return;
        }
        const ext = extensionOf(file.name);
        const now = Date.now();
        const doc: DocumentRecord = {
          id: pending.docId, name: file.name, extension: ext, mimeType: ALLOWED_EXTENSIONS[ext] ?? (file.type || 'application/octet-stream'), size: file.size, sha256,
          uploadedAt: now, modifiedAt: now, status: 'uploaded', history: [{ status: 'uploaded', at: now, note: 'Stored in this browser only. SHA-256 verified.' }],
        };
        const tx = db.transaction(['docs', 'pending'], 'readwrite');
        tx.objectStore('docs').put(doc);
        tx.objectStore('pending').delete(key);
        await done(tx);
        cb.onSuccess();
        void this.process(doc);
      } catch (err) {
        const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
        cb.onError(quota ? 'This browser has run out of storage space for documents. Delete some documents and retry.' : `The file could not be stored in this browser (${err instanceof Error ? err.message : String(err)}).`, true);
      } finally {
        running = false;
        transferStats.activeUploads--;
      }
    };
    void run();
    return {
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
        void run();
      },
      cancel: async () => {
        cancelled = true;
        const db = await this.open();
        const pending = (await request(db.transaction('pending').objectStore('pending').get(key))) as PendingUpload | undefined;
        if (pending) await this.dropUpload(db, pending);
      },
    };
  }

  private async dropUpload(db: IDBDatabase, pending: PendingUpload): Promise<void> {
    const tx = db.transaction(['chunks', 'pending'], 'readwrite');
    tx.objectStore('chunks').delete(IDBKeyRange.bound([pending.docId, 0], [pending.docId, Number.MAX_SAFE_INTEGER]));
    tx.objectStore('pending').delete(pending.key);
    await done(tx);
  }

  private async assemble(docId: string, type: string): Promise<Blob> {
    const db = await this.open();
    const rows = (await request(db.transaction('chunks').objectStore('chunks').index('byDoc').getAll(docId))) as { index: number; data: Blob }[];
    rows.sort((a, b) => a.index - b.index);
    return new Blob(rows.map((r) => r.data), { type });
  }

  async download(doc: DocumentRecord, onProgress: (p: DownloadProgress) => void): Promise<Blob> {
    const blob = await this.assemble(doc.id, doc.mimeType);
    onProgress({ received: blob.size, total: blob.size, resumes: 0 });
    if ((await sha256Hex(blob)) !== doc.sha256) throw new Error('The stored copy did not pass the integrity check.');
    return blob;
  }

  async previewUrl(doc: DocumentRecord) {
    const url = URL.createObjectURL(await this.assemble(doc.id, doc.mimeType));
    return { url, release: () => URL.revokeObjectURL(url) };
  }

  async zip(ids: string[], onProgress: (received: number) => void): Promise<Blob> {
    const db = await this.open();
    const files: Record<string, Uint8Array> = {};
    for (const id of ids) {
      const doc = (await request(db.transaction('docs').objectStore('docs').get(id))) as DocumentRecord | undefined;
      if (!doc) continue;
      let name = doc.name;
      for (let n = 2; files[name]; n++) name = doc.name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      files[name] = new Uint8Array(await (await this.assemble(id, doc.mimeType)).arrayBuffer());
    }
    const out = await new Promise<Uint8Array>((resolve, reject) => zipFiles(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(data))));
    onProgress(out.length);
    return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
  }

  /** Real validation (contents vs extension), then simulated processing steps. */
  private async process(doc: DocumentRecord): Promise<void> {
    if (this.processing.has(doc.id)) return;
    this.processing.add(doc.id);
    const step = async (status: DocumentStatus, note?: string, ms = 600) => {
      doc.status = status;
      doc.modifiedAt = Date.now();
      doc.history = [...doc.history, { status, at: Date.now(), ...(note ? { note } : {}) }];
      await this.put(doc);
      await sleep(ms);
    };
    try {
      doc.error = undefined;
      await step('validating');
      const head = new Uint8Array(await (await this.assemble(doc.id, doc.mimeType)).slice(0, 16).arrayBuffer());
      if (!contentMatchesExtension(doc.extension, head)) {
        doc.error = `The file’s contents do not match its .${doc.extension} extension. It may be damaged or renamed. Upload the original file.`;
        await step('failed', doc.error, 0);
        return;
      }
      await step('processing', 'Simulated step — no document-processing service in browser-only mode.', 700);
      await step('extracting', doc.extension === 'pdf' ? 'Simulated here; the viewer reads the PDF’s own text. Scanned pages would need OCR (not available).' : 'Simulated step.', 900);
      await step('indexing', 'Simulated step — no search index in this prototype.');
      await step('available', undefined, 0);
    } finally {
      this.processing.delete(doc.id);
    }
  }

  private async seedSamples(db: IDBDatabase): Promise<void> {
    const seeded = await request(db.transaction('meta').objectStore('meta').get('samples'));
    if (seeded) return;
    const samples: { name: string; data: Uint8Array }[] = [
      {
        name: 'SAMPLE — Witness statement of PW-1.pdf',
        data: makeTextPdf([
          ['SAMPLE DOCUMENT — not a real case', 'Case: CR/2026/00421 (synthetic)', 'Statement of PW-1', '', 'I live in Kakkanad. On the evening of the incident I was at home.', 'At about 8 pm I heard a loud sound and went outside.', 'I identified Exhibit P3 as the document shown to me by the police.'],
          ['SAMPLE DOCUMENT — page 2', 'Cross-examination', '', 'Q: Was the street lit at that time?', 'A: Yes, the street light was working.', 'Q: Who informed the police?', 'A: My neighbour called the police.'],
        ]),
      },
      { name: 'SAMPLE — Hearing notes.txt', data: new TextEncoder().encode('SAMPLE DOCUMENT — not a real case\n\nHearing notes, CR/2026/00421 (synthetic)\n\n- PW-1 examined in chief.\n- Exhibit P3 marked.\n') },
    ];
    const now = Date.now();
    // Hash first: awaiting anything but IndexedDB inside a transaction would let it auto-commit.
    const hashes = await Promise.all(samples.map((x) => sha256Hex(x.data.slice().buffer as ArrayBuffer)));
    const tx = db.transaction(['docs', 'chunks', 'meta'], 'readwrite');
    for (const [i, s] of samples.entries()) {
      const id = crypto.randomUUID();
      const ext = extensionOf(s.name);
      tx.objectStore('chunks').put({ docId: id, index: 0, data: new Blob([s.data as Uint8Array<ArrayBuffer>]) });
      tx.objectStore('docs').put({
        id, name: s.name, extension: ext, mimeType: ALLOWED_EXTENSIONS[ext]!, size: s.data.length, sha256: hashes[i]!,
        uploadedAt: now, modifiedAt: now, status: 'available', history: [{ status: 'available', at: now, note: 'Sample document bundled with the demo.' }], sample: true,
      } satisfies DocumentRecord);
    }
    tx.objectStore('meta').put(true, 'samples');
    await done(tx);
  }
}
