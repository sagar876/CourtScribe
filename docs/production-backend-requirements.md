# Document workspace — what production needs

The prototype's document server (`server/documents.ts`) is for local development and demos. It is
**not** production-ready. This lists what exists today and what a production deployment requires.

## Implemented in the prototype

| Area | Status |
| --- | --- |
| Resumable uploads | tus protocol (`@tus/server`), configurable chunk size, retry with backoff, resume after refresh via stored fingerprint |
| Upload validation | Allowed extensions, size limit (client and server), contents checked against the extension (magic bytes) |
| Integrity | SHA-256 computed in the browser, verified by the server after upload; downloads verified against `X-Content-SHA256` |
| Resumable downloads | HTTP `Range` / `If-Range`, `ETag`, original filename via `Content-Disposition` |
| Bulk download | Streamed ZIP of selected documents |
| Processing lifecycle | Validation is real. Processing, text extraction and indexing are **simulated** and labelled as such |
| Editor | Tiptap rich text, Yjs CRDT sync over WebSocket, local recovery (IndexedDB), version history and restore |
| Caching | API and file responses are `no-store`; the service worker never touches the document server |
| Browser-only mode | When no server is configured (e.g. Vercel): IndexedDB storage, cross-tab editing — clearly labelled in the UI |

## Not implemented — required for production

- **Authentication** — every request must be tied to a signed-in user (court SSO / OIDC). Today anyone who can reach the server can read, upload and delete.
- **Authorisation (RBAC)** — per-case access (judge, clerk, counsel, public) on documents, notes, versions and collaboration rooms. Collaboration rooms must check access on WebSocket upgrade.
- **Real identities in the editor** — presence currently shows unauthenticated "Guest" names per browser tab.
- **Encryption** — TLS everywhere (`https://` / `wss://`); encryption at rest for stored files and editor documents, with managed keys.
- **Malware scanning** — scan every upload (e.g. ClamAV or a cloud scanner) before it becomes `available`; quarantine on detection.
- **Real processing** — PDF text extraction, OCR for scanned PDFs and images, DOC/DOCX conversion, and a search index.
- **Audit log** — append-only record of who viewed, downloaded, uploaded, edited, restored or deleted what, and when.
- **Secure download URLs** — short-lived signed URLs or authenticated streaming; no public document URLs.
- **Retention and legal hold** — retention schedules per record type, legal hold, soft delete with recovery window, verified destruction.
- **Session expiry** — idle and absolute session timeouts; re-authentication for destructive actions.
- **Storage** — object storage (S3-compatible) instead of the local `.data` folder; tus upload expiry and cleanup on that store; a database instead of JSON files.
- **Scale and limits** — rate limiting, per-user quotas, horizontal scaling of the Yjs server (shared persistence / pub-sub).
- **Backups and monitoring** — backups with restore drills; error and performance monitoring that never logs document contents.
