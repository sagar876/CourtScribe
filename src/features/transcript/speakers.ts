import type { SpeakerId } from '../../../shared/transcript.ts';

export const SPEAKER_STYLE: Record<SpeakerId, string> = {
  judge: 'text-navy-900 bg-navy-100',
  pp: 'text-accent-700 bg-accent-50',
  dc: 'text-violet-700 bg-violet-50',
  pw1: 'text-emerald-800 bg-emerald-50',
  clerk: 'text-slate-600 bg-slate-100',
};
