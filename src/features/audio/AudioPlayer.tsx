import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx';
import { StatusIndicator } from '../../components/ui/StatusIndicator.tsx';
import { cn } from '../../lib/cn.ts';
import { formatTimestamp } from '../../lib/format.ts';
import type { TranscriptStore } from '../transcript/TranscriptStore.ts';
import { PLAYBACK_RATES, type AudioEngine } from './AudioEngine.ts';

const SAMPLE_URL = import.meta.env.VITE_SAMPLE_AUDIO_URL;

/** Current time / duration, written straight to the DOM on every frame — zero React renders. */
function TimeReadout({ engine }: { engine: AudioEngine }) {
  const current = useRef<HTMLSpanElement>(null);
  const total = useRef<HTMLSpanElement>(null);
  useEffect(
    () =>
      engine.onTime((t, d) => {
        if (current.current) current.current.textContent = formatTimestamp(t * 1000, true);
        if (total.current) total.current.textContent = formatTimestamp(d * 1000, true);
      }),
    [engine],
  );
  return (
    <span className="tabular font-mono text-sm text-slate-700" aria-label="Playback position">
      <span ref={current}>00:00:00.0</span>
      <span className="text-slate-400"> / </span>
      <span ref={total}>00:00:00.0</span>
    </span>
  );
}

/** Re-renders only when the active segment id changes. */
function ActiveSegmentLabel({ engine, store }: { engine: AudioEngine; store: TranscriptStore }) {
  const id = useSyncExternalStore(engine.subscribeActive, engine.getActiveId);
  const segment = id ? store.get(id) : undefined;
  return (
    <span className="min-w-0 truncate text-xs text-slate-500">
      {segment ? (
        <>
          Active segment <span className="font-mono text-slate-700">#{segment.sequenceNumber}</span> · {segment.speakerName} · {formatTimestamp(segment.startTime)}
        </>
      ) : (
        'No transcript segment at this position'
      )}
    </span>
  );
}

export function AudioPlayer({ engine, store }: { engine: AudioEngine; store: TranscriptStore }) {
  const state = useSyncExternalStore(engine.subscribe, engine.getState);
  const waveRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!waveRef.current) return;
    return engine.attachWaveform(waveRef.current);
  }, [engine]);

  const ready = state.status === 'ready';
  const statusTone = state.status === 'error' ? 'danger' : state.status === 'loading' ? 'info' : state.playing ? 'success' : ready ? 'neutral' : 'neutral';
  const statusLabel = state.status === 'error' ? 'Audio unavailable' : state.status === 'loading' ? 'Loading audio…' : state.playing ? 'Playing' : ready ? 'Paused' : 'No audio loaded';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <StatusIndicator tone={statusTone} label={statusLabel} pulse={state.playing || state.status === 'loading'} />
          {state.sourceLabel && (
            <span className="truncate font-mono text-xs text-slate-500" title={state.sourceLabel}>
              {state.sourceLabel}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.oga,.opus,.m4a,.aac,.flac,.webm"
            className="sr-only"
            tabIndex={-1}
            aria-label="Open an audio file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) engine.loadFile(file);
              e.target.value = ''; // allow re-selecting the same file
            }}
          />
          <Button size="sm" variant={ready ? 'secondary' : 'primary'} onClick={() => fileRef.current?.click()}>
            {state.sourceLabel ? 'Open another file' : 'Open audio file'}
          </Button>
          {SAMPLE_URL && (
            <Button size="sm" onClick={() => engine.loadUrl(SAMPLE_URL, SAMPLE_URL.split('/').pop() ?? 'Configured sample')}>
              Load configured sample
            </Button>
          )}
        </div>
      </div>

      <div className="relative rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div ref={waveRef} className={cn('h-[72px]', !state.waveformReady && 'opacity-0')} aria-label="Audio waveform — click or drag to seek" />
        {!state.waveformReady && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-slate-500">
            {state.status === 'empty' && 'No audio loaded. Open a local audio file (MP3, WAV, OGG, M4A, WebM) or press “Play in player” on a recording made above.'}
            {state.status === 'loading' && 'Decoding waveform…'}
            {state.status === 'ready' && (state.waveformError ?? 'Decoding waveform…')}
            {state.status === 'error' && <span className="text-red-700">{state.error}</span>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" aria-label="Back 5 seconds" disabled={!ready} onClick={() => engine.skip(-5)}>
            −5s
          </Button>
          <Button size="md" variant="primary" disabled={!ready} onClick={engine.toggle} aria-label={state.playing ? 'Pause' : 'Play'} className="w-20">
            {state.playing ? 'Pause' : 'Play'}
          </Button>
          <Button size="sm" variant="secondary" aria-label="Forward 5 seconds" disabled={!ready} onClick={() => engine.skip(5)}>
            +5s
          </Button>
        </div>
        <TimeReadout engine={engine} />
        <SegmentedControl<number>
          label="Speed"
          disabledHint="load audio first"
          value={state.rate}
          onChange={engine.setRate}
          options={PLAYBACK_RATES.map((r) => ({ value: r, label: `${r}×`, disabled: !ready }))}
        />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Icon name="clock" className="size-4 shrink-0 text-slate-400" />
          <ActiveSegmentLabel engine={engine} store={store} />
        </div>
      </div>

      {(state.notice || (ready && state.waveformError)) && (
        <p className="text-xs text-amber-700" role="status">
          {state.notice ?? state.waveformError}
        </p>
      )}
    </div>
  );
}
