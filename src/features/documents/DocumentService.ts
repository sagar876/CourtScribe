import type { DocumentRecord } from '../../../shared/documents.ts';

export interface UploadCallbacks {
  onProgress: (sentBytes: number, totalBytes: number) => void;
  onSuccess: () => void;
  /** retryable=false for problems the user must fix (type, size, integrity). */
  onError: (message: string, retryable: boolean) => void;
  /** Called once when an earlier, interrupted upload of this file is continued. */
  onResumed?: (fromBytes: number) => void;
}

export interface UploadHandle {
  pause(): void;
  resume(): void;
  /** Stops and discards the partial upload. */
  cancel(): Promise<void>;
}

export interface DownloadProgress {
  received: number;
  total: number;
  /** Times the transfer was interrupted and continued from where it stopped. */
  resumes: number;
}

/**
 * Where documents live. Two implementations:
 *  - ServerDocumentService: the document server (tus resumable uploads, Range downloads).
 *  - BrowserDocumentService: this browser only (IndexedDB), used when no server is configured.
 */
export interface DocumentService {
  readonly mode: 'server' | 'browser';
  list(): Promise<DocumentRecord[]>;
  remove(id: string): Promise<void>;
  reprocess(id: string): Promise<void>;
  startUpload(file: File, sha256: string, callbacks: UploadCallbacks): UploadHandle;
  /** Original bytes, verified against the stored SHA-256. */
  download(doc: DocumentRecord, onProgress: (p: DownloadProgress) => void, signal: AbortSignal): Promise<Blob>;
  /** A URL the browser can open for preview (server URL or object URL). Call the returned release when done. */
  previewUrl(doc: DocumentRecord): Promise<{ url: string; release: () => void }>;
  zip(ids: string[], onProgress: (received: number) => void, signal: AbortSignal): Promise<Blob>;
}

export async function sha256Hex(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Saves a Blob under its original filename via a temporary object URL (revoked right after). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
