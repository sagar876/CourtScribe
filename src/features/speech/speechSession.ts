import { useSyncExternalStore } from 'react';
import { live } from '../realtime/liveSession.ts';
import { SpeechRecognizer, type SpeechState } from './SpeechRecognizer.ts';

/** App-wide recogniser; its results go to the Node server, never straight into the transcript. */
export const speech = new SpeechRecognizer((input) => live.publishSpeech(input));

export function useSpeechState(): SpeechState {
  return useSyncExternalStore(speech.subscribe, speech.getState);
}
