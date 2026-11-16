import { SampleWindow } from '../../lib/stats.ts';
import type { TranscriptStore } from '../transcript/TranscriptStore.ts';

const MAX_PENDING_BATCHES = 500;

/**
 * Event → render latency. For each applied batch we remember the store
 * version it produced and each event's socket receive time
 * (performance.now()). When a list view commits that version to the DOM
 * (useLayoutEffect → store.markCommitted), every event in it gets a sample.
 */
export class RenderLatencyTracker {
  private pending: { version: number; receivedAt: number[] }[] = [];
  readonly samples = new SampleWindow(4_000);
  unmeasured = 0;
  private offCommit: () => void;
  private offViews: () => void;

  constructor(private readonly store: TranscriptStore) {
    this.offCommit = store.onCommit((version) => this.committed(version));
    // When the last view unmounts, batches still waiting for a commit can never be measured
    // honestly — flushing them on a later remount would record seconds of fake latency.
    this.offViews = store.onViewsChange((views) => {
      if (views > 0) return;
      for (const p of this.pending) this.unmeasured += p.receivedAt.length;
      this.pending = [];
    });
  }

  /** Call right after the batch has been applied to the store. */
  expect(receivedAt: number[]): void {
    if (this.store.viewCount === 0) {
      this.unmeasured += receivedAt.length;
      return;
    }
    this.pending.push({ version: this.store.getVersion(), receivedAt });
    if (this.pending.length > MAX_PENDING_BATCHES) this.unmeasured += this.pending.shift()!.receivedAt.length;
  }

  private committed(version: number): void {
    const now = performance.now();
    let i = 0;
    while (i < this.pending.length && this.pending[i]!.version <= version) {
      for (const r of this.pending[i]!.receivedAt) this.samples.add(now - r);
      i++;
    }
    if (i > 0) this.pending.splice(0, i);
  }

  reset(): void {
    this.samples.clear();
    this.unmeasured = 0;
  }

  dispose(): void {
    this.offCommit();
    this.offViews();
  }
}
