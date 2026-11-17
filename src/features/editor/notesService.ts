import type { NoteRecord, NoteVersion } from '../../../shared/documents.ts';
import { DOC_SERVER_URL } from '../documents/config.ts';

/** Editor documents and their saved versions — on the document server, or in this browser. */
export interface NotesService {
  readonly mode: 'server' | 'browser';
  list(): Promise<NoteRecord[]>;
  create(title: string): Promise<NoteRecord>;
  rename(id: string, title: string): Promise<NoteRecord>;
  remove(id: string): Promise<void>;
  versions(id: string): Promise<NoteVersion[]>;
  addVersion(id: string, v: Pick<NoteVersion, 'kind' | 'title' | 'content'>): Promise<NoteVersion>;
}

async function ok<T>(res: Promise<Response>): Promise<T> {
  const r = await res;
  if (!r.ok) {
    let message = `The document server returned ${r.status}.`;
    try {
      message = ((await r.json()) as { error?: string }).error ?? message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (await r.json()) as T;
}

class ServerNotes implements NotesService {
  readonly mode = 'server' as const;
  constructor(private readonly base: string) {}
  private json = (method: string, body: unknown) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  list = () => ok<NoteRecord[]>(fetch(`${this.base}/api/notes`, { cache: 'no-store' }));
  create = (title: string) => ok<NoteRecord>(fetch(`${this.base}/api/notes`, this.json('POST', { title })));
  rename = (id: string, title: string) => ok<NoteRecord>(fetch(`${this.base}/api/notes/${encodeURIComponent(id)}`, this.json('PATCH', { title })));
  remove = async (id: string) => void (await ok(fetch(`${this.base}/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' })));
  versions = (id: string) => ok<NoteVersion[]>(fetch(`${this.base}/api/notes/${encodeURIComponent(id)}/versions`, { cache: 'no-store' }));
  addVersion = (id: string, v: Pick<NoteVersion, 'kind' | 'title' | 'content'>) => ok<NoteVersion>(fetch(`${this.base}/api/notes/${encodeURIComponent(id)}/versions`, this.json('POST', v)));
}

const NOTES_KEY = 'courtscribe.notes';
const versionsKey = (id: string) => `courtscribe.note-versions.${id}`;
const MAX_LOCAL_VERSIONS = 30;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('This browser has no room left to save. Delete old versions or documents and try again.');
  }
}

class BrowserNotes implements NotesService {
  readonly mode = 'browser' as const;
  async list() {
    return read<NoteRecord[]>(NOTES_KEY, []).sort((a, b) => b.modifiedAt - a.modifiedAt);
  }
  async create(title: string) {
    const now = Date.now();
    const note: NoteRecord = { id: crypto.randomUUID(), title: title.trim() || 'Untitled document', createdAt: now, modifiedAt: now };
    write(NOTES_KEY, [...read<NoteRecord[]>(NOTES_KEY, []), note]);
    return note;
  }
  async rename(id: string, title: string) {
    const notes = read<NoteRecord[]>(NOTES_KEY, []);
    const note = notes.find((n) => n.id === id);
    if (!note) throw new Error('Document not found.');
    note.title = title.trim() || note.title;
    note.modifiedAt = Date.now();
    write(NOTES_KEY, notes);
    return note;
  }
  async remove(id: string) {
    write(NOTES_KEY, read<NoteRecord[]>(NOTES_KEY, []).filter((n) => n.id !== id));
    try {
      localStorage.removeItem(versionsKey(id));
    } catch {
      /* ignore */
    }
    indexedDB.deleteDatabase(`courtscribe-note-${id}`);
  }
  async versions(id: string) {
    return read<NoteVersion[]>(versionsKey(id), []);
  }
  async addVersion(id: string, v: Pick<NoteVersion, 'kind' | 'title' | 'content'>) {
    const version: NoteVersion = { ...v, id: crypto.randomUUID(), noteId: id, createdAt: Date.now() };
    write(versionsKey(id), [version, ...read<NoteVersion[]>(versionsKey(id), [])].slice(0, MAX_LOCAL_VERSIONS));
    const notes = read<NoteRecord[]>(NOTES_KEY, []);
    const note = notes.find((n) => n.id === id);
    if (note) {
      note.modifiedAt = Date.now();
      write(NOTES_KEY, notes);
    }
    return version;
  }
}

export const notesService: NotesService = DOC_SERVER_URL ? new ServerNotes(DOC_SERVER_URL) : new BrowserNotes();
