import WaveSurfer from 'wavesurfer.js';
import { trackResource } from '../../lib/resources.ts';
import type { TranscriptStore } from '../transcript/TranscriptStore.ts';
import { resolveActiveSegmentId } from './activeSegment.ts';

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type AudioStatus = 'empty' | 'loading' | 'ready' | 'error';

export interface AudioState {
  status: AudioStatus;
  playing: boolean;
  /** Seconds; 0 until metadata is known. */
  duration: number;
  rate: number;
  sourceLabel: string | null;
  error: string | null;
  /** Playback works but the waveform could not be drawn. */
  waveformError: string | null;
  /** Transient, non-fatal message (e.g. seek beyond the end of the recording). */
  notice: string | null;
  waveformReady: boolean;
}

type TimeListener = (seconds: number, duration: number) => void;

const MEDIA_ERRORS: Record<number, string> = {
  1: 'Loading was aborted.',
  2: 'A network error stopped the audio from loading.',
  3: 'The audio could not be decoded — the file may be corrupt or use an unsupported codec.',
  4: 'The audio was not found, or its format is not supported by this browser.',
};

const formatClock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Framework-agnostic playback engine.
 *
 * - Owns one HTMLAudioElement; WaveSurfer renders the waveform on top of it (`media` option).
 * - Playback time never goes through React state: time listeners are called from a
 *   requestAnimationFrame loop while playing and write to the DOM directly.
 * - The active transcript segment is resolved by binary search and published only
 *   when its id changes.
 * - `dispose()` releases the element, listeners, WaveSurfer, rAF loop and object URL.
 */
export class AudioEngine {
  /** Created lazily (from an effect or event), never during render — see `audio`. */
  private audioEl: HTMLAudioElement | null = null;
  private releaseAudio: (() => void) | null = null;
  private readonly listenerScope = new AbortController();
  private ws: WaveSurfer | null = null;
  private releaseWaveform: (() => void) | null = null;
  private currentUrl: string | null = null;
  private objectUrl: string | null = null;
  private releaseObjectUrl: (() => void) | null = null;
  private raf: number | null = null;
  private releaseRaf: (() => void) | null = null;
  private timeline: TranscriptStore | null = null;
  private offTimeline: (() => void) | null = null;
  private activeId: string | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** True while working around a missing duration header (see loadedmetadata). */
  private probingDuration = false;
  /** Incremented per load so errors from a superseded load are ignored. */
  private loadToken = 0;

  private state: AudioState = {
    status: 'empty', playing: false, duration: 0, rate: 1, sourceLabel: null, error: null, waveformError: null, notice: null, waveformReady: false,
  };
  private stateListeners = new Set<() => void>();
  private activeListeners = new Set<() => void>();
  private timeListeners = new Set<TimeListener>();

  /**
   * The constructor allocates nothing: React may call a lazy useState
   * initializer for a render it later discards, and anything created there
   * would never be cleaned up.
   */
  constructor() {}

  private get audio(): HTMLAudioElement {
    if (this.audioEl) return this.audioEl;
    if (this.disposed) return new Audio(); // inert, untracked; nothing should reach this
    const audio = new Audio();
    audio.preload = 'metadata';
    this.audioEl = audio;
    this.releaseAudio = trackResource('audio');
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => audio.addEventListener(type, fn, { signal: this.listenerScope.signal });

    on('loadedmetadata', () => {
      // MediaRecorder WebM files (Chrome) carry no duration header, so `duration` is Infinity.
      // Seeking far past the end makes the browser scan the file and report the real duration.
      if (audio.duration === Infinity) {
        this.probingDuration = true;
        audio.currentTime = 1e9;
        return;
      }
      this.set({ status: 'ready', duration: this.finiteDuration(), error: null });
    });
    on('durationchange', () => {
      if (this.probingDuration) {
        if (!Number.isFinite(audio.duration)) return;
        this.probingDuration = false;
        audio.currentTime = 0;
        this.set({ status: 'ready', duration: this.finiteDuration(), error: null });
        return;
      }
      this.set({ duration: this.finiteDuration() });
    });
    on('play', () => {
      this.set({ playing: true });
      this.startLoop();
    });
    on('pause', () => {
      this.set({ playing: false });
      this.stopLoop();
      this.tick();
    });
    on('ended', () => this.set({ playing: false }));
    on('seeked', () => !this.probingDuration && this.tick());
    on('ratechange', () => this.set({ rate: audio.playbackRate }));
    on('error', () => {
      if (!this.currentUrl) return; // src cleared during cleanup
      const code = audio.error?.code ?? 0;
      this.fail(MEDIA_ERRORS[code] ?? 'The audio could not be played.');
    });
    return audio;
  }

