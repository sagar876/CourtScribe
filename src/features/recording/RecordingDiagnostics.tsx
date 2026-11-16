import { useEffect, useState } from 'react';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { formatBytes, formatDuration } from '../../lib/format.ts';
import { useMonitorCommit } from '../perf/monitorRenders.ts';
import { recorder, useRecorderState } from './recordingSession.ts';

type Permission = PermissionState | 'unsupported' | 'unknown';

/** Microphone permission via the Permissions API, where the browser exposes it. */
function useMicPermission(): Permission {
  // Older Safari has no Permissions API at all.
  const supported = typeof navigator.permissions?.query === 'function';
  const [state, setState] = useState<Permission>(supported ? 'unknown' : 'unsupported');
  useEffect(() => {
    let status: PermissionStatus | null = null;
    let cancelled = false;
    const onChange = () => status && setState(status.state);
    if (typeof navigator.permissions?.query !== 'function') return;
    navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((s) => {
        if (cancelled) return;
        status = s;
        setState(s.state);
        s.addEventListener('change', onChange);
      })
      .catch(() => !cancelled && setState('unsupported'));
    return () => {
      cancelled = true;
      status?.removeEventListener('change', onChange);
    };
  }, []);
  return state;
}

/** Audio level sampled at 4 Hz — enough for a diagnostic readout without per-frame renders. */
function useSampledLevel(active: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setLevel(recorder.level), 250);
    return () => clearInterval(t);
  }, [active]);
  return active ? level : 0;
}

/** Audio-capture diagnostics — kept separate from WebSocket throughput metrics. */
export function RecordingDiagnostics() {
  useMonitorCommit();
  const s = useRecorderState();
  const permission = useMicPermission();
  const active = s.status === 'recording';
  const level = useSampledLevel(active);
  const last = s.recordings[0];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      <MetricTile label="Recording state" value={s.status} hint={s.supported ? (s.mimeType ?? 'format chosen at start') : (s.unsupportedReason ?? '')} tone={s.status === 'error' ? 'danger' : 'default'} source="browser" />
      <MetricTile label="Recording duration" value={formatDuration(s.durationMs)} hint={s.hidden ? 'tab in background' : 'excludes paused time'} source="browser" />
      <MetricTile
        label="Audio inputs"
        value={s.devices.length}
        hint={`permission: ${permission}${s.devicesLabelled ? '' : ' · names hidden until allowed'}`}
        tone={s.devices.length === 0 ? 'warning' : 'default'}
        source="browser"
      />
      <MetricTile label="Audio level" value={active ? `${Math.round(level * 100)}%` : '—'} hint={s.levelSupported ? 'AnalyserNode RMS' : 'AudioContext unsupported'} source="browser" />
      <MetricTile label="Recorded size" value={formatBytes(s.bytes)} hint={last ? `last file ${formatBytes(last.size)} · ${s.chunks} chunks` : `${s.chunks} chunks in memory`} source="browser" />
      <MetricTile label="Recorder errors" value={s.recorderErrors} hint={s.error ? s.error.slice(0, 60) : 'MediaRecorder onerror'} tone={s.recorderErrors ? 'danger' : 'default'} source="browser" />
    </div>
  );
}
