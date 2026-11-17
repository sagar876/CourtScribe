/**
 * CourtScribe document server (local development / demo).
 *
 *  - Resumable uploads: the tus protocol (@tus/server + FileStore). Offsets are tracked by the
 *    server, so an interrupted upload continues from the last stored byte.
 *  - Validation on completion: allowed type, size limit, contents match the extension, and
 *    SHA-256 integrity against the hash computed in the browser.
 *  - Processing lifecycle: validation is real; processing, text extraction and indexing are a
 *    SIMULATED adapter (no OCR/indexing service exists here) and are labelled as such.
 *  - Downloads: HTTP Range requests (resumable), ETag, SHA-256 header, original filename.
 *  - ZIP bundles of selected documents (streamed).
 *  - Editor documents ("notes"), version history, and a Yjs collaboration endpoint.
 *
 * Not production: no authentication, authorisation, encryption at rest, malware scanning or audit
 * log. See docs/production-backend-requirements.md.
 */
import { randomUUID, createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { FileStore } from '@tus/file-store';
import { Server as TusServer } from '@tus/server';
import { Zip, ZipPassThrough } from 'fflate';
import { WebSocketServer } from 'ws';
import {
  ALLOWED_EXTENSIONS,
  contentMatchesExtension,
  DEFAULT_MAX_FILE_BYTES,
  DOC_SERVER_PORT,
  extensionOf,
  validateUpload,
  type DocumentRecord,
  type DocumentStatus,
  type NoteRecord,
  type NoteVersion,
} from '../shared/documents.ts';
import { makeTextPdf } from '../shared/samplePdf.ts';
import { CollabHub } from './collab.ts';

const PORT = Number(process.env.DOC_PORT) || DOC_SERVER_PORT;
const MAX_BYTES = Number(process.env.DOC_MAX_FILE_MB) > 0 ? Number(process.env.DOC_MAX_FILE_MB) * 1048576 : DEFAULT_MAX_FILE_BYTES;
const DATA = join(process.cwd(), '.data');
const DIRS = { tus: join(DATA, 'tus'), files: join(DATA, 'files'), versions: join(DATA, 'versions'), collab: join(DATA, 'collab') };
for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
const DOCS_FILE = join(DATA, 'documents.json');
const NOTES_FILE = join(DATA, 'notes.json');

const ALLOWED_ORIGINS = (process.env.DOC_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const originAllowed = (origin: string | undefined) => !origin || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) || ALLOWED_ORIGINS.includes(origin);

// ---------------- persistence (JSON files; a database in production) ----------------
const load = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};
const documents = new Map<string, DocumentRecord>(load<DocumentRecord[]>(DOCS_FILE, []).map((d) => [d.id, d]));
const notes = new Map<string, NoteRecord>(load<NoteRecord[]>(NOTES_FILE, []).map((n) => [n.id, n]));
const saveDocs = () => writeFileSync(DOCS_FILE, JSON.stringify([...documents.values()], null, 1));
const saveNotes = () => writeFileSync(NOTES_FILE, JSON.stringify([...notes.values()], null, 1));
const versionsFile = (noteId: string) => join(DIRS.versions, `${noteId.replace(/[^\w-]/g, '')}.json`);

// ---------------- processing lifecycle ----------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setStatus(doc: DocumentRecord, status: DocumentStatus, note?: string): void {
  doc.status = status;
  doc.modifiedAt = Date.now();
  doc.history.push({ status, at: Date.now(), ...(note ? { note } : {}) });
  saveDocs();
}

function readHead(path: string, bytes = 16): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return new Uint8Array(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
}

