import { Link } from 'react-router';
import { formatDuration } from '../../lib/format.ts';
import { recorder, useRecorderState } from './recordingSession.ts';

/** App-wide banner shown on every page while audio is being captured. */
export function RecordingIndicator() {
  const s = useRecorderState();
  if (s.status !== 'recording' && s.status !== 'paused' && s.status !== 'stopping') return null;
  const paused = s.status === 'paused';
  return (
    <div role="status" aria-live="polite" className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-white ${paused ? 'bg-amber-600' : 'bg-red-700'}`}>
      <span className="relative flex size-2.5">
        {!paused && <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-70" />}
        <span className="relative inline-flex size-2.5 rounded-full bg-white" />
      </span>
      <span className="font-semibold">{paused ? 'Recording paused' : s.status === 'stopping' ? 'Finishing recording…' : 'Recording audio'}</span>
      <span className="tabular font-mono">{formatDuration(s.durationMs)}</span>
      <span className="ml-auto flex items-center gap-3">
        <Link to="/workspace" className="inline-flex h-8 items-center underline underline-offset-2">
          Recording controls
        </Link>
        {s.status !== 'stopping' && (
          <button type="button" onClick={recorder.stop} className="inline-flex h-8 items-center rounded-md border border-white/70 px-3 text-xs font-semibold hover:bg-white/15">
            Stop recording
          </button>
        )}
      </span>
    </div>
  );
}
