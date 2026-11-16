/**
 * Local persistence for recordings (IndexedDB). Audio never leaves this browser;
 * this only makes it survive reloads, crashes and accidental tab closes until
 * the user downloads or discards it.
 *
 * - `recordings`: finished recordings (metadata + Blob).
 * - `chunks`: MediaRecorder chunks written every second while recording, so an
 *   interrupted recording can be reassembled after a reload.
 */
export interface StoredRecording {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  durationMs: number;
  startedAt: number;
  endedBy: string;
  downloaded: boolean;
  blob: Blob;
}

export interface InProgressRecording {
  id: string;
  mimeType: string;
  startedAt: number;
  filename: string;
  chunks: Blob[];
}

export interface RecordingPersistence {
  saveRecording(rec: StoredRecording): Promise<void>;
  listRecordings(): Promise<StoredRecording[]>;
  deleteRecording(id: string): Promise<void>;
  markDownloaded(id: string): Promise<void>;
  /** Chunk backup while recording. `meta` is stored with the first chunk. */
  appendChunk(id: string, index: number, chunk: Blob, meta?: Omit<InProgressRecording, 'chunks' | 'id'>): Promise<void>;
  clearChunks(id: string): Promise<void>;
  /** Recordings that were still being written when the page went away. */
  listInProgress(): Promise<InProgressRecording[]>;
}

const DB_NAME = 'courtscribe-recordings';
const DB_VERSION = 1;

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
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

export class IndexedDbPersistence implements RecordingPersistence {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: ['id', 'index'] }).createIndex('byId', 'id');
        if (!db.objectStoreNames.contains('inProgress')) db.createObjectStore('inProgress', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Recording storage is blocked by another open tab.'));
    });
    return this.db;
  }

  async saveRecording(rec: StoredRecording): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').put(rec);
    await done(tx);
  }

  async listRecordings(): Promise<StoredRecording[]> {
    const db = await this.open();
    const all = await request(db.transaction('recordings').objectStore('recordings').getAll() as IDBRequest<StoredRecording[]>);
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  async deleteRecording(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('recordings', 'readwrite');
    tx.objectStore('recordings').delete(id);
    await done(tx);
  }

  async markDownloaded(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction('recordings', 'readwrite');
    const store = tx.objectStore('recordings');
    const rec = (await request(store.get(id))) as StoredRecording | undefined;
    if (rec) store.put({ ...rec, downloaded: true });
    await done(tx);
  }

  async appendChunk(id: string, index: number, chunk: Blob, meta?: Omit<InProgressRecording, 'chunks' | 'id'>): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['chunks', 'inProgress'], 'readwrite');
    if (meta) tx.objectStore('inProgress').put({ id, ...meta });
    tx.objectStore('chunks').put({ id, index, chunk });
    await done(tx);
  }

  async clearChunks(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(['chunks', 'inProgress'], 'readwrite');
    tx.objectStore('chunks').delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    tx.objectStore('inProgress').delete(id);
    await done(tx);
  }

  async listInProgress(): Promise<InProgressRecording[]> {
    const db = await this.open();
    const tx = db.transaction(['chunks', 'inProgress']);
    const metas = (await request(tx.objectStore('inProgress').getAll())) as Omit<InProgressRecording, 'chunks'>[];
    const out: InProgressRecording[] = [];
    for (const meta of metas) {
      const rows = (await request(tx.objectStore('chunks').index('byId').getAll(meta.id))) as { index: number; chunk: Blob }[];
      rows.sort((a, b) => a.index - b.index);
      out.push({ ...meta, chunks: rows.map((r) => r.chunk) });
    }
    return out;
  }
}

/** In-memory implementation (tests, or browsers without IndexedDB — nothing survives a reload). */
export class MemoryPersistence implements RecordingPersistence {
  recordings = new Map<string, StoredRecording>();
  chunks = new Map<string, Blob[]>();
  meta = new Map<string, Omit<InProgressRecording, 'chunks'>>();
  failSaves = false;

  async saveRecording(rec: StoredRecording) {
    if (this.failSaves) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.recordings.set(rec.id, rec);
  }
  async listRecordings() {
    return [...this.recordings.values()].sort((a, b) => b.startedAt - a.startedAt);
  }
  async deleteRecording(id: string) {
    this.recordings.delete(id);
  }
  async markDownloaded(id: string) {
    const r = this.recordings.get(id);
    if (r) this.recordings.set(id, { ...r, downloaded: true });
  }
  async appendChunk(id: string, index: number, chunk: Blob, meta?: Omit<InProgressRecording, 'chunks' | 'id'>) {
    if (meta) this.meta.set(id, { id, ...meta });
    const list = this.chunks.get(id) ?? [];
    list[index] = chunk;
    this.chunks.set(id, list);
  }
  async clearChunks(id: string) {
    this.chunks.delete(id);
    this.meta.delete(id);
  }
  async listInProgress() {
    return [...this.meta.values()].map((m) => ({ ...m, chunks: (this.chunks.get(m.id) ?? []).filter(Boolean) }));
  }
}
