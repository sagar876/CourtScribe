/**
 * Minimal y-websocket-compatible collaboration endpoint (Yjs 13 + y-protocols), with documents
 * persisted to disk. Works with the standard `y-websocket` WebsocketProvider in the browser.
 * No authentication: this is a local/demo server (see docs for production requirements).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PERSIST_DEBOUNCE_MS = 1_000;

class SharedDoc extends Y.Doc {
  conns = new Map<WebSocket, Set<number>>();
  awareness = new awarenessProtocol.Awareness(this);
  persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly name: string, private readonly file: string) {
    super({ gc: true });
    this.awareness.setLocalState(null);
    if (existsSync(file)) Y.applyUpdate(this, readFileSync(file));
    this.on('update', (update: Uint8Array) => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_SYNC);
      syncProtocol.writeUpdate(enc, update);
      this.broadcast(encoding.toUint8Array(enc));
      this.schedulePersist();
    });
    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      const owner = this.conns.get(origin as WebSocket);
      if (owner) {
        for (const id of added) owner.add(id);
        for (const id of removed) owner.delete(id);
      }
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(enc));
    });
  }

  broadcast(message: Uint8Array): void {
    for (const conn of this.conns.keys()) send(conn, message);
  }

  schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => this.persist(), PERSIST_DEBOUNCE_MS);
  }

  persist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    writeFileSync(this.file, Y.encodeStateAsUpdate(this));
  }
}

function send(conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState !== conn.OPEN) return;
  try {
    conn.send(message);
  } catch {
    conn.close();
  }
}

export class CollabHub {
  private docs = new Map<string, SharedDoc>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private get(name: string): SharedDoc {
    let doc = this.docs.get(name);
    if (!doc) {
      doc = new SharedDoc(name, join(this.dir, `${name}.bin`));
      this.docs.set(name, doc);
    }
    return doc;
  }

  /** Deletes a document's persisted state (when its note is deleted). */
  forget(name: string): void {
    const doc = this.docs.get(name);
    if (doc) {
      for (const conn of doc.conns.keys()) conn.close();
      this.docs.delete(name);
      doc.destroy();
    }
  }

  connect(conn: WebSocket, name: string): void {
    const doc = this.get(name);
    conn.binaryType = 'arraybuffer';
    doc.conns.set(conn, new Set());
    conn.on('message', (data: ArrayBuffer | Buffer) => {
      try {
        const decoder = decoding.createDecoder(new Uint8Array(data as ArrayBuffer));
        const enc = encoding.createEncoder();
        const type = decoding.readVarUint(decoder);
        if (type === MESSAGE_SYNC) {
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, conn);
          if (encoding.length(enc) > 1) send(conn, encoding.toUint8Array(enc));
        } else if (type === MESSAGE_AWARENESS) {
          awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
        }
      } catch {
        // Malformed message: ignore (never crash the server on client input).
      }
    });
    // Keep-alive so dead connections are noticed.
    let alive = true;
    conn.on('pong', () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return conn.terminate();
      alive = false;
      conn.ping();
    }, 30_000);
    conn.on('close', () => {
      clearInterval(ping);
      const ids = doc.conns.get(conn);
      doc.conns.delete(conn);
      if (ids) awarenessProtocol.removeAwarenessStates(doc.awareness, [...ids], null);
      if (doc.conns.size === 0) {
        doc.persist();
        this.docs.delete(name);
        doc.destroy();
      }
    });
    // Sync step 1 + current presence.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    send(conn, encoding.toUint8Array(enc));
    const states = doc.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(doc.awareness, [...states.keys()]));
      send(conn, encoding.toUint8Array(aw));
    }
  }

  persistAll(): void {
    for (const doc of this.docs.values()) doc.persist();
  }
}
