/** Case documents: shared by the document server and the browser. */

export type DocumentStatus = 'uploaded' | 'validating' | 'processing' | 'extracting' | 'indexing' | 'available' | 'failed';

export const STATUS_ORDER: DocumentStatus[] = ['uploaded', 'validating', 'processing', 'extracting', 'indexing', 'available'];

export const STATUS_INFO: Record<DocumentStatus, { label: string; description: string }> = {
  uploaded: { label: 'Uploaded', description: 'The file has been received in full.' },
  validating: { label: 'Validating', description: 'Checking the file type, size and that its contents match its extension.' },
  processing: { label: 'Processing', description: 'Preparing the document for use.' },
  extracting: { label: 'Extracting text', description: 'Reading the text (scanned pages would need OCR — not available in this prototype).' },
  indexing: { label: 'Indexing', description: 'Making the document searchable.' },
  available: { label: 'Available', description: 'Ready to open, preview and download.' },
  failed: { label: 'Needs attention', description: 'Processing stopped. See the reason and retry.' },
};

export interface StatusEvent {
  status: DocumentStatus;
  at: number;
  note?: string;
}

export interface DocumentRecord {
  id: string;
  name: string;
  mimeType: string;
  extension: string;
  size: number;
  /** Hex SHA-256 of the stored file (integrity). */
  sha256: string;
  uploadedAt: number;
  modifiedAt: number;
  status: DocumentStatus;
  history: StatusEvent[];
  error?: string;
  /** Bundled sample data, not a real case document. */
  sample?: boolean;
}

export const ALLOWED_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
};

export const DEFAULT_MAX_FILE_BYTES = 250 * 1024 * 1024;

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1]!.toLowerCase() : '';
}

/** Validation shared by client (early feedback) and server (authoritative). */
export function validateUpload(name: string, size: number, maxBytes = DEFAULT_MAX_FILE_BYTES): string | null {
  const ext = extensionOf(name);
  if (!ALLOWED_EXTENSIONS[ext]) return `“${name}” is not a supported file type. Use PDF, Word (DOC/DOCX), text (TXT) or an image (PNG, JPG, GIF, WEBP, TIFF).`;
  if (size <= 0) return `“${name}” is empty.`;
  if (size > maxBytes) return `“${name}” is ${(size / 1048576).toFixed(0)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB.`;
  return null;
}

/** Checks the first bytes match the claimed type, so a renamed file cannot pose as another format. */
export function contentMatchesExtension(ext: string, head: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => head[i] === b);
  switch (ext) {
    case 'pdf':
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case 'png':
      return starts(0x89, 0x50, 0x4e, 0x47);
    case 'jpg':
    case 'jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'gif':
      return starts(0x47, 0x49, 0x46);
    case 'webp':
      return starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57 && head[9] === 0x45;
    case 'tif':
    case 'tiff':
      return starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a);
    case 'docx':
      return starts(0x50, 0x4b, 0x03, 0x04); // ZIP container
    case 'doc':
      return starts(0xd0, 0xcf, 0x11, 0xe0); // OLE compound file
    case 'txt':
      return !head.includes(0x00); // plain text has no NUL bytes
    default:
      return false;
  }
}

/** Editor documents (rich-text notes; separate from uploaded files). */
export interface NoteRecord {
  id: string;
  title: string;
  createdAt: number;
  modifiedAt: number;
}

export interface NoteVersion {
  id: string;
  noteId: string;
  createdAt: number;
  /** "manual" when the user saved a version, "auto" for periodic snapshots, "before-restore" safety copies. */
  kind: 'manual' | 'auto' | 'before-restore';
  title: string;
  /** Tiptap JSON. */
  content: unknown;
}

export const DOC_SERVER_PORT = 8788;
