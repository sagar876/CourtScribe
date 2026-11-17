import type { SpeechInput } from '../../../shared/protocol.ts';

/** Minimal typing for the (still prefixed in Chrome/Safari) Web Speech API. */
interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [index: number]: RecognitionResult };
}
interface RecognitionErrorEvent extends Event {
  readonly error: string;
}
interface Recognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export type SpeechStatus = 'idle' | 'requesting' | 'listening' | 'restarting' | 'stopping' | 'error';

export interface SpeechState {
  status: SpeechStatus;
  supported: boolean;
  unsupportedReason: string | null;
  lang: string;
  error: string | null;
  /** Final results sent this session. */
  finals: number;
  /** Times the browser ended recognition and it was restarted automatically. */
  restarts: number;
}

export const SPEECH_LANGUAGES = [
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'ml-IN', label: 'Malayalam' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'ta-IN', label: 'Tamil' },
] as const;

const SOURCE = 'browser-web-speech';
/** How long after a final result an identical (or echoed) phrase is treated as a browser repeat. */
const ECHO_WINDOW_MS = 3_000;

/** Case- and punctuation-insensitive form used to recognise browsers repeating a phrase after a restart. */
const normalise = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/** Errors that end listening for good (as opposed to "no speech heard", which just restarts). */
const FATAL: Record<string, string> = {
  'not-allowed': 'Microphone access for speech recognition was denied. Allow the microphone for this site in the browser settings, then press Start Listening again.',
  'service-not-allowed': 'This browser does not allow its speech recognition service here. Try Google Chrome on desktop.',
  'audio-capture': 'No microphone could be used for speech recognition. Check that one is connected and not used by another application.',
  network: 'Speech recognition needs an internet connection: this browser sends audio to its online speech service. Check the connection and try again.',
  'language-not-supported': 'This browser cannot recognise the selected language. Choose another language.',
  'bad-grammar': 'The speech recognition service rejected the request.',
};

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech-recognition adapter. Emits provider-independent SpeechInput
 * (utterance ID + text + interim/final); a server-side engine could replace it
 * without touching the transcript pipeline.
 *
 * Interim results for one utterance keep the same ID so the transcript row is
 * updated in place. Browsers end continuous recognition on their own (silence,
 * time limits); while the user is still listening it is restarted, and IDs are
 * scoped per run so a restart never duplicates or overwrites earlier text.
 */
export class SpeechRecognizer {
  private recognition: Recognition | null = null;
  private wantListening = false;
  private run = 0;
  private readonly instance = Math.random().toString(36).slice(2, 8);
  /** Last text sent per utterance in the current run, to skip repeated identical interims. */
  private lastSent = new Map<string, string>();
  private finalized = new Set<string>();
  private lastFinal = { text: '', at: 0 };
  private fatal = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private state: SpeechState;

