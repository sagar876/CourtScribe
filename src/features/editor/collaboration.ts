import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { DOC_SERVER_URL } from '../documents/config.ts';

export type SyncStatus =
  /** Changes are stored on this device and handed to the server. */
  | 'saved'
  | 'saving'
  /** Server unreachable: changes are kept on this device and sent when it is back. */
  | 'offline'
  /** Browser-only mode: stored on this device; shared with other tabs of this browser only. */
  | 'local'
  | 'failed';

export interface Participant {
  clientId: number;
  name: string;
  color: string;
  self: boolean;
}

/** Transport-independent handle: the editor only sees a Y.Doc, an Awareness and a status. */
export interface CollabSession {
  doc: Y.Doc;
  awareness: Awareness;
  mode: 'server' | 'browser';
  getStatus(): SyncStatus;
  getParticipants(): Participant[];
  subscribe(listener: () => void): () => void;
  /** Resolves once locally stored content has been loaded. */
  ready: Promise<void>;
  destroy(): void;
}

const COLORS = ['#2563eb', '#16a34a', '#c026d3', '#ea580c', '#0891b2', '#9333ea', '#dc2626', '#4f46e5'];

/**
 * A guest identity for this browser tab. There is no sign-in in this prototype, so people in a
 * document are unauthenticated guests and are labelled that way.
 */
function guestIdentity(clientId: number) {
  const n = clientId % 1000;
  return { name: `Guest ${String(n).padStart(3, '0')}`, color: COLORS[clientId % COLORS.length]! };
}

/** Shares Yjs updates and presence between tabs of this browser (browser-only mode). */
class BroadcastTransport {
  private channel: BroadcastChannel;
  constructor(
    private readonly doc: Y.Doc,
    private readonly awareness: Awareness,
    name: string,
  ) {
    this.channel = new BroadcastChannel(`courtscribe-collab-${name}`);
    this.channel.onmessage = (e: MessageEvent<{ t: string; d: Uint8Array }>) => {
      const { t, d } = e.data;
      if (t === 'update') Y.applyUpdate(doc, d, this);
      else if (t === 'sv') this.post('update', Y.encodeStateAsUpdate(doc, d));
      else if (t === 'aw') applyAwarenessUpdate(awareness, d, this);
      else if (t === 'aw?') this.post('aw', encodeAwarenessUpdate(awareness, [...awareness.getStates().keys()]));
    };
    doc.on('update', this.onUpdate);
    awareness.on('update', this.onAwareness);
    this.post('sv', Y.encodeStateVector(doc));
    this.post('aw?', new Uint8Array());
    this.post('aw', encodeAwarenessUpdate(awareness, [doc.clientID]));
  }
  private post(t: string, d: Uint8Array) {
    this.channel.postMessage({ t, d });
  }
  private onUpdate = (update: Uint8Array, origin: unknown) => origin !== this && this.post('update', update);
  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== this) this.post('aw', encodeAwarenessUpdate(this.awareness, [...added, ...updated, ...removed]));
  };
  destroy() {
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    this.doc.off('update', this.onUpdate);
    this.awareness.off('update', this.onAwareness);
    this.channel.close();
  }
}

export function openCollabSession(noteId: string): CollabSession {
  const doc = new Y.Doc();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  const local = new IndexeddbPersistence(`courtscribe-note-${noteId}`, doc);
  let status: SyncStatus = DOC_SERVER_URL ? 'saving' : 'local';
  let destroyed = false;

  let awareness: Awareness;
  let provider: WebsocketProvider | null = null;
  let bc: BroadcastTransport | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  if (DOC_SERVER_URL) {
    const wsBase = DOC_SERVER_URL.replace(/^http/, 'ws') + '/collab';
    provider = new WebsocketProvider(wsBase, noteId, doc, { maxBackoffTime: 10_000 });
    awareness = provider.awareness;
    const p = provider;
    const settle = () => {
      if (destroyed) return;
      if (!p.wsconnected) status = 'offline';
      else if ((p.ws?.bufferedAmount ?? 0) > 0) {
        status = 'saving';
        flushTimer = setTimeout(settle, 150);
      } else status = 'saved';
      notify();
    };
    p.on('status', () => settle());
    p.on('sync', () => settle());
    doc.on('update', (_u: Uint8Array, origin: unknown) => {
      if (origin === p) return; // remote change, nothing of ours to send
      status = p.wsconnected ? 'saving' : 'offline';
      notify();
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(settle, 250);
    });
  } else {
    awareness = new Awareness(doc);
    bc = new BroadcastTransport(doc, awareness, noteId);
  }

  awareness.setLocalStateField('user', guestIdentity(doc.clientID));

  let participants: Participant[] = [];
  const computeParticipants = () => {
    const list: Participant[] = [];
    awareness.getStates().forEach((state, clientId) => {
      const user = (state as { user?: { name: string; color: string } }).user;
      if (user) list.push({ clientId, name: user.name, color: user.color, self: clientId === doc.clientID });
    });
    participants = list.sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name));
  };
  computeParticipants();
  awareness.on('change', () => {
    computeParticipants();
    notify();
  });

  return {
    doc,
    awareness,
    mode: DOC_SERVER_URL ? 'server' : 'browser',
    getStatus: () => status,
    getParticipants: () => participants,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    ready: local.whenSynced.then(() => undefined),
    destroy: () => {
      destroyed = true;
      if (flushTimer) clearTimeout(flushTimer);
      bc?.destroy();
      provider?.destroy();
      void local.destroy();
      doc.destroy();
    },
  };
}
