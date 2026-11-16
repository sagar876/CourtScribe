import type { TranscriptSegment } from './transcript.ts';

export type TranscriptEventType = 'segment.partial' | 'segment.final';

/** Event payload before the server stamps identity and send time onto it. */
export interface EventDraft {
  segmentId: string;
  eventType: TranscriptEventType;
  speakerId: TranscriptSegment['speakerId'];
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

/**
 * Expands one finished segment into the event stream a live recogniser would
 * emit: 0–3 partial hypotheses with growing text, then the final result.
 */
export function expandSegment(segment: TranscriptSegment, rng: () => number): EventDraft[] {
  const words = segment.text.split(' ');
  const partials = words.length < 3 ? 0 : Math.min(3, Math.floor(rng() * 4));
  const out: EventDraft[] = [];
  const duration = segment.endTime - segment.startTime;
  for (let p = 1; p <= partials; p++) {
    const share = p / (partials + 1);
    out.push({
      segmentId: segment.id,
      eventType: 'segment.partial',
      speakerId: segment.speakerId,
      text: words.slice(0, Math.max(1, Math.round(words.length * share))).join(' '),
      startTime: segment.startTime,
      endTime: segment.startTime + Math.round(duration * share),
      confidence: Math.round(segment.confidence * (0.75 + 0.2 * share) * 1000) / 1000,
    });
  }
  out.push({
    segmentId: segment.id,
    eventType: 'segment.final',
    speakerId: segment.speakerId,
    text: segment.text,
    startTime: segment.startTime,
    endTime: segment.endTime,
    confidence: segment.confidence,
  });
  return out;
}
