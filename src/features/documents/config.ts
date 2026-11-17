import { DOC_SERVER_PORT } from '../../../shared/documents.ts';

const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');
const configured = import.meta.env.VITE_DOC_SERVER_URL;

/**
 * Document server base URL. On localhost the local server is used; a deployment without
 * VITE_DOC_SERVER_URL (or with it set to "browser") runs in browser-only mode.
 */
export const DOC_SERVER_URL: string | null = configured === 'browser' ? null : (configured?.replace(/\/$/, '') ?? (isLocalHost ? `http://${location.hostname}:${DOC_SERVER_PORT}` : null));

/** Upload chunk size in bytes (VITE_UPLOAD_CHUNK_MB, default 5 MB). */
export const UPLOAD_CHUNK_BYTES = Math.max(256 * 1024, (Number(import.meta.env.VITE_UPLOAD_CHUNK_MB) || 5) * 1024 * 1024);

/** Client-side limit for early feedback; the server enforces its own (VITE_MAX_UPLOAD_MB, default 250). */
export const MAX_UPLOAD_BYTES = (Number(import.meta.env.VITE_MAX_UPLOAD_MB) || 250) * 1024 * 1024;
