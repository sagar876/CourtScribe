import { useEffect, useState } from 'react';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { StatusIndicator } from '../../components/ui/StatusIndicator.tsx';
import { formatBytes, formatDuration } from '../../lib/format.ts';
import type { RecordingResult } from './AudioRecorder.ts';
import { LevelMeter } from './LevelMeter.tsx';
import { recorder, RECORDING_WARN_MINUTES, useRecorderState } from './recordingSession.ts';

const STATUS: Record<string, { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; label: string }> = {
  idle: { tone: 'neutral', label: 'Not recording' },
  requesting: { tone: 'info', label: 'Waiting for microphone permission…' },
  recording: { tone: 'danger', label: 'Recording' },
  paused: { tone: 'warning', label: 'Recording paused' },
  stopping: { tone: 'info', label: 'Finishing recording…' },
  error: { tone: 'danger', label: 'Recording problem' },
};

const ENDED: Record<RecordingResult['endedBy'], string | null> = {
  user: null,
  'device-lost': 'ended early — microphone disconnected',
  'recorder-error': 'ended early — recorder error',
  'page-hidden-stop': 'ended while the tab was in the background',
  interrupted: 'recovered after the page was reloaded or closed',
};

export function RecordingPanel({ onPlay }: { onPlay?: (rec: RecordingResult) => void }) {
  const s = useRecorderState();
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  useEffect(() => void recorder.refreshDevices(), []);

  const active = s.status === 'recording' || s.status === 'paused' || s.status === 'stopping';
  const status = STATUS[s.status]!;
  const canStart = s.supported && !active && s.status !== 'requesting';

  return (
    <div className="flex flex-col gap-3" data-tour="recording-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusIndicator tone={status.tone} label={status.label} pulse={s.status === 'recording' || s.status === 'requesting'} />
        <span className="tabular font-mono text-lg text-slate-900" aria-label="Recording duration">
          {formatDuration(s.durationMs)}
        </span>
      </div>

      {!s.supported && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{s.unsupportedReason}</p>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Microphone</span>
          <select
            value={s.selectedDeviceId}
            onChange={(e) => recorder.selectDevice(e.target.value)}
            disabled={active || !s.supported || s.devices.length === 0}
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-600"
          >
            {s.devices.length === 0 && <option value="">No microphone detected</option>}
            {s.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="md" variant="secondary" disabled={active} onClick={() => void recorder.refreshDevices()}>
          Refresh devices
        </Button>
      </div>
      {!s.devicesLabelled && s.devices.length > 0 && <p className="-mt-1 text-[11px] text-slate-500">Microphone names appear after you allow access the first time.</p>}

      <div className="flex flex-wrap gap-2">
        {s.status === 'requesting' ? (
          <>
            <span className="self-center text-xs text-slate-600">Answer the browser’s microphone prompt to begin.</span>
            <Button onClick={recorder.cancelRequest}>Cancel</Button>
          </>
        ) : !active ? (
          <Button variant="record" disabled={!canStart} onClick={() => void recorder.start()}>
            ● Start Recording
          </Button>
        ) : (
          <>
            {s.status === 'paused' ? (
              <Button onClick={recorder.resume}>Resume</Button>
            ) : (
              <Button onClick={recorder.pause} disabled={s.status !== 'recording'}>
                Pause
              </Button>
            )}
            <Button variant="primary" onClick={recorder.stop} disabled={s.status === 'stopping'}>
              ■ Stop Recording
            </Button>
          </>
        )}
      </div>

      <LevelMeter recorder={recorder} active={s.status === 'recording'} />
      {!s.levelSupported && <p className="text-[11px] text-slate-500">The audio level meter is not supported in this browser; recording still works.</p>}

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-slate-500">Captured</dt>
          <dd className="tabular font-mono text-slate-800">{formatBytes(s.bytes)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Format</dt>
          <dd className="truncate font-mono text-slate-800">{s.mimeType ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Recording ID</dt>
          <dd className="truncate font-mono text-slate-800">{s.recordingId ?? '—'}</dd>
        </div>
      </dl>

      {s.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {s.error}
        </p>
      )}
      {s.notice && (
        <div className="flex items-start justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          <span>{s.notice}</span>
          <button type="button" className="shrink-0 underline" onClick={recorder.dismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      {s.storageError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {s.storageError}
        </p>
      )}
      {s.longRecordingWarning && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
          This recording has passed {RECORDING_WARN_MINUTES} minutes ({formatBytes(s.bytes)} in browser memory). Consider stopping and downloading it, then starting a new recording.
        </p>
      )}
      {active && s.hidden && <p className="text-xs text-slate-500">This tab is in the background. Recording continues; the level meter resumes when you return.</p>}

      {s.restoring && <p className="text-xs text-slate-500">Checking this browser for saved recordings…</p>}
      {s.recordings.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-slate-200 pt-3">
          <h3 className="text-xs font-semibold text-slate-700">Recordings saved in this browser</h3>
          <ul className="flex flex-col gap-2">
            {s.recordings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-slate-200 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-slate-700" title={r.filename}>
                  {r.filename}
                </span>
                <span className="tabular text-slate-500">
                  {r.approximateDuration ? '≈ ' : ''}
                  {formatDuration(r.durationMs)} · {formatBytes(r.size)}
                </span>
                {ENDED[r.endedBy] && <Badge tone="warning">{ENDED[r.endedBy]}</Badge>}
                {r.downloaded ? <Badge tone="success">✓ Downloaded</Badge> : <Badge tone="info">Not downloaded yet</Badge>}
                {r.storage === 'memory-only' && <Badge tone="danger">Not backed up — lost on reload</Badge>}
                <span className="flex gap-1.5">
                  <a
                    href={r.url}
                    download={r.filename}
                    onClick={() => recorder.markDownloaded(r.id)}
                    className="inline-flex h-8 items-center rounded-md border border-navy-900 bg-navy-900 px-2.5 text-xs font-medium text-white hover:bg-navy-800"
                  >
                    Download
                  </a>
                  {onPlay && (
                    <Button size="sm" onClick={() => onPlay(r)}>
                      Play in player
                    </Button>
                  )}
                  {confirmDiscard === r.id ? (
                    <span className="flex items-center gap-1.5" role="group" aria-label="Confirm discard">
                      <span className="text-red-700">{r.downloaded ? 'Remove from this browser?' : 'Not downloaded — delete permanently?'}</span>
                      <Button size="sm" variant="danger" onClick={() => void recorder.discard(r.id).then(() => setConfirmDiscard(null))}>
                        Delete
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(r.id)} aria-label={`Discard ${r.filename}`}>
                      Discard
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-slate-500">
        Audio stays in this browser and is never uploaded or transcribed — the transcript comes from a separate demo stream. Recordings are saved in this browser (and backed up every second while recording) so they survive a reload, until you download or discard them. Clearing site data or private browsing removes them, so download recordings you need to keep. You are responsible for obtaining any permissions required and for complying with the court’s rules on recording proceedings.
      </p>
    </div>
  );
}
