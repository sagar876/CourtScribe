import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptEvent } from '../../../shared/protocol.ts';
import { generateTranscript, mulberry32 } from '../../../shared/transcriptGenerator.ts';
import { expandSegment } from '../../../shared/transcriptEvents.ts';
import { TranscriptStore } from '../transcript/TranscriptStore.ts';
import { DEFAULT_PIPELINE, EventPipeline, type Queued } from './EventPipeline.ts';
import { RenderLatencyTracker } from './RenderLatencyTracker.ts';

function ev(seq: number, over: Partial<TranscriptEvent> = {}): TranscriptEvent {
  return {
    eventId: `s:${seq}`, sequenceNumber: seq, segmentId: `seg-${seq}`, timestamp: 0, speakerId: 'pw1', text: `t${seq}`,
    eventType: 'segment.final', startTime: seq * 1000, endTime: seq * 1000 + 500, confidence: 0.9, replay: false, ...over,
  };
}

describe('EventPipeline', () => {
  let batches: Queued[][];
  let pipeline: EventPipeline;
  beforeEach(() => {
    // The pipeline's clock is performance.now(); fake it so gap timeouts follow test time.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    batches = [];
    pipeline = new EventPipeline((b) => batches.push(b), { ...DEFAULT_PIPELINE, windowMs: 50, queueCapacity: 4 });
    pipeline.startSession(1, false, 0);
  });
  afterEach(() => vi.useRealTimers());

  it('collects events for one batching window and applies them in a single sink call', () => {
    pipeline.ingest(ev(1), 0);
    pipeline.ingest(ev(2), 0);
    vi.advanceTimersByTime(49);
    expect(batches).toHaveLength(0);
    pipeline.ingest(ev(3), 0);
    vi.advanceTimersByTime(1);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((q) => q.event.sequenceNumber)).toEqual([1, 2, 3]);
  });

  it('deduplicates by eventId and by sequence number', () => {
    pipeline.ingest(ev(2), 0);
    pipeline.ingest(ev(2), 0); // same eventId
    pipeline.ingest(ev(2, { eventId: 'other' }), 0); // same seq, new id
    pipeline.ingest(ev(1), 0);
    vi.advanceTimersByTime(50);
    expect(batches.flat().map((q) => q.event.sequenceNumber)).toEqual([1, 2]);
    expect(pipeline.c.duplicateById).toBe(1);
    expect(pipeline.c.duplicateBySeq).toBe(1);
    expect(pipeline.c.outOfOrder).toBe(1);
  });

  it('rejects stale events below the processed watermark', () => {
    pipeline.ingest(ev(1), 0);
    vi.advanceTimersByTime(50);
    pipeline.ingest(ev(1, { eventId: 'late-copy' }), 0);
    vi.advanceTimersByTime(50);
    expect(batches.flat()).toHaveLength(1);
    expect(pipeline.c.stale).toBe(1);
  });

  it('bounds the queue and counts dropped events', () => {
    for (let i = 1; i <= 6; i++) pipeline.ingest(ev(i), 0);
    expect(pipeline.queueDepth).toBe(4);
    expect(pipeline.c.queueDropped).toBe(2);
  });

  it('drains a backlog in bounded batches, yielding between them', () => {
    const p = new EventPipeline((b) => batches.push(b), { ...DEFAULT_PIPELINE, windowMs: 50, maxBatch: 3, queueCapacity: 100 });
    p.startSession(1, false, 0);
    for (let i = 1; i <= 7; i++) p.ingest(ev(i), 0);
    vi.advanceTimersByTime(50);
    expect(batches.map((b) => b.length)).toEqual([3]); // first window: one bounded batch
    vi.runOnlyPendingTimers(); // the follow-up setTimeout(0) — yields to the event loop between batches
    vi.runOnlyPendingTimers();
    expect(batches.map((b) => b.length)).toEqual([3, 3, 1]); // rest drained on the following ticks
    expect(batches.flat().map((q) => q.event.sequenceNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('applies a changed batching window to the next batch', () => {
    pipeline.setWindow(200);
    pipeline.ingest(ev(1), 0);
    vi.advanceTimersByTime(199);
    expect(batches).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(batches).toHaveLength(1);
  });

  it('releases a sequence gap after the timeout and counts it as dropped', () => {
    pipeline.ingest(ev(1), 0);
    pipeline.ingest(ev(3), 0); // seq 2 never arrives
    vi.advanceTimersByTime(50);
    expect(batches.flat().map((q) => q.event.sequenceNumber)).toEqual([1]);
    vi.advanceTimersByTime(DEFAULT_PIPELINE.gapTimeoutMs);
    pipeline.tick();
    expect(batches.flat().map((q) => q.event.sequenceNumber)).toEqual([1, 3]);
    expect(pipeline.c.gapsSkipped).toBe(1);
  });

  it('resumes without re-applying events at or below the watermark', () => {
    pipeline.ingest(ev(1), 0);
    pipeline.ingest(ev(2), 0);
    vi.advanceTimersByTime(50);
    expect(pipeline.startSession(1, true, 0)).toBe(2); // server replays from 1
    pipeline.ingest(ev(1, { eventId: 'evicted-1', replay: true }), 0);
    pipeline.ingest(ev(3, { replay: true }), 0);
    vi.advanceTimersByTime(50);
    expect(batches.flat().map((q) => q.event.sequenceNumber)).toEqual([1, 2, 3]);
  });
});

describe('TranscriptStore.upsert', () => {
  it('appends new segments and replaces revised ones in one notification', () => {
    const store = new TranscriptStore();
    let notifications = 0;
    const updates: number[] = [];
    store.subscribe(() => notifications++);
    store.onUpdate((u) => updates.push(...u.map((x) => x.index)));
    const [a, b] = generateTranscript(2);
    store.upsert([{ ...a!, text: 'partial', isPartial: true }]);
    store.upsert([{ ...a!, isPartial: false }, b!]);
    expect(notifications).toBe(2);
    expect(store.size).toBe(2);
    expect(store.at(0)!.isPartial).toBe(false);
    expect(updates).toEqual([0]);
  });
});

describe('RenderLatencyTracker', () => {
  it('samples receive → commit for every event of a committed batch', () => {
    const store = new TranscriptStore();
    const tracker = new RenderLatencyTracker(store);
    tracker.expect([0]); // no view mounted
    expect(tracker.unmeasured).toBe(1);
    store.attachView();
    store.append(generateTranscript(1));
    const t = performance.now();
    tracker.expect([t - 10, t - 20]);
    store.markCommitted(store.getVersion());
    expect(tracker.samples.size).toBe(2);
    const [p50] = tracker.samples.percentiles(50);
    expect(p50).toBeGreaterThanOrEqual(10);
  });
});

describe('RenderLatencyTracker after the view unmounts', () => {
  it('does not record stale batches when a view mounts again later', () => {
    const store = new TranscriptStore();
    const tracker = new RenderLatencyTracker(store);
    const detach = store.attachView();
    store.append(generateTranscript(1));
    tracker.expect([performance.now() - 5]);
    detach(); // view gone before it committed that version
    expect(tracker.unmeasured).toBe(1);
    store.attachView();
    store.markCommitted(store.getVersion());
    expect(tracker.samples.size).toBe(0);
  });
});

describe('expandSegment', () => {
  it('emits growing partials followed by exactly one final with the full text', () => {
    const rng = mulberry32(1);
    for (const seg of generateTranscript(200)) {
      const events = expandSegment(seg, rng);
      const final = events.at(-1)!;
      expect(final.eventType).toBe('segment.final');
      expect(final.text).toBe(seg.text);
      expect(events.slice(0, -1).every((e) => e.eventType === 'segment.partial' && seg.text.startsWith(e.text))).toBe(true);
      expect(new Set(events.map((e) => e.segmentId))).toEqual(new Set([seg.id]));
    }
  });
});