  constructor(private readonly publish: (speech: SpeechInput) => void) {
    const ctor = typeof window !== 'undefined' ? recognitionCtor() : null;
    const unsupportedReason = !ctor
      ? 'This browser does not provide speech recognition (Web Speech API). Use Google Chrome or Microsoft Edge on desktop, or Safari.'
      : typeof window !== 'undefined' && !window.isSecureContext
        ? 'Speech recognition needs a secure page (HTTPS or localhost).'
        : null;
    this.state = { status: 'idle', supported: unsupportedReason === null, unsupportedReason, lang: 'en-IN', error: null, finals: 0, restarts: 0 };
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getState = () => this.state;

  setLang = (lang: string) => {
    if (this.wantListening) return;
    this.set({ lang });
  };

  /** Explicit user action: asks for the microphone, then starts continuous recognition. */
  start = async (): Promise<void> => {
    if (!this.state.supported || this.wantListening) return;
    this.set({ status: 'requesting', error: null });
    // Ask for the microphone ourselves first so permission and "no microphone" problems are reported clearly.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      this.set({
        status: 'error',
        error:
          name === 'NotAllowedError' || name === 'SecurityError'
            ? FATAL['not-allowed']!
            : name === 'NotFoundError'
              ? 'No microphone was found. Connect a microphone and try again.'
              : FATAL['audio-capture']!,
      });
      return;
    }
    this.wantListening = true;
    this.fatal = false;
    this.set({ finals: 0, restarts: 0 });
    this.begin();
  };

  stop = (): void => {
    if (!this.wantListening) return;
    this.wantListening = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.set({ status: 'stopping' });
    // stop() (not abort()) lets the browser deliver the last final result before `end`.
    try {
      this.recognition?.stop();
    } catch {
      this.finishRun();
      this.set({ status: 'idle' });
    }
  };

  private begin(): void {
    const Ctor = recognitionCtor()!;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = this.state.lang;
    this.run++;
    this.lastSent.clear();
    const run = this.run;
    rec.onstart = () => this.set({ status: 'listening' });
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!;
        const alt = result[0];
        if (!alt) continue;
        const text = alt.transcript.replace(/\s+/g, ' ').trim();
        const id = `${this.instance}-r${run}-${i}`;
        if (this.finalized.has(id)) continue;
        if (result.isFinal) {
          this.finalized.add(id);
          this.lastSent.delete(id);
          if (!text) continue;
          // Some browsers repeat the previous final right after a restart; never add it twice.
          if (this.isEcho(text, true)) continue;
          this.lastFinal = { text, at: Date.now() };
          this.emit({ utteranceId: id, text, isFinal: true, confidence: alt.confidence > 0 ? alt.confidence : undefined });
          this.set({ finals: this.state.finals + 1 });
        } else if (text && this.lastSent.get(id) !== text && !this.isEcho(text, false)) {
          this.lastSent.set(id, text);
          this.emit({ utteranceId: id, text, isFinal: false });
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // `end` follows; we restart if still listening
      const message = FATAL[e.error];
      if (message) {
        this.fatal = true;
        this.wantListening = false;
        this.set({ status: 'error', error: message });
      }
    };
    rec.onend = () => {
      if (this.recognition !== rec) return;
      this.finishRun();
      this.recognition = null;
      if (this.wantListening && !this.fatal) {
        // The browser ended the session on its own (silence, time limit). Keep listening.
        this.set({ status: 'restarting', restarts: this.state.restarts + 1 });
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.wantListening) this.begin();
        }, 250);
      } else if (!this.fatal) {
        this.set({ status: 'idle' });
      }
    };
    this.recognition = rec;
    try {
      rec.start();
    } catch (err) {
      this.wantListening = false;
      this.recognition = null;
      this.set({ status: 'error', error: `Speech recognition could not start (${err instanceof Error ? err.message : String(err)}).` });
    }
  }

  /**
   * True when `text` repeats the last final phrase shortly after it (a restart echo):
   * the same phrase for a final; the same phrase or a prefix of it for an interim.
   */
  private isEcho(text: string, final: boolean): boolean {
    if (!this.lastFinal.text || Date.now() - this.lastFinal.at > ECHO_WINDOW_MS) return false;
    const a = normalise(text);
    const b = normalise(this.lastFinal.text);
    return final ? a === b : a.length > 0 && b.startsWith(a);
  }

  /** An interim row left open when a run ends is committed with its last text, so no row stays "Interim" forever. */
  private finishRun(): void {
    for (const [id, text] of this.lastSent) {
      if (this.finalized.has(id)) continue;
      this.finalized.add(id);
      this.emit({ utteranceId: id, text, isFinal: true });
      this.set({ finals: this.state.finals + 1 });
    }
    this.lastSent.clear();
    if (this.finalized.size > 5_000) this.finalized = new Set([...this.finalized].slice(-1_000));
  }

  private emit(partial: Pick<SpeechInput, 'utteranceId' | 'text' | 'isFinal' | 'confidence'>): void {
    this.publish({ ...partial, lang: this.state.lang, source: SOURCE });
  }

  private set(patch: Partial<SpeechState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