  // ---------- sources ----------

  /** Load a user-selected local file through an object URL (revoked on replace/dispose). */
  loadFile(file: File): void {
    const looksLikeAudio = file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i.test(file.name);
    if (!looksLikeAudio) {
      this.fail(`“${file.name}” is not an audio file.`, file.name);
      return;
    }
    if (file.type && this.audio.canPlayType(file.type) === '') {
      this.fail(`This browser cannot play ${file.type} audio. Try MP3, WAV, OGG or M4A.`, file.name);
      return;
    }
    const previous = { url: this.objectUrl, release: this.releaseObjectUrl };
    this.objectUrl = URL.createObjectURL(file);
    this.releaseObjectUrl = trackResource('object-url');
    this.loadUrl(this.objectUrl, file.name);
    // Revoke the old URL only after the element has switched away from it.
    if (previous.url) {
      URL.revokeObjectURL(previous.url);
      previous.release?.();
    }
  }

  /** Load from a URL (used for an optionally configured sample). */
  loadUrl(url: string, label: string): void {
    this.audio.pause();
    this.currentUrl = url;
    this.probingDuration = false;
    this.set({ status: 'loading', playing: false, duration: 0, sourceLabel: label, error: null, waveformError: null, notice: null, waveformReady: false });
    this.updateActive(null);
    const token = ++this.loadToken;
    if (this.ws) {
      this.ws.load(url).catch((err: unknown) => token === this.loadToken && this.onWaveformError(err));
    } else {
      this.audio.src = url;
    }
  }

  // ---------- waveform ----------

  /** Attach the WaveSurfer view. Returns a detach function. */
  attachWaveform(container: HTMLElement): () => void {
    if (this.disposed) return () => {};
    const ws = WaveSurfer.create({
      container,
      media: this.audio,
      height: 72,
      waveColor: '#cbd5e1',
      progressColor: '#26406b',
      cursorColor: '#d97706',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: true,
      dragToSeek: true,
      interact: true,
    });
    ws.on('ready', () => this.set({ waveformReady: true, waveformError: null }));
    ws.on('error', (err) => this.onWaveformError(err));
    this.ws = ws;
    this.releaseWaveform = trackResource('waveform');
    const token = this.loadToken;
    if (this.currentUrl) ws.load(this.currentUrl).catch((err: unknown) => token === this.loadToken && this.onWaveformError(err));
    return () => this.destroyWaveform();
  }

  private onWaveformError(err: unknown): void {
    if (this.disposed || !this.currentUrl) return;
    if (err instanceof Error && err.name === 'AbortError') return; // superseded by a newer load
    // If the media element can still play it, only the waveform is lost.
    if (this.audio.readyState >= HTMLMediaElement.HAVE_METADATA && !this.audio.error) {
      this.set({ waveformError: 'Waveform could not be generated for this file; playback still works.' });
      return;
    }
    // Prefer the media element's own diagnosis; browser-internal messages aren't user-facing.
    const code = this.audio.error?.code;
    if (code) return this.fail(MEDIA_ERRORS[code] ?? 'The audio could not be played.');
    const message = err instanceof Error ? err.message : String(err);
    this.fail(/404|not found|failed to fetch/i.test(message) ? 'The audio file could not be found.' : 'The audio could not be decoded — the file may be corrupt or in an unsupported format.');
  }

  private destroyWaveform(): void {
    if (!this.ws) return;
    this.ws.destroy();
    this.ws = null;
    this.releaseWaveform?.();
    this.releaseWaveform = null;
  }

  // ---------- transport ----------

  play = (): void => {
    if (this.state.status !== 'ready') return;
    this.audio.play().catch((err: unknown) => this.flashNotice(err instanceof Error && err.name === 'NotAllowedError' ? 'The browser blocked playback; press play again.' : 'Playback could not start.'));
  };

  pause = (): void => this.audioEl?.pause();

  toggle = (): void => (this.audioEl && !this.audioEl.paused ? this.pause() : this.play());

