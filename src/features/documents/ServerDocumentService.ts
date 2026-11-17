import * as tus from 'tus-js-client';
import type { DocumentRecord } from '../../../shared/documents.ts';
import { UPLOAD_CHUNK_BYTES } from './config.ts';
import { sha256Hex, type DocumentService, type DownloadProgress, type UploadCallbacks, type UploadHandle } from './DocumentService.ts';
import { transferStats } from './transferStats.ts';

const RETRY_DELAYS = [0, 1_000, 3_000, 5_000, 10_000, 20_000];
const MAX_DOWNLOAD_RESUMES = 6;

async function failure(res: Response): Promise<Error> {
  let message = `The document server returned ${res.status}.`;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    /* not JSON */
  }
  return new Error(message);
}

/** Documents on the CourtScribe document server. Uploads use the tus resumable-upload protocol. */
export class ServerDocumentService implements DocumentService {
  readonly mode = 'server' as const;
  constructor(private readonly base: string) {}

  async list(): Promise<DocumentRecord[]> {
    const res = await fetch(`${this.base}/api/documents`, { cache: 'no-store' });
    if (!res.ok) throw await failure(res);
    return (await res.json()) as DocumentRecord[];
  }

  async remove(id: string): Promise<void> {
    const res = await fetch(`${this.base}/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw await failure(res);
  }

  async reprocess(id: string): Promise<void> {
    const res = await fetch(`${this.base}/api/documents/${encodeURIComponent(id)}/reprocess`, { method: 'POST' });
    if (!res.ok) throw await failure(res);
  }

  startUpload(file: File, sha256: string, cb: UploadCallbacks): UploadHandle {
    let lastSent = 0;
    let resumedReported = false;
    let active = false;
    const setActive = (on: boolean) => {
      if (on === active) return;
      active = on;
      transferStats.activeUploads += on ? 1 : -1;
    };
    const upload = new tus.Upload(file, {
      endpoint: `${this.base}/files`,
      chunkSize: UPLOAD_CHUNK_BYTES,
      retryDelays: RETRY_DELAYS,
      metadata: { filename: file.name, filetype: file.type || 'application/octet-stream', sha256 },
      // Lets a refreshed page find this upload again and continue from the server's offset.
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      onProgress: (sent, total) => {
        transferStats.uploadProgress(Math.max(0, sent - lastSent));
        lastSent = sent;
        cb.onProgress(sent, total);
      },
      onSuccess: () => {
        setActive(false);
        cb.onSuccess();
      },
      onError: (err) => {
        setActive(false);
        const res = (err as tus.DetailedError).originalResponse;
        const status = res?.getStatus() ?? 0;
        const body = res?.getBody() ?? '';
        if (status === 400 || status === 413 || status === 422) cb.onError(body || 'The server refused this file.', status !== 400 && status !== 413);
        else if (!navigator.onLine) cb.onError('The connection was lost. The upload will continue from where it stopped when you retry.', true);
        else cb.onError(status ? `The upload failed (server returned ${status}). Retry to continue from where it stopped.` : 'The document server could not be reached. Retry to continue from where it stopped.', true);
      },
    });
    const begin = () => {
      setActive(true);
      void upload.findPreviousUploads().then((previous) => {
        const prev = previous[0];
        if (prev && !resumedReported) {
          upload.resumeFromPreviousUpload(prev);
          resumedReported = true;
          void fetch(prev.uploadUrl!, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } })
            .then((r) => Number(r.headers.get('Upload-Offset') ?? 0))
            .then((offset) => {
              if (offset > 0) {
                lastSent = offset;
                cb.onResumed?.(offset);
              }
            })
            .catch(() => {});
        }
        upload.start();
      });
    };
    begin();
    return {
      pause: () => {
        setActive(false);
        void upload.abort(false); // keeps the server-side upload so it can be resumed
      },
      resume: () => {
        setActive(true);
        upload.start();
      },
      cancel: async () => {
        setActive(false);
        await upload.abort(true).catch(() => {}); // terminates the server-side upload
      },
    };
  }

  /**
   * Streams the original file with progress. If the connection drops, continues with an HTTP Range
   * request from the last received byte (If-Range guards against the file having changed), then
   * verifies the SHA-256 the server reported.
   */
  async download(doc: DocumentRecord, onProgress: (p: DownloadProgress) => void, signal: AbortSignal): Promise<Blob> {
    const url = `${this.base}/api/documents/${encodeURIComponent(doc.id)}/content`;
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    let total = doc.size;
    let etag: string | null = null;
    let expected: string | null = null;
    let resumes = 0;
    transferStats.activeDownloads++;
    transferStats.downloadTotal += doc.size;
    try {
      for (;;) {
        try {
          const headers: Record<string, string> = {};
          if (received > 0) {
            headers.Range = `bytes=${received}-`;
            if (etag) headers['If-Range'] = etag;
          }
          const res = await fetch(url, { headers, signal, cache: 'no-store' });
          if (res.status === 200 && received > 0) {
            // Server ignored the range (file changed or no Range support): start again cleanly.
            parts.length = 0;
            received = 0;
          } else if (!res.ok && res.status !== 206) throw Object.assign(await failure(res), { fatal: true });
          etag ??= res.headers.get('ETag');
          expected ??= res.headers.get('X-Content-SHA256');
          const length = Number(res.headers.get('Content-Length') ?? 0);
          if (res.status === 200) total = length || total;
          const reader = res.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value as Uint8Array<ArrayBuffer>);
            received += value.length;
            transferStats.downloadProgress(value.length);
            onProgress({ received, total, resumes });
          }
          if (received >= total) break;
          throw new Error('The connection closed early.');
        } catch (err) {
          if (signal.aborted) throw new DOMException('Download cancelled', 'AbortError');
          if ((err as { fatal?: boolean }).fatal || resumes >= MAX_DOWNLOAD_RESUMES) throw err;
          resumes++;
          await new Promise((r) => setTimeout(r, Math.min(8_000, 500 * 2 ** resumes)));
        }
      }
      const blob = new Blob(parts, { type: doc.mimeType });
      if (expected && (await sha256Hex(blob)) !== expected) throw new Error('The downloaded file did not pass the integrity check. Please try again.');
      return blob;
    } finally {
      transferStats.activeDownloads--;
      transferStats.downloadTotal -= doc.size;
    }
  }

  async previewUrl(doc: DocumentRecord) {
    return { url: `${this.base}/api/documents/${encodeURIComponent(doc.id)}/content?inline=1`, release: () => {} };
  }

  async zip(ids: string[], onProgress: (received: number) => void, signal: AbortSignal): Promise<Blob> {
    const res = await fetch(`${this.base}/api/documents/zip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }), signal });
    if (!res.ok) throw await failure(res);
    const reader = res.body!.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value as Uint8Array<ArrayBuffer>);
      received += value.length;
      onProgress(received);
    }
    return new Blob(parts, { type: 'application/zip' });
  }
}