/** Real validation, then a simulated processing adapter (clearly labelled in the history). */
async function processDocument(doc: DocumentRecord): Promise<void> {
  const path = join(DIRS.files, doc.id);
  doc.error = undefined;
  setStatus(doc, 'validating');
  await sleep(500);
  if (!existsSync(path)) return fail(doc, 'The stored file is missing.');
  if (!contentMatchesExtension(doc.extension, readHead(path))) {
    return fail(doc, `The file’s contents do not match its .${doc.extension} extension. It may be damaged or renamed. Upload the original file.`);
  }
  setStatus(doc, 'processing', 'Simulated step — no document-processing service in this prototype.');
  await sleep(700);
  let extractNote: string;
  if (doc.extension === 'txt') extractNote = `${readFileSync(path, 'utf8').length.toLocaleString()} characters of text read.`;
  else if (doc.extension === 'pdf') {
    const pages = (readFileSync(path, 'latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    extractNote = `${pages || 'Unknown number of'} page${pages === 1 ? '' : 's'}. Text extraction simulated here; the in-app viewer reads the PDF’s own text. Scanned pages would need OCR (not available).`;
  } else if (doc.extension.startsWith('doc')) extractNote = 'Simulated — Word documents are stored and downloadable; text extraction would need a conversion service.';
  else extractNote = 'Image — OCR would be needed for searchable text (not available in this prototype).';
  setStatus(doc, 'extracting', extractNote);
  await sleep(900);
  setStatus(doc, 'indexing', 'Simulated step — no search index in this prototype.');
  await sleep(600);
  setStatus(doc, 'available');
}

function fail(doc: DocumentRecord, reason: string): void {
  doc.error = reason;
  setStatus(doc, 'failed', reason);
}

// ---------------- samples (clearly labelled) ----------------
function seedSamples(): void {
  if ([...documents.values()].some((d) => d.sample)) return;
  const samples: { name: string; bytes: Uint8Array }[] = [
    {
      name: 'SAMPLE — Witness statement of PW-1.pdf',
      bytes: makeTextPdf([
        ['SAMPLE DOCUMENT — not a real case', 'Case: CR/2026/00421 (synthetic)', 'Statement of PW-1 recorded under Section 161', '', 'I live in Kakkanad. On the evening of the incident I was at home.', 'At about 8 pm I heard a loud sound and went outside.', 'A white vehicle was parked near the junction.', 'I identified Exhibit P3 as the document shown to me by the police.'],
        ['SAMPLE DOCUMENT — page 2', 'Cross-examination', '', 'Q: Was the street lit at that time?', 'A: Yes, the street light was working.', 'Q: Had you seen the accused before?', 'A: No, I had not seen him before.', 'Q: Who informed the police?', 'A: My neighbour called the police.'],
        ['SAMPLE DOCUMENT — page 3', 'Exhibits referred to', '', 'Exhibit P3 — Seizure mahazar', 'Exhibit P5 — Signature of the witness', '', 'Read over and admitted to be correct.'],
      ]),
    },
    {
      name: 'SAMPLE — Exhibit index.pdf',
      bytes: makeTextPdf([['SAMPLE DOCUMENT — Exhibit index (synthetic)', '', 'P1 — First Information Statement', 'P2 — Scene mahazar', 'P3 — Seizure mahazar', 'P4 — Wound certificate', 'P5 — Signature of PW-1']]),
    },
    {
      name: 'SAMPLE — Hearing notes.txt',
      bytes: new TextEncoder().encode('SAMPLE DOCUMENT — not a real case\n\nHearing notes, CR/2026/00421 (synthetic)\n\n- PW-1 examined in chief.\n- Objection to a leading question overruled.\n- Exhibit P3 marked.\n- Cross-examination to continue at the next hearing.\n'),
    },
  ];
  for (const s of samples) {
    const id = randomUUID();
    writeFileSync(join(DIRS.files, id), s.bytes);
    const ext = extensionOf(s.name);
    const now = Date.now();
    const doc: DocumentRecord = {
      id, name: s.name, extension: ext, mimeType: ALLOWED_EXTENSIONS[ext]!, size: s.bytes.length,
      sha256: createHash('sha256').update(s.bytes).digest('hex'), uploadedAt: now, modifiedAt: now,
      status: 'uploaded', history: [{ status: 'uploaded', at: now, note: 'Sample document bundled with the demo.' }], sample: true,
    };
    documents.set(id, doc);
    void processDocument(doc);
  }
  saveDocs();
}

// ---------------- tus resumable uploads ----------------
const sha256File = (path: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });

const tus = new TusServer({
  path: '/files',
  datastore: new FileStore({ directory: DIRS.tus, expirationPeriodInMilliseconds: 24 * 60 * 60 * 1000 }),
  maxSize: MAX_BYTES,
  respectForwardedHeaders: true,
  allowedOrigins: ['*'],
  async onUploadCreate(_req, upload) {
    const name = upload.metadata?.filename ?? '';
    const problem = validateUpload(name, upload.size ?? 0, MAX_BYTES);
    if (problem) throw { status_code: 400, body: problem };
    return {};
  },
  async onUploadFinish(_req, upload) {
    const tusPath = join(DIRS.tus, upload.id);
    const name = upload.metadata?.filename ?? 'document';
    const ext = extensionOf(name);
    const sha256 = await sha256File(tusPath);
    const claimed = upload.metadata?.sha256;
    if (claimed && claimed !== sha256) {
      rmSync(tusPath, { force: true });
      throw { status_code: 422, body: 'Integrity check failed: the received file does not match the original. Please upload it again.' };
    }
    const id = randomUUID();
    renameSync(tusPath, join(DIRS.files, id));
    rmSync(`${tusPath}.json`, { force: true });
    const now = Date.now();
    const doc: DocumentRecord = {
      id, name, extension: ext, mimeType: ALLOWED_EXTENSIONS[ext] ?? 'application/octet-stream', size: statSync(join(DIRS.files, id)).size,
      sha256, uploadedAt: now, modifiedAt: now, status: 'uploaded', history: [{ status: 'uploaded', at: now, note: claimed ? 'SHA-256 verified.' : undefined }],
    };
    documents.set(id, doc);
    saveDocs();
    void processDocument(doc);
    return { headers: { 'X-Document-Id': id } };
  },
});
setInterval(() => void tus.cleanUpExpiredUploads().catch(() => {}), 60 * 60 * 1000).unref();

// ---------------- HTTP helpers ----------------
function cors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin)) {
    res.writeHead(403).end('Origin not allowed');
    return false;
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, If-Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, ETag, X-Content-SHA256, Content-Disposition');
  return true;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 5_000_000) throw new Error('Body too large');
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

