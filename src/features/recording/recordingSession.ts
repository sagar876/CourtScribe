import { useSyncExternalStore } from 'react';
import { CASE_SLUG } from '../case/caseSession.ts';
import { AudioRecorder, type RecorderState } from './AudioRecorder.ts';

const warnMinutes = Number(import.meta.env.VITE_RECORDING_WARN_MINUTES ?? 60);
export const RECORDING_WARN_MINUTES = Number.isFinite(warnMinutes) && warnMinutes > 0 ? warnMinutes : 60;

/**
 * App-wide recorder: it survives in-app navigation so moving between pages
 * never cuts a recording. Constructing it allocates nothing — the microphone
 * is only requested when the user presses Start Recording.
 */
export const recorder = new AudioRecorder({ filenamePrefix: CASE_SLUG, warnAfterMs: RECORDING_WARN_MINUTES * 60_000 });

export function useRecorderState(): RecorderState {
  return useSyncExternalStore(recorder.subscribe, recorder.getState);
}
