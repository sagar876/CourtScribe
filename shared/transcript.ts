/** Core transcript model shared by the browser app and the WebSocket server. */
export interface TranscriptSegment {
  id: string;
  speakerId: SpeakerId;
  speakerName: string;
  text: string;
  /** Milliseconds from the start of the court session. */
  startTime: number;
  /** Milliseconds from the start of the court session. */
  endTime: number;
  /** 0..1 — synthetic in this POC. */
  confidence: number;
  sequenceNumber: number;
  /** True while the recogniser is still revising this segment (live stream only). */
  isPartial?: boolean;
}

export type SpeakerId = 'judge' | 'pp' | 'dc' | 'pw1' | 'clerk' | 'mic';

export const SPEAKERS: Record<SpeakerId, string> = {
  judge: 'Presiding Judge',
  pp: 'Public Prosecutor',
  dc: 'Defence Counsel',
  pw1: 'PW-1 (Witness)',
  clerk: 'Bench Clerk',
  /** Live microphone input. No speaker identification is attempted. */
  mic: 'Microphone User',
};
