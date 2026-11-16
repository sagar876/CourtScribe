import { trackResource } from '../../lib/resources.ts';
import type { RecordingPersistence, StoredRecording } from './recordingStorage.ts';

export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'paused' | 'stopping' | 'error';

export interface InputDevice {
  deviceId: string;
  label: string;
}

export type SaveStatus = 'saving' | 'saved' | 'failed' | 'memory-only';

export interface CaseInfo {
  caseId: string;
  caseName: string;
  sessionId: string;
}

export interface RecordingResult extends CaseInfo {
  id: string;
  /** User-editable display name. */
  name: string;
  createdAt: number;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  durationMs: number;
  startedAt: number;
  /** Why the recording ended, when it was not a normal stop. */
  endedBy: 'user' | 'device-lost' | 'recorder-error' | 'page-hidden-stop' | 'interrupted';
  /** The user has downloaded this file at least once. */
  downloaded: boolean;
  /**
   * saving → write to browser storage in progress · saved → confirmed by IndexedDB ·
   * failed → storage refused it (e.g. quota) · memory-only → no storage available.
   * Only `saved` survives a reload.
   */
  saveStatus: SaveStatus;
  /** False for audio reassembled after an interruption: the end of the session is missing. */
  complete: boolean;
  /** Duration estimated from backed-up chunks (recovered after an interruption). */
  approximateDuration?: boolean;
}

/** Chunks of a recording that never finished, found in storage after a reload/crash. */
export interface RecoverableRecording {
  id: string;
  startedAt: number;
  mimeType: string;
  chunks: number;
  size: number;
  approxDurationMs: number;
}

export interface RecorderState {
  status: RecorderStatus;
  supported: boolean;
  /** Why recording is not possible in this environment (insecure context, no API). */
  unsupportedReason: string | null;
  devices: InputDevice[];
  /** Labels are only exposed by browsers after permission has been granted once. */
  devicesLabelled: boolean;
  selectedDeviceId: string;
  error: string | null;
  notice: string | null;
  mimeType: string | null;
  durationMs: number;
  bytes: number;
  chunks: number;
  recordingId: string | null;
  startedAt: number | null;
  hidden: boolean;
  longRecordingWarning: boolean;
  recorderErrors: number;
  levelSupported: boolean;
  recordings: RecordingResult[];
  interruptedByReload: boolean;
  /** Saved recordings are being read back from browser storage. */
  restoring: boolean;
  /** Problems writing the browser backup (e.g. storage full). Recording itself continues. */
  storageError: string | null;
  /** Interrupted sessions the user can recover or discard. */
  recoverable: RecoverableRecording[];
}