  skip = (seconds: number): void => {
    if (this.state.status !== 'ready') return;
    this.audio.currentTime = Math.min(Math.max(0, this.audio.currentTime + seconds), this.state.duration || Infinity);
  };

  /** Seek to a transcript time (ms). Returns false when nothing is loaded or the time is past the end. */
  seekMs = (ms: number): boolean => {
    if (this.state.status !== 'ready') return false;
    const seconds = ms / 1000;
    if (this.state.duration > 0 && seconds > this.state.duration) {
      this.flashNotice(`That segment starts at ${formatClock(seconds)}, after the end of this recording (${formatClock(this.state.duration)}).`);
      return false;
    }
    this.audio.currentTime = seconds;
    this.tick();
    return true;
  };

  setRate = (rate: number): void => {
    this.audio.playbackRate = rate;
  };

  get currentTime(): number {
    return this.audioEl?.currentTime ?? 0;
  }

  // ---------- transcript sync ----------

  /** Sync against a transcript store (sorted by startTime). */
  setTimeline(store: TranscriptStore | null): void {
    this.offTimeline?.();
    this.timeline = store;
    // New/revised segments can change the active one while paused; recompute (O(log n)).
    this.offTimeline = store ? store.subscribe(() => !this.state.playing && this.computeActive()) : null;
    this.computeActive();
  }

  subscribeActive = (l: () => void): (() => void) => {
    this.activeListeners.add(l);
    return () => this.activeListeners.delete(l);
  };

  getActiveId = (): string | null => this.activeId;

  /** High-frequency time updates (per animation frame while playing). Write to the DOM, not React state. */
  onTime(l: TimeListener): () => void {
    this.timeListeners.add(l);
    l(this.audioEl?.currentTime ?? 0, this.state.duration);
    return () => this.timeListeners.delete(l);
  }

  // ---------- state ----------

  subscribe = (l: () => void): (() => void) => {
    this.stateListeners.add(l);
    return () => this.stateListeners.delete(l);
  };

  getState = (): AudioState => this.state;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    this.listenerScope.abort(); // removes every audio element listener
    this.destroyWaveform();
    this.currentUrl = null;
    const audio = this.audioEl;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load(); // releases the media resource
    }
    this.audioEl = null;
    this.revokeObjectUrl();
    this.releaseAudio?.();
    this.releaseAudio = null;
    this.offTimeline?.();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.stateListeners.clear();
    this.activeListeners.clear();
    this.timeListeners.clear();
  }

  // ---------- internals ----------

  private startLoop(): void {
    if (this.raf !== null) return;
    this.releaseRaf = trackResource('raf-loop');
    const frame = () => {
      this.tick();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.releaseRaf?.();
    this.releaseRaf = null;
  }

  private tick(): void {
    const t = this.audioEl?.currentTime ?? 0;
    for (const l of this.timeListeners) l(t, this.state.duration);
    this.computeActive();
  }

  private computeActive(): void {
    const id = this.timeline && this.state.status === 'ready' ? resolveActiveSegmentId(this.timeline, (this.audioEl?.currentTime ?? 0) * 1000) : null;
    this.updateActive(id);
  }

  private updateActive(id: string | null): void {
    if (id === this.activeId) return; // publish on change only
    this.activeId = id;
    for (const l of this.activeListeners) l();
  }

  private fail(message: string, label?: string): void {
    this.audioEl?.pause();
    this.set({ status: 'error', playing: false, error: message, ...(label ? { sourceLabel: label } : {}) });
    this.updateActive(null);
  }

  private flashNotice(notice: string): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.set({ notice });
    this.noticeTimer = setTimeout(() => this.set({ notice: null }), 5_000);
  }

  private finiteDuration(): number {
    const d = this.audioEl?.duration ?? NaN;
    return Number.isFinite(d) ? d : 0;
  }

  private revokeObjectUrl(): void {
    if (!this.objectUrl) return;
    URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.releaseObjectUrl?.();
    this.releaseObjectUrl = null;
  }

  private set(patch: Partial<AudioState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.stateListeners) l();
    if (patch.duration !== undefined) for (const l of this.timeListeners) l(this.audioEl?.currentTime ?? 0, this.state.duration);
    if (patch.status !== undefined) this.computeActive();
  }
}
