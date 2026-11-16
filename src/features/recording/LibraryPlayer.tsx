import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { formatDuration } from '../../lib/format.ts';
import type { RecordingResult } from './AudioRecorder.ts';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const;

type Phase = 'loading' | 'ready' | 'error';

function canPlay(mimeType: string): boolean {
  const probe = document.createElement('audio');
  return probe.canPlayType(mimeType) !== '';
}

/**
 * Accessible player for a saved recording. Plays straight from the stored Blob
 * (object URL), so it works offline and never needs the transcript server.
 */
export function LibraryPlayer({ recording, autoPlay, onClose }: { recording: RecordingResult; autoPlay: boolean; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const ids = { seek: useId(), volume: useId(), speed: useId() };
  const playable = canPlay(recording.mimeType);

  useEffect(() => {
    const el = audio.current;
    if (!el || !playable) return;
    const scope = new AbortController();
    const on = (type: string, fn: () => void) => el.addEventListener(type, fn, { signal: scope.signal });
    let probing = false;
    on('loadedmetadata', () => {
      // MediaRecorder WebM files have no duration header: seek past the end so the browser computes it.
      if (el.duration === Infinity) {
        probing = true;
        el.currentTime = 1e9;
        return;
      }
      setDuration(el.duration);
      setPhase('ready');
      if (autoPlay) void el.play().catch(() => {});
    });
    on('durationchange', () => {
      if (!probing || !Number.isFinite(el.duration)) return;
      probing = false;
      el.currentTime = 0;
      setDuration(el.duration);
      setPhase('ready');
      if (autoPlay) void el.play().catch(() => {});
    });
    on('timeupdate', () => !probing && setTime(el.currentTime));
    on('play', () => setPlaying(true));
    on('pause', () => setPlaying(false));
    on('ended', () => setPlaying(false));
    on('error', () => {
      setPhase('error');
      setError('This recording could not be played in this browser. Use “Download original” and open it in an audio app.');
    });
    el.src = recording.url;
    el.load();
    return () => {
      scope.abort();
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
  }, [recording.url, playable, autoPlay]);

  const el = () => audio.current!;
  const timeText = `${formatDuration(time * 1000)} of ${formatDuration(duration * 1000)}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-accent-200 bg-accent-50/60 p-3" role="region" aria-label={`Player: ${recording.name}`}>
      <audio ref={audio} preload="metadata" />
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-semibold text-slate-800">{recording.name}</span>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close player">
          Close
        </Button>
      </div>

      {!playable ? (
        <p className="text-xs text-amber-800" role="status">
          This browser can’t play {recording.mimeType} audio (it was recorded by a different browser). The original file is unchanged — use “Download original” and open it in an app such as VLC.
        </p>
      ) : phase === 'error' ? (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" variant="primary" disabled={phase !== 'ready'} onClick={() => (playing ? el().pause() : void el().play())} className="w-20">
              {phase === 'loading' ? 'Loading…' : playing ? 'Pause' : 'Play'}
            </Button>
            <label htmlFor={ids.seek} className="sr-only">
              Seek
            </label>
            <input
              id={ids.seek}
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={Math.min(time, duration || 0)}
              disabled={phase !== 'ready'}
              aria-valuetext={timeText}
              onChange={(e) => {
                el().currentTime = Number(e.target.value);
                setTime(Number(e.target.value));
              }}
              className="h-8 min-w-[140px] flex-1 accent-navy-900"
            />
            <span className="tabular font-mono text-xs text-slate-700" aria-hidden="true">
              {formatDuration(time * 1000)} / {formatDuration(duration * 1000)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700">
            <label htmlFor={ids.volume} className="flex items-center gap-2">
              Volume
              <input
                id={ids.volume}
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  el().volume = Number(e.target.value);
                }}
                className="h-8 w-28 accent-navy-900"
              />
            </label>
            <label htmlFor={ids.speed} className="flex items-center gap-2">
              Speed
              <select
                id={ids.speed}
                value={rate}
                onChange={(e) => {
                  setRate(Number(e.target.value));
                  el().playbackRate = Number(e.target.value);
                }}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </label>
            {phase === 'loading' && <span role="status">Loading recording…</span>}
          </div>
        </>
      )}
    </div>
  );
}