/** Browser APIs the recorder needs — injectable so it can be tested without hardware. */
export interface RecorderEnv {
  mediaDevices: MediaDevices | undefined;
  MediaRecorder: typeof MediaRecorder | undefined;
  AudioContext: typeof AudioContext | undefined;
  now: () => number;
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
  createObjectURL: (blob: Blob) => string;
  revokeObjectURL: (url: string) => void;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  secure: boolean;
  doc: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'> | null;
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

function browserEnv(): RecorderEnv {
  const w = typeof window !== 'undefined' ? window : undefined;
  let storage: RecorderEnv['storage'] = null;
  try {
    storage = w?.sessionStorage ?? null;
  } catch {
    storage = null;
  }
  return {
    mediaDevices: typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined,
    MediaRecorder: typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined,
    AudioContext: w ? (w.AudioContext ?? (w as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined,
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (id) => cancelAnimationFrame(id),
    createObjectURL: (b) => URL.createObjectURL(b),
    revokeObjectURL: (u) => URL.revokeObjectURL(u),
    storage,
    secure: w?.isSecureContext ?? false,
    doc: typeof document !== 'undefined' ? document : null,
    win: w ?? null,
  };
}

/** Preferred container/codec order; the first one the browser supports is used. */
export const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac'];

const EXTENSIONS: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/aac': 'aac' };
const RELOAD_FLAG = 'courtscribe.recordingInProgress';
const STORAGE_FAILED = 'A backup copy could not be saved in this browser (storage may be full or blocked). Download the recording now — it will be lost if the page reloads.';
const TIMESLICE_MS = 1_000;
let recordingCounter = 0;
/** Unique even for recordings started within the same millisecond. */
const newRecordingId = () => `rec-${Date.now().toString(36)}-${++recordingCounter}`;

export function describeMediaError(err: unknown): string {
  const name = err instanceof Error || (typeof DOMException !== 'undefined' && err instanceof DOMException) ? (err as Error).name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'Microphone access was denied. Allow microphone access for this site in the browser settings, then press Start Recording again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect a microphone and press “Refresh devices”.';
    case 'OverconstrainedError':
      return 'The selected microphone is no longer available. Choose another microphone.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The microphone could not be started — it may be in use by another application.';
    case 'AbortError':
      return 'Starting the microphone was interrupted. Please try again.';
    default:
      return `The microphone could not be started${err instanceof Error && err.message ? ` (${err.message})` : ''}.`;
  }
}

/**
 * Browser audio recorder: getUserMedia → MediaRecorder, with an AnalyserNode
 * level meter. Independent of the transcript stream — audio never leaves the
 * browser. Framework-agnostic; React reads it through subscribe/getState and
 * the level meter through onLevel (DOM writes, no renders).
 */
export class AudioRecorder {
  private env: RecorderEnv;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Uint8Array<ArrayBuffer> | null = null;
  private raf: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private segmentStart = 0;
  private accumulatedMs = 0;
  private endedBy: RecordingResult['endedBy'] = 'user';
  /** Incremented by start/cancel so a late permission answer for a cancelled request is ignored. */
  private startToken = 0;
  private releases: (() => void)[] = [];
  private globalCleanup: (() => void)[] = [];
  private chunkIndex = 0;
  private listeners = new Set<() => void>();
  private levelListeners = new Set<(level: number) => void>();
  private state: RecorderState;
  level = 0;

  constructor(
    private readonly options: { filenamePrefix: string; warnAfterMs: number; persistence?: RecordingPersistence | null; caseInfo?: CaseInfo },
    env?: Partial<RecorderEnv>,
  ) {
    this.env = { ...browserEnv(), ...env };
    const unsupportedReason = !this.env.secure
      ? 'Recording needs a secure page (HTTPS or localhost).'
      : !this.env.mediaDevices?.getUserMedia
        ? 'This browser cannot access a microphone.'
        : !this.env.MediaRecorder
          ? 'This browser does not support audio recording (MediaRecorder).'
          : null;
    const interrupted = this.env.storage?.getItem(RELOAD_FLAG) === '1';
    this.env.storage?.removeItem(RELOAD_FLAG);
    this.state = {
      status: 'idle', supported: unsupportedReason === null, unsupportedReason, devices: [], devicesLabelled: false, selectedDeviceId: '',
      error: null,
      notice: interrupted && !options.persistence ? 'A recording was in progress when the page was reloaded or closed. Recordings are held in browser memory, so it could not be recovered.' : null,
      mimeType: null, durationMs: 0, bytes: 0, chunks: 0, recordingId: null, startedAt: null, hidden: this.env.doc?.visibilityState === 'hidden',
      longRecordingWarning: false, recorderErrors: 0, levelSupported: Boolean(this.env.AudioContext), recordings: [], interruptedByReload: interrupted,
      restoring: Boolean(options.persistence), storageError: null, recoverable: [],
    };
    if (options.persistence) this.ready = this.restore(options.persistence, interrupted);
  }

  /** Resolves once saved/interrupted recordings have been restored from browser storage. */
  ready: Promise<void> = Promise.resolve();

  private get caseInfo(): CaseInfo {
    return this.options.caseInfo ?? { caseId: '', caseName: '', sessionId: '' };
  }

  private fromStored(r: StoredRecording): RecordingResult {
    const url = this.env.createObjectURL(r.blob);
    this.urlReleases.set(r.id, trackResource('object-url'));
    return {
      id: r.id, name: r.name, caseId: r.caseId, caseName: r.caseName, sessionId: r.sessionId, createdAt: r.createdAt,
      url, filename: r.filename, mimeType: r.mimeType, size: r.size, durationMs: r.durationMs, startedAt: r.startedAt,
      endedBy: r.endedBy as RecordingResult['endedBy'], downloaded: r.downloaded, saveStatus: 'saved',
      complete: r.endedBy !== 'interrupted', approximateDuration: r.endedBy === 'interrupted',
    };
  }

  /**
   * Reads back what an earlier page left behind: saved recordings, and the
   * backed-up chunks of any recording that was interrupted mid-capture (offered
   * for recovery — never silently turned into a "complete" recording).
   */
  private async restore(store: RecordingPersistence, interrupted: boolean): Promise<void> {
    try {
      const partials = (await store.listInProgress()).filter((p) => p.id !== this.state.recordingId && p.chunks.length > 0);
      const recoverable = partials.map((p): RecoverableRecording => ({
        id: p.id, startedAt: p.startedAt, mimeType: p.mimeType, chunks: p.chunks.length,
        size: p.chunks.reduce((a, c) => a + c.size, 0), approxDurationMs: p.chunks.length * TIMESLICE_MS,
      }));
      const saved = await store.listRecordings();
      const restored = saved.filter((r) => !this.state.recordings.some((x) => x.id === r.id)).map((r) => this.fromStored(r));
      const notices: string[] = [];
      if (recoverable.length) notices.push(`${recoverable.length === 1 ? 'An interrupted recording was' : `${recoverable.length} interrupted recordings were`} found in this browser. Recover it to keep the audio captured before the interruption, or discard it.`);
      else if (interrupted) notices.push('A recording was in progress when the page was reloaded or closed, and no backup of it was found in this browser.');
      const waiting = restored.filter((r) => !r.downloaded).length;
      if (!recoverable.length && waiting) notices.push(`${waiting === 1 ? 'A recording that has' : `${waiting} recordings that have`} not been downloaded yet ${waiting === 1 ? 'is' : 'are'} saved in this browser.`);
      this.set({ recordings: [...this.state.recordings, ...restored], recoverable, restoring: false, notice: notices.join(' ') || null });
    } catch (err) {
      this.set({
        restoring: false,
        storageError: `Saved recordings could not be read from this browser (${err instanceof Error ? err.message : String(err)}).`,
        notice: interrupted ? 'A recording was in progress when the page was reloaded or closed and could not be recovered.' : this.state.notice,
      });
    }
  }

  /** Turns an interrupted session's backed-up chunks into a saved (incomplete) recording. */
  recover = async (id: string): Promise<boolean> => {
    const store = this.options.persistence;
    if (!store) return false;
    try {
      const partial = (await store.listInProgress()).find((p) => p.id === id);
      if (!partial || partial.chunks.length === 0) throw new Error('No recoverable audio was found.');
      const blob = new Blob(partial.chunks, { type: partial.mimeType });
      const stored: StoredRecording = {
        id, name: `Recovered recording — ${new Date(partial.startedAt).toLocaleString()}`,
        caseId: partial.caseId ?? this.caseInfo.caseId, caseName: partial.caseName ?? this.caseInfo.caseName, sessionId: partial.sessionId ?? this.caseInfo.sessionId,
        createdAt: Date.now(), filename: partial.filename, mimeType: partial.mimeType, size: blob.size,
        durationMs: partial.chunks.length * TIMESLICE_MS, startedAt: partial.startedAt, endedBy: 'interrupted', downloaded: false, blob,
      };
      await store.saveRecording(stored); // confirmed before it is shown as saved
      await store.clearChunks(id);
      this.set({ recordings: [this.fromStored(stored), ...this.state.recordings], recoverable: this.state.recoverable.filter((r) => r.id !== id), notice: null });
      return true;
    } catch (err) {
      this.set({ storageError: `The interrupted recording could not be recovered (${err instanceof Error ? err.message : String(err)}).` });
      return false;
    }
  };

  /** Permanently removes an interrupted session's backed-up chunks. */
  discardRecoverable = async (id: string): Promise<void> => {
    try {
      await this.options.persistence?.clearChunks(id);
      this.set({ recoverable: this.state.recoverable.filter((r) => r.id !== id), notice: null });
    } catch {
      this.set({ storageError: 'The interrupted recording could not be removed from this browser’s storage.' });
    }
  };

  /** Renames a recording; for saved ones the new name is stored before it is shown. */
  rename = async (id: string, name: string): Promise<boolean> => {
    const clean = name.trim().slice(0, 120);
    const rec = this.state.recordings.find((r) => r.id === id);
    if (!clean || !rec) return false;
    if (rec.saveStatus === 'saved' && this.options.persistence) {
      try {
        await this.options.persistence.rename(id, clean);
      } catch {
        this.set({ storageError: 'The new name could not be saved. Please try again.' });
        return false;
      }
    }
    this.set({ recordings: this.state.recordings.map((r) => (r.id === id ? { ...r, name: clean } : r)) });
    return true;
  };

  /** Listeners that only matter while the app is open; call once from the app shell. Returns cleanup. */
  attachGlobalListeners(): () => void {
    const onDeviceChange = () => void this.refreshDevices();
    this.env.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    const onVisibility = () => {
      const hidden = this.env.doc?.visibilityState === 'hidden';
      this.set({ hidden });
      // The level loop runs on animation frames, which pause in background tabs; restart it on return.
      if (!hidden && this.isActive() && this.analyser) this.startLevelLoop();
    };
    this.env.doc?.addEventListener('visibilitychange', onVisibility);
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!this.isActive() && !this.hasUndownloaded()) return;
      e.preventDefault();
      e.returnValue = ''; // legacy browsers need this to show the prompt
    };
    this.env.win?.addEventListener('beforeunload', onBeforeUnload as EventListener);
    const cleanup = () => {
      this.env.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
      this.env.doc?.removeEventListener('visibilitychange', onVisibility);
      this.env.win?.removeEventListener('beforeunload', onBeforeUnload as EventListener);
    };
    this.globalCleanup.push(cleanup);
    return cleanup;
  }

