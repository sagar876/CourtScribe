import type { SpeakerId } from './transcript.ts';
import type { TranscriptEventType } from './transcriptEvents.ts';

export const STREAM_PORT = 8787;
export const STREAM_RATES = [10, 50, 100, 500] as const;
export type StreamRate = (typeof STREAM_RATES)[number];

/** One transcript event on the wire. Each event is sent as its own WebSocket frame. */
export interface TranscriptEvent {
  /** Unique per logical event. Injected duplicates and resume replays reuse the same id. */
  eventId: string;
  /** Strictly increasing per server session; the client orders and resumes by it. */
  sequenceNumber: number;
  /** Segment this event creates or revises (partials and the final share it). */
  segmentId: string;
  /** Server epoch ms at the moment the frame was written to the socket. */
  timestamp: number;
  speakerId: SpeakerId;
  text: string;
  eventType: TranscriptEventType;
  /** Media timing within the court session (ms). */
  startTime: number;
  endTime: number;
  confidence: number;
  /** True when this frame is a replay after resume. */
  replay: boolean;
}

export interface ServerConfig {
  running: boolean;
  rate: StreamRate;
  /** 0..1 probability of sending an event twice. */
  duplicateRate: number;
  /** 0..1 probability of swapping an event with the next one. */
  reorderRate: number;
}

export interface ServerStats {
  at: number;
  config: ServerConfig;
  headSeq: number;
  oldestBufferedSeq: number;
  bufferedEvents: number;
  generatedTotal: number;
  /** Frames actually written in the last second, across all clients. */
  sendRateLastSecond: number;
  sentTotal: number;
  duplicatesInjected: number;
  reorderedInjected: number;
  replayedTotal: number;
  clients: number;
  /** Server's view of this specific client. */
  you: { lastAckedSeq: number; bufferedAmount: number; sent: number } | null;
}

export type ServerMessage =
  | { type: 'hello'; sessionId: string; serverTime: number; startSeq: number; headSeq: number; resumed: boolean; unrecoverable: number }
  | { type: 'event'; event: TranscriptEvent }
  | { type: 'stats'; stats: ServerStats };

export type ClientMessage =
  | { type: 'hello'; clientId: string }
  | { type: 'ack'; seq: number }
  | { type: 'config'; config: Partial<ServerConfig> }
  | { type: 'burst'; count: number }
  | { type: 'disconnect-me' };
