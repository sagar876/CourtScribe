import type { SpeechInput } from './protocol.ts';
import type { EventDraft } from './transcriptEvents.ts';

/**
 * Turning recognised speech into transcript events — shared by the Node server and the
 * browser's local mode, so both behave identically and the server can be plugged in later
 * without changing the contract.
 */

/** Validates untrusted speech input; null when it must be rejected. */
export function parseSpeech(raw: unknown): SpeechInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.utteranceId !== 'string' || !/^[\w:.-]{1,120}$/.test(o.utteranceId)) return null;
  if (typeof o.text !== 'string') return null;
  const text = o.text.replace(/\s+/g, ' ').trim();
  if (!text || text.length > 5_000) return null;
  if (typeof o.isFinal !== 'boolean') return null;
  const confidence = typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1 ? o.confidence : undefined;
  const lang = typeof o.lang === 'string' && o.lang.length <= 35 ? o.lang : undefined;
  const source = typeof o.source === 'string' && o.source.length <= 60 ? o.source : undefined;
  return { utteranceId: o.utteranceId, text, isFinal: o.isFinal, confidence, lang, source };
}

/** Assigns segment IDs and session-relative timestamps to speech (sequence numbers and event IDs come from the caller). */
export class SpeechEventBuilder {
  /** Receive time of each open utterance's first result (bounded). */
  private utteranceStart = new Map<string, number>();

  constructor(
    private readonly sessionId: string,
    private readonly sessionStartedAt: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  build(clientKey: string, speech: SpeechInput): EventDraft {
    // Namespaced per client and session so two tabs (or a restarted server) never share a segment.
    const segmentId = `${this.sessionId}-speech-${clientKey}-${speech.utteranceId}`;
    const now = this.now();
    let started = this.utteranceStart.get(segmentId);
    if (started === undefined) {
      started = now;
      this.utteranceStart.set(segmentId, started);
      if (this.utteranceStart.size > 1_000) this.utteranceStart.delete(this.utteranceStart.keys().next().value!);
    }
    if (speech.isFinal) this.utteranceStart.delete(segmentId);
    return {
      segmentId,
      eventType: speech.isFinal ? 'segment.final' : 'segment.partial',
      speakerId: 'mic',
      text: speech.text,
      startTime: started - this.sessionStartedAt,
      endTime: now - this.sessionStartedAt,
      confidence: speech.confidence ?? 0,
    };
  }
}