  // ---------- devices ----------

  /** Lists audio inputs. Never prompts for permission. */
  async refreshDevices(): Promise<void> {
    if (!this.env.mediaDevices?.enumerateDevices) return;
    try {
      const all = await this.env.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === 'audioinput');
      const labelled = inputs.some((d) => d.label);
      const devices = inputs.map((d, i) => ({ deviceId: d.deviceId, label: d.label || (d.deviceId === 'default' ? 'Default microphone' : `Microphone ${i + 1}`) }));
      const selected = devices.some((d) => d.deviceId === this.state.selectedDeviceId) ? this.state.selectedDeviceId : (devices[0]?.deviceId ?? '');
      this.set({ devices, devicesLabelled: labelled, selectedDeviceId: selected });
    } catch {
      this.set({ devices: [] });
    }
  }

  selectDevice = (deviceId: string): void => {
    if (this.isActive()) return; // switching input mid-recording is not supported
    this.set({ selectedDeviceId: deviceId });
  };

  hasUndownloaded(): boolean {
    return this.state.recordings.some((r) => !r.downloaded);
  }

  // ---------- lifecycle ----------

  isActive(): boolean {
    return this.state.status === 'recording' || this.state.status === 'paused' || this.state.status === 'stopping';
  }

  /** Must be called from an explicit user action. */
  start = async (): Promise<void> => {
    if (!this.state.supported || this.state.status === 'requesting' || this.isActive()) return;
    this.set({ status: 'requesting', error: null, notice: null, longRecordingWarning: false, storageError: null });
    const token = ++this.startToken;
    const md = this.env.mediaDevices!;
    const Recorder = this.env.MediaRecorder!;
    let stream: MediaStream;
    try {
      const deviceId = this.state.selectedDeviceId;
      stream = await md.getUserMedia({
        audio: { ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      if (token !== this.startToken) return; // cancelled meanwhile
      this.set({ status: 'error', error: describeMediaError(err) });
      void this.refreshDevices();
      return;
    }
    if (token !== this.startToken) {
      // The user cancelled while the browser was asking for permission: release the microphone at once.
      for (const t of stream.getTracks()) t.stop();
      return;
    }
    this.stream = stream;
    this.releases.push(trackResource('media-stream'));
    void this.refreshDevices(); // labels become available after permission

    const mimeType = MIME_CANDIDATES.find((t) => Recorder.isTypeSupported?.(t)) ?? '';
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new Recorder(stream, { mimeType }) : new Recorder(stream);
    } catch (err) {
      this.releaseMedia();
      this.set({ status: 'error', error: `Recording could not start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    this.recorder = recorder;
    this.chunks = [];
    this.accumulatedMs = 0;
    this.endedBy = 'user';
    const id = newRecordingId();

    this.chunkIndex = 0;
    const startedAt = Date.now();
    const filename = this.filenameFor(startedAt, mimeType || 'audio/webm');
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        this.set({ bytes: this.state.bytes + e.data.size, chunks: this.chunks.length });
        // Back up every chunk so an interrupted recording can be reassembled after a reload.
        const index = this.chunkIndex++;
        const meta = index === 0 ? { mimeType: (recorder.mimeType || mimeType || 'audio/webm').split(';')[0]!, startedAt, filename, ...this.caseInfo } : undefined;
        this.options.persistence?.appendChunk(id, index, e.data, meta).catch(() => this.set({ storageError: STORAGE_FAILED }));
      }
    };
    recorder.onerror = (e: Event) => {
      const err = (e as unknown as { error?: Error }).error;
      this.endedBy = 'recorder-error';
      this.set({ recorderErrors: this.state.recorderErrors + 1, error: `The recorder reported an error${err?.message ? `: ${err.message}` : ''}. Recording stopped.` });
      if (this.state.status === 'recording' || this.state.status === 'paused') this.stop();
      else if (recorder.state === 'inactive') this.finalize();
    };
    recorder.onstop = () => this.finalize();

    // A track ending on its own means the device went away (unplugged, revoked, OS-level mute).
    for (const track of stream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (!this.isActive()) return;
        this.endedBy = 'device-lost';
        this.set({ error: 'The microphone was disconnected. Recording stopped; the audio captured so far is kept below.' });
        this.stop();
      });
    }

    this.setupLevelMeter(stream);
    try {
      recorder.start(TIMESLICE_MS);
    } catch (err) {
      this.releaseMedia();
      this.set({ status: 'error', error: `Recording could not start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    this.segmentStart = this.env.now();
    this.env.storage?.setItem(RELOAD_FLAG, '1');
    this.set({ status: 'recording', mimeType: recorder.mimeType || mimeType || null, durationMs: 0, bytes: 0, chunks: 0, recordingId: id, startedAt, interruptedByReload: false });
    this.tick = setInterval(() => this.onTick(), 500);
    this.releases.push(trackResource('interval'));
  };

  /** Abandon a pending permission request (e.g. the browser prompt was never answered). */
  cancelRequest = (): void => {
    if (this.state.status !== 'requesting') return;
    this.startToken++;
    this.set({ status: 'idle', notice: 'Recording was not started.' });
  };

  pause = (): void => {
    if (this.state.status !== 'recording' || !this.recorder) return;
    this.recorder.pause();
    this.accumulatedMs += this.env.now() - this.segmentStart;
    this.set({ status: 'paused', durationMs: this.accumulatedMs });
  };

  resume = (): void => {
    if (this.state.status !== 'paused' || !this.recorder) return;
    this.recorder.resume();
    this.segmentStart = this.env.now();
    this.set({ status: 'recording' });
  };

  stop = (): void => {
    if (!this.recorder || (this.state.status !== 'recording' && this.state.status !== 'paused')) return;
    if (this.state.status === 'recording') this.accumulatedMs += this.env.now() - this.segmentStart;
    this.set({ status: 'stopping', durationMs: this.accumulatedMs });
    if (this.recorder.state !== 'inactive') this.recorder.stop(); // → final dataavailable, then onstop → finalize
    else this.finalize();
  };

  /**
   * Deletes from browser storage first and only then from the list, so a reload or tab close
   * right after "Delete" can never bring back a recording the user saw disappear.
   */
  discard = async (id: string): Promise<void> => {
    const rec = this.state.recordings.find((r) => r.id === id);
    if (!rec) return;
    try {
      await this.options.persistence?.deleteRecording(id);
    } catch {
      this.set({ storageError: 'The recording could not be removed from this browser’s storage. Please try again.' });
      return;
    }
    this.env.revokeObjectURL(rec.url);
    this.set({ recordings: this.state.recordings.filter((r) => r.id !== id) });
    this.releaseUrl(id);
  };

  /** Call when the user downloads a recording (the browser gives no reliable "download finished" signal). */
  markDownloaded = (id: string): void => {
    this.set({ recordings: this.state.recordings.map((r) => (r.id === id ? { ...r, downloaded: true } : r)) });
    void this.options.persistence?.markDownloaded(id).catch(() => {});
  };

  dismissNotice = (): void => this.set({ notice: null, interruptedByReload: false });

  // ---------- subscription ----------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = (): RecorderState => this.state;

  /** ~60 Hz level updates while recording. Write to the DOM, not React state. */
  onLevel(l: (level: number) => void): () => void {
    this.levelListeners.add(l);
    l(this.level);
    return () => this.levelListeners.delete(l);
  }

  /** Full teardown (tests / app shutdown). An active recording is stopped and kept. */
  dispose(): void {
    if (this.isActive()) this.stop();
    for (const c of this.globalCleanup.splice(0)) c();
    for (const r of this.state.recordings) this.env.revokeObjectURL(r.url);
  }

  // ---------- internals ----------

  private finalize(): void {
    const recorder = this.recorder;
    if (!recorder && this.state.status !== 'stopping') return;
    const durationMs = this.accumulatedMs;
    const mimeType = (recorder?.mimeType || this.state.mimeType || 'audio/webm').split(';')[0]!;
    const startedAt = this.state.startedAt ?? Date.now();
    const id = this.state.recordingId ?? newRecordingId();
    const chunks = this.chunks;
    this.chunks = [];
    this.recorder = null;
    this.releaseMedia();
    this.env.storage?.removeItem(RELOAD_FLAG);

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      // Never claim a recording exists when the browser produced no audio.
      this.set({ status: 'error', error: this.state.error ?? 'The browser did not produce any audio data, so nothing was saved.', recordingId: null });
      return;
    }
    const url = this.env.createObjectURL(blob);
    this.urlReleases.set(id, trackResource('object-url'));
    const store = this.options.persistence;
    const result: RecordingResult = {
      id, url, mimeType, size: blob.size, durationMs, startedAt,
      name: `Recording — ${new Date(startedAt).toLocaleString()}`,
      ...this.caseInfo,
      createdAt: Date.now(),
      filename: this.filenameFor(startedAt, mimeType),
      endedBy: this.endedBy,
      downloaded: false,
      saveStatus: store ? 'saving' : 'memory-only',
      // Stopped by device loss/recorder error: what was captured is whole, but the session ended early.
      complete: true,
    };
    if (store) {
      const setStatus = (saveStatus: SaveStatus, extra: Partial<RecorderState> = {}) =>
        this.set({ ...extra, recordings: this.state.recordings.map((r) => (r.id === id ? { ...r, saveStatus } : r)) });
      const { url: _url, saveStatus: _status, complete: _complete, approximateDuration: _approx, ...meta } = result;
      store
        .saveRecording({ ...meta, blob })
        .then(
          () => {
            setStatus('saved'); // only now is it shown as Saved
            void store.clearChunks(id).catch(() => {}); // the backup is redundant now; a leftover is harmless
          },
          () => setStatus('failed', { storageError: STORAGE_FAILED }),
        );
    }
    this.set({ status: this.endedBy === 'user' ? 'idle' : 'error', recordings: [result, ...this.state.recordings], recordingId: null, bytes: blob.size });
    if (this.endedBy === 'user') this.set({ error: null });
  }

  private urlReleases = new Map<string, () => void>();

  private filenameFor(startedAt: number, mimeType: string): string {
    const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
    const base = mimeType.split(';')[0]!;
    return `${this.options.filenamePrefix}_${stamp}.${EXTENSIONS[base] ?? 'webm'}`;
  }

  private releaseUrl(id: string): void {
    this.urlReleases.get(id)?.();
    this.urlReleases.delete(id);
  }

  private setupLevelMeter(stream: MediaStream): void {
    const Ctx = this.env.AudioContext;
    if (!Ctx) return;
    try {
      const ctx = new Ctx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser); // analysis only — not connected to the speakers
      this.audioContext = ctx;
      this.analyser = analyser;
      this.levelBuffer = new Uint8Array(analyser.fftSize);
      if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
      this.releases.push(trackResource('audio-context'));
      this.startLevelLoop();
    } catch {
      this.set({ levelSupported: false });
    }
  }

  private startLevelLoop(): void {
    if (this.raf !== null) this.env.cancelFrame(this.raf);
    const frame = () => {
      const analyser = this.analyser;
      const buf = this.levelBuffer;
      if (!analyser || !buf) return;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = ((buf[i] as number) - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      this.level = this.state.status === 'paused' ? 0 : Math.min(1, rms * 3);
      for (const l of this.levelListeners) l(this.level);
      this.raf = this.env.requestFrame(frame);
    };
    this.raf = this.env.requestFrame(frame);
  }

  private onTick(): void {
    if (this.state.status !== 'recording') return;
    const durationMs = this.accumulatedMs + (this.env.now() - this.segmentStart);
    this.set({ durationMs, longRecordingWarning: durationMs >= this.options.warnAfterMs });
  }

  /** Stops tracks, closes the AudioContext and stops loops. Safe to call repeatedly. */
  private releaseMedia(): void {
    if (this.raf !== null) this.env.cancelFrame(this.raf);
    this.raf = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    if (this.audioContext && this.audioContext.state !== 'closed') void this.audioContext.close().catch(() => {});
    this.audioContext = null;
    this.analyser = null;
    this.levelBuffer = null;
    this.level = 0;
    for (const l of this.levelListeners) l(0);
    for (const r of this.releases.splice(0)) r();
  }

  private set(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