const contentDisposition = (name: string, inline: boolean) => `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;

/** Original bytes with HTTP Range support (resumable downloads) and an integrity header. */
function sendContent(req: IncomingMessage, res: ServerResponse, doc: DocumentRecord, inline: boolean): void {
  const path = join(DIRS.files, doc.id);
  if (!existsSync(path)) return json(res, 404, { error: 'The stored file is missing.' });
  const size = statSync(path).size;
  const etag = `"${doc.sha256}"`;
  const headers: Record<string, string | number> = {
    'Content-Type': doc.mimeType,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'X-Content-SHA256': doc.sha256,
    'Content-Disposition': contentDisposition(doc.name, inline),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  const ifRange = req.headers['if-range'];
  if (range && (!ifRange || ifRange === etag)) {
    const start = range[1] ? Number(range[1]) : size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (!(start >= 0 && start <= end && start < size)) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return void res.end();
    createReadStream(path, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return void res.end();
  createReadStream(path).pipe(res);
}

/** Streams a ZIP of the selected documents (stored, not recompressed). */
async function sendZip(res: ServerResponse, ids: string[]): Promise<void> {
  const chosen = ids.map((id) => documents.get(id)).filter((d): d is DocumentRecord => Boolean(d && existsSync(join(DIRS.files, d.id))));
  if (chosen.length === 0) return json(res, 400, { error: 'None of the selected documents are available.' });
  res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(`CR-2026-00421_documents_${new Date().toISOString().slice(0, 10)}.zip`, false), 'Cache-Control': 'no-store' });
  const zip = new Zip((err, chunk, final) => {
    if (err) return res.destroy(err);
    res.write(chunk);
    if (final) res.end();
  });
  const used = new Set<string>();
  for (const doc of chosen) {
    let name = doc.name;
    for (let n = 2; used.has(name); n++) name = doc.name.replace(/(\.[^.]+)?$/, ` (${n})$1`);
    used.add(name);
    const entry = new ZipPassThrough(name);
    zip.add(entry);
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(join(DIRS.files, doc.id));
      stream.on('data', (c) => entry.push(new Uint8Array(c as Buffer)));
      stream.on('end', () => {
        entry.push(new Uint8Array(0), true);
        resolve();
      });
      stream.on('error', reject);
    });
  }
  zip.end();
}

// ---------------- routes ----------------
const collab = new CollabHub(DIRS.collab);

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cors(req, res)) return;
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (req.method === 'OPTIONS' && !url.pathname.startsWith('/files')) return void res.writeHead(204).end();
  if (url.pathname.startsWith('/files')) return void tus.handle(req, res);
  if (url.pathname === '/health') return json(res, 200, { ok: true });

  // Documents
  if (parts[0] === 'api' && parts[1] === 'documents') {
    if (parts.length === 2 && req.method === 'GET') return json(res, 200, [...documents.values()].sort((a, b) => b.uploadedAt - a.uploadedAt));
    if (parts[2] === 'zip' && req.method === 'POST') {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : [];
      return sendZip(res, ids);
    }
    const doc = parts[2] ? documents.get(parts[2]) : undefined;
    if (!doc) return json(res, 404, { error: 'Document not found.' });
    if (parts.length === 3 && req.method === 'GET') return json(res, 200, doc);
    if (parts.length === 3 && req.method === 'DELETE') {
      documents.delete(doc.id);
      rmSync(join(DIRS.files, doc.id), { force: true });
      saveDocs();
      return json(res, 200, { deleted: doc.id });
    }
    if (parts[3] === 'content' && (req.method === 'GET' || req.method === 'HEAD')) return sendContent(req, res, doc, url.searchParams.get('inline') === '1');
    if (parts[3] === 'reprocess' && req.method === 'POST') {
      if (!['failed', 'available'].includes(doc.status)) return json(res, 409, { error: 'The document is already being processed.' });
      void processDocument(doc);
      return json(res, 202, doc);
    }
  }

  // Editor documents (notes) + versions
  if (parts[0] === 'api' && parts[1] === 'notes') {
    if (parts.length === 2 && req.method === 'GET') return json(res, 200, [...notes.values()].sort((a, b) => b.modifiedAt - a.modifiedAt));
    if (parts.length === 2 && req.method === 'POST') {
      const body = await readJson(req);
      const now = Date.now();
      const note: NoteRecord = { id: randomUUID(), title: typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : 'Untitled document', createdAt: now, modifiedAt: now };
      notes.set(note.id, note);
      saveNotes();
      return json(res, 201, note);
    }
    const note = parts[2] ? notes.get(parts[2]) : undefined;
    if (!note) return json(res, 404, { error: 'Document not found.' });
    if (parts.length === 3 && req.method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.title === 'string' && body.title.trim()) note.title = body.title.trim().slice(0, 200);
      note.modifiedAt = Date.now();
      saveNotes();
      return json(res, 200, note);
    }
    if (parts.length === 3 && req.method === 'DELETE') {
      notes.delete(note.id);
      saveNotes();
      rmSync(versionsFile(note.id), { force: true });
      collab.forget(note.id);
      rmSync(join(DIRS.collab, `${note.id}.bin`), { force: true });
      return json(res, 200, { deleted: note.id });
    }
    if (parts[3] === 'versions') {
      const list = load<NoteVersion[]>(versionsFile(note.id), []);
      if (req.method === 'GET') return json(res, 200, list);
      if (req.method === 'POST') {
        const body = await readJson(req);
        const kind = body.kind === 'auto' || body.kind === 'before-restore' ? body.kind : 'manual';
        const version: NoteVersion = { id: randomUUID(), noteId: note.id, createdAt: Date.now(), kind, title: String(body.title ?? note.title).slice(0, 200), content: body.content ?? null };
        list.unshift(version);
        writeFileSync(versionsFile(note.id), JSON.stringify(list.slice(0, 100)));
        note.modifiedAt = Date.now();
        saveNotes();
        return json(res, 201, version);
      }
    }
  }
  json(res, 404, { error: 'Not found.' });
}

const http = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (!res.headersSent) json(res, 500, { error: 'The server could not complete the request.' });
    else res.destroy();
    console.error('[docs] request failed:', err instanceof Error ? err.message : err); // never log document contents
  });
});

const wss = new WebSocketServer({ noServer: true });
http.on('upgrade', (req, socket, head) => {
  const match = /^\/collab\/([\w-]{1,80})$/.exec(new URL(req.url ?? '/', 'http://localhost').pathname);
  if (!match || !originAllowed(req.headers.origin)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => collab.connect(ws, match[1]!));
});

function listen(attempt = 0): void {
  http.once('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < 20) return void setTimeout(() => listen(attempt + 1), 250);
    console.error(`[docs] cannot listen on port ${PORT}: ${err.message}`);
    process.exit(1);
  });
  http.listen(PORT, () => {
    seedSamples();
    console.log(`[docs] document server on http://localhost:${PORT} (max file ${(MAX_BYTES / 1048576).toFixed(0)} MB)`);
  });
}
listen();

function shutdown(): void {
  collab.persistAll();
  setTimeout(() => process.exit(0), 300).unref();
  http.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
