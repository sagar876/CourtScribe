import { beforeEach, describe, expect, it } from 'vitest';
import { AudioRecorder, type RecorderEnv } from './AudioRecorder.ts';

class FakeTrack extends EventTarget {
  stopped = false;
  stop() {
    this.stopped = true;
  }
  unplug() {
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks;
  }
}

const recorders: FakeRecorder[] = [];
const lastRecorder = () => recorders[recorders.length - 1];
class FakeRecorder {
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus';
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  finalBytes = 100;
  constructor(_stream: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? '';
    recorders.push(this);
  }
  start() {
    this.state = 'recording';
  }
  pause() {
    this.state = 'paused';
  }
  resume() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    // Browsers deliver the last chunk, then 'stop', asynchronously.
    queueMicrotask(() => {
      if (this.finalBytes > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(this.finalBytes)]) });
      this.onstop?.();
    });
  }
  emit(bytes: number) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)]) });
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state = 'running';
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return { fftSize: 32, getByteTimeDomainData(b: Uint8Array) { b.fill(128); } };
  }
  async close() {
    this.state = 'closed';
  }
  async resume() {}
}

function setup(over: Partial<RecorderEnv> & { getUserMedia?: () => Promise<unknown> } = {}) {
  let clock = 0;
  const store = new Map<string, string>();
  const revoked: string[] = [];
  const stream = new FakeStream();
  const { getUserMedia, ...envOver } = over;
  const env: Partial<RecorderEnv> = {
    secure: true,
    mediaDevices: {
      getUserMedia: getUserMedia ?? (async () => stream),
      enumerateDevices: async () => [{ kind: 'audioinput', deviceId: 'default', label: '', groupId: '' }],
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaDevices,
    MediaRecorder: FakeRecorder as unknown as typeof MediaRecorder,
    AudioContext: FakeAudioContext as unknown as typeof AudioContext,
    now: () => clock,
    requestFrame: () => 1,
    cancelFrame: () => {},
    createObjectURL: () => `blob:${store.size}-${Math.random()}`,
    revokeObjectURL: (u) => revoked.push(u),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    doc: null,
    win: null,
    ...envOver,
  };
  const rec = new AudioRecorder({ filenamePrefix: 'CR-2026-00421_witness-deposition', warnAfterMs: 60_000 }, env);
  return { rec, stream, store, revoked, env, advance: (ms: number) => (clock += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const denied = (name: string) => () => Promise.reject(new DOMException('nope', name));

describe('AudioRecorder', () => {
  beforeEach(() => {
    recorders.length = 0;
    FakeAudioContext.instances = [];
  });

  it('refuses to run outside a secure context', async () => {
    const { rec } = setup({ secure: false });
    expect(rec.getState().supported).toBe(false);
    expect(rec.getState().unsupportedReason).toMatch(/HTTPS/);
    await rec.start();
    expect(rec.getState().status).toBe('idle');
  });

  it('reports a denied microphone permission clearly', async () => {
    const { rec } = setup({ getUserMedia: denied('NotAllowedError') });
    await rec.start();
    expect(rec.getState().status).toBe('error');
    expect(rec.getState().error).toMatch(/denied/);
  });

  it('reports a missing microphone clearly', async () => {
    const { rec } = setup({ getUserMedia: denied('NotFoundError') });
    await rec.start();
    expect(rec.getState().error).toMatch(/No microphone was found/);
  });

  it('records, pauses, resumes and stops into a downloadable file, releasing every resource', async () => {
    const { rec, stream, store, advance } = setup();
    await rec.start();
    expect(rec.getState().status).toBe('recording');
    expect(rec.getState().mimeType).toBe('audio/webm;codecs=opus');
    expect(store.get('courtscribe.recordingInProgress')).toBe('1');

    lastRecorder()!.emit(400);
    advance(10_000);
    rec.pause();
    advance(5_000); // paused time is not counted
    rec.resume();
    advance(2_000);
    rec.stop();
    await flush();

    const s = rec.getState();
    expect(s.status).toBe('idle');
    expect(s.recordings).toHaveLength(1);
    const r = s.recordings[0]!;
    expect(r.durationMs).toBe(12_000);
    expect(r.size).toBe(500);
    expect(r.endedBy).toBe('user');
    expect(r.filename).toMatch(/^CR-2026-00421_witness-deposition_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.webm$/);
    expect(stream.tracks.every((t) => t.stopped)).toBe(true);
    expect(FakeAudioContext.instances[0]!.state).toBe('closed');
    expect(store.has('courtscribe.recordingInProgress')).toBe(false);
  });

  it('stops and keeps the captured audio when the microphone is unplugged', async () => {
    const { rec, stream, advance } = setup();
    await rec.start();
    lastRecorder()!.emit(300);
    advance(4_000);
    stream.tracks[0]!.unplug();
    await flush();
    const s = rec.getState();
    expect(s.error).toMatch(/disconnected/);
    expect(s.recordings[0]!.endedBy).toBe('device-lost');
    expect(s.recordings[0]!.size).toBe(400);
    expect(stream.tracks[0]!.stopped).toBe(true);
  });

  it('never claims a recording was saved when the browser produced no audio', async () => {
    const { rec } = setup();
    await rec.start();
    lastRecorder()!.finalBytes = 0;
    rec.stop();
    await flush();
    expect(rec.getState().recordings).toHaveLength(0);
    expect(rec.getState().status).toBe('error');
    expect(rec.getState().error).toMatch(/did not produce any audio/);
  });

  it('stops on a recorder error and keeps what was captured', async () => {
    const { rec } = setup();
    await rec.start();
    lastRecorder()!.emit(200);
    lastRecorder()!.onerror?.({ error: new Error('encoder failed') });
    await flush();
    expect(rec.getState().recorderErrors).toBe(1);
    expect(rec.getState().recordings[0]!.endedBy).toBe('recorder-error');
  });

  it('supports repeated sessions and discarding releases the object URL', async () => {
    const { rec, revoked } = setup();
    for (let i = 0; i < 3; i++) {
      await rec.start();
      rec.stop();
      await flush();
    }
    expect(rec.getState().recordings).toHaveLength(3);
    const first = rec.getState().recordings[0]!;
    rec.discard(first.id);
    expect(rec.getState().recordings).toHaveLength(2);
    expect(revoked).toContain(first.url);
  });

  it('warns once a recording passes the configured duration', async () => {
    const { rec, advance } = setup();
    await rec.start();
    advance(61_000);
    await new Promise((r) => setTimeout(r, 600)); // duration ticker runs every 500 ms
    expect(rec.getState().longRecordingWarning).toBe(true);
    rec.stop();
    await flush();
  });

  it('can cancel an unanswered permission prompt and releases a late stream', async () => {
    let grant: (s: unknown) => void = () => {};
    const { rec, stream } = setup({ getUserMedia: () => new Promise((r) => (grant = r)) });
    const starting = rec.start();
    expect(rec.getState().status).toBe('requesting');
    rec.cancelRequest();
    expect(rec.getState().status).toBe('idle');
    grant(stream); // the user answers the prompt after cancelling
    await starting;
    expect(rec.getState().status).toBe('idle');
    expect(stream.tracks[0]!.stopped).toBe(true);
  });

  it('computes the input level from the analyser waveform (silence → 0, tone → > 0)', async () => {
    let frame: (() => void) | null = null;
    let amplitude = 0;
    class ToneContext extends FakeAudioContext {
      createAnalyser() {
        return { fftSize: 64, getByteTimeDomainData: (b: Uint8Array) => b.forEach((_, i) => (b[i] = 128 + Math.round(amplitude * Math.sin(i / 3)))) };
      }
    }
    const { rec } = setup({ AudioContext: ToneContext as unknown as typeof AudioContext, requestFrame: (cb) => ((frame = cb), 1) });
    const seen: number[] = [];
    rec.onLevel((l) => seen.push(l));
    await rec.start();
    frame!();
    expect(rec.level).toBe(0);
    amplitude = 60;
    frame!();
    expect(rec.level).toBeGreaterThan(0.5);
    rec.pause();
    frame!();
    expect(rec.level).toBe(0); // paused input reads as silent
    rec.stop();
    await flush();
    expect(seen.at(-1)).toBe(0); // meter reset when the microphone is released
  });

  it('explains an interrupted recording after a reload and never restarts it', () => {
    const { env } = setup();
    env.storage!.setItem('courtscribe.recordingInProgress', '1');
    const after = new AudioRecorder({ filenamePrefix: 'x', warnAfterMs: 1 }, env);
    expect(after.getState().status).toBe('idle');
    expect(after.getState().notice).toMatch(/could not be recovered/);
  });
});
