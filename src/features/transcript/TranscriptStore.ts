import type { TranscriptSegment } from '../../../shared/transcript.ts';

type Listener = () => void;
type AppendListener = (added: readonly TranscriptSegment[], startIndex: number) => void;
type UpdateListener = (updates: readonly { index: number; segment: TranscriptSegment }[]) => void;
type CommitListener = (version: number) => void;

/**
 * Normalised, append-only transcript store.
 *
 * - `order` holds segment ids in sequence; `byId` holds the records.
 * - Appends mutate in place (amortised O(k)) instead of copying a 100K array.
 * - React subscribes to a cheap `version` number through useSyncExternalStore;
 *   rows read records by index, so unchanged rows keep the same object identity.
 */
export class TranscriptStore {
  private order: string[] = [];
  private byId = new Map<string, TranscriptSegment>();
  /** segment id → position, so live revisions (partial → final) are O(1). */
  private indexById = new Map<string, number>();
  private updateListeners = new Set<UpdateListener>();
  private commitListeners = new Set<CommitListener>();
  private views = 0;
  private viewListeners = new Set<(views: number) => void>();
  private version = 0;
  private listeners = new Set<Listener>();
  private appendListeners = new Set<AppendListener>();
  private resetListeners = new Set<Listener>();

  constructor(initial?: readonly TranscriptSegment[]) {
    if (initial) this.load(initial);
  }

  get size(): number {
    return this.order.length;
  }

  at(index: number): TranscriptSegment | undefined {
    const id = this.order[index];
    return id === undefined ? undefined : this.byId.get(id);
  }

  idAt(index: number): string {
    return this.order[index] ?? String(index);
  }

  get(id: string): TranscriptSegment | undefined {
    return this.byId.get(id);
  }

  /** Position of a segment by id (O(1)); -1 when absent. */
  indexOf(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  /** Replace everything (dataset switch). */
  load(segments: readonly TranscriptSegment[]): void {
    this.order = new Array<string>(segments.length);
    this.byId = new Map();
    this.indexById = new Map();
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i] as TranscriptSegment;
      this.order[i] = s.id;
      this.byId.set(s.id, s);
      this.indexById.set(s.id, i);
    }
    this.bump();
    for (const l of this.resetListeners) l();
  }

  /** Append new segments; ids already present are ignored. */
  append(segments: readonly TranscriptSegment[]): void {
    if (segments.length === 0) return;
    const start = this.order.length;
    for (const s of segments) {
      if (this.byId.has(s.id)) continue;
      this.indexById.set(s.id, this.order.length);
      this.order.push(s.id);
      this.byId.set(s.id, s);
    }
    if (this.order.length === start) return;
    const added = this.order.length - start === segments.length ? segments : this.order.slice(start).map((id) => this.byId.get(id) as TranscriptSegment);
    this.bump();
    for (const l of this.appendListeners) l(added, start);
  }

  /**
   * Insert-or-replace by id in one notification. Replaced records get a new
   * object identity, so only their memoised rows re-render.
   */
  upsert(segments: readonly TranscriptSegment[]): void {
    if (segments.length === 0) return;
    const start = this.order.length;
    const updates = new Map<number, TranscriptSegment>();
    for (const s of segments) {
      const index = this.indexById.get(s.id);
      if (index === undefined) {
        this.indexById.set(s.id, this.order.length);
        this.order.push(s.id);
      } else if (index < start) {
        updates.set(index, s);
      }
      this.byId.set(s.id, s);
    }
    this.bump();
    if (this.order.length > start) {
      const added = this.order.slice(start).map((id) => this.byId.get(id) as TranscriptSegment);
      for (const l of this.appendListeners) l(added, start);
    }
    if (updates.size > 0) {
      const list = [...updates].map(([index, segment]) => ({ index, segment }));
      for (const l of this.updateListeners) l(list);
    }
  }

  clear(): void {
    this.load([]);
  }

  /** Binary search: index of the segment playing at `ms` (or the nearest one before it). */
  indexAtTime(ms: number): number {
    let lo = 0;
    let hi = this.order.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if ((this.at(mid) as TranscriptSegment).startTime <= ms) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getVersion = (): number => this.version;

  onAppend(l: AppendListener): () => void {
    this.appendListeners.add(l);
    return () => this.appendListeners.delete(l);
  }

  onUpdate(l: UpdateListener): () => void {
    this.updateListeners.add(l);
    return () => this.updateListeners.delete(l);
  }

  /** Called by list views from a layout effect once a version is committed to the DOM. */
  markCommitted(version: number): void {
    for (const l of this.commitListeners) l(version);
  }

  onCommit(l: CommitListener): () => void {
    this.commitListeners.add(l);
    return () => this.commitListeners.delete(l);
  }

  /** Mounted list views; render latency is only measured while one exists. */
  attachView(): () => void {
    this.views++;
    for (const l of this.viewListeners) l(this.views);
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      this.views--;
      for (const l of this.viewListeners) l(this.views);
    };
  }

  onViewsChange(l: (views: number) => void): () => void {
    this.viewListeners.add(l);
    return () => this.viewListeners.delete(l);
  }

  get viewCount(): number {
    return this.views;
  }

  onReset(l: Listener): () => void {
    this.resetListeners.add(l);
    return () => this.resetListeners.delete(l);
  }

  private bump(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}
