import { useState } from 'react';
import { Badge, type Tone } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { formatBytes, formatDuration } from '../../lib/format.ts';
import type { RecordingResult, SaveStatus } from './AudioRecorder.ts';
import { LibraryPlayer } from './LibraryPlayer.tsx';
import { recorder, useRecorderState } from './recordingSession.ts';

const SAVE: Record<SaveStatus, { tone: Tone; label: string }> = {
  saving: { tone: 'info', label: 'Saving…' },
  saved: { tone: 'success', label: '✓ Saved in this browser' },
  failed: { tone: 'danger', label: 'Not saved — the browser is out of storage space. Download it now' },
  'memory-only': { tone: 'warning', label: 'Not saved — lost on reload' },
};

/** Native share sheet (iPhone/Android) with the original file, when the browser supports sharing files. */
async function shareRecording(r: RecordingResult): Promise<'shared' | 'unsupported' | 'cancelled' | 'failed'> {
  try {
    const blob = await (await fetch(r.url)).blob();
    const file = new File([blob], r.filename, { type: r.mimeType });
    if (!navigator.canShare?.({ files: [file] })) return 'unsupported';
    await navigator.share({ files: [file], title: r.name });
    return 'shared';
  } catch (err) {
    return err instanceof Error && err.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}

/** "audio/webm" → "WebM audio" (the file itself keeps its real type). */
const formatName = (mime: string) => {
  const sub = mime.split('/')[1]?.split(';')[0] ?? mime;
  return `${{ webm: 'WebM', mp4: 'MP4', ogg: 'OGG', aac: 'AAC', mpeg: 'MP3', wav: 'WAV' }[sub] ?? sub.toUpperCase()} audio`;
};

const canShareFiles = () => typeof navigator.canShare === 'function' && typeof navigator.share === 'function';

function RecordingItem({ r, playing, onPlay, onOpenWithTranscript }: { r: RecordingResult; playing: boolean; onPlay: () => void; onOpenWithTranscript?: (r: RecordingResult) => void }) {
  const [mode, setMode] = useState<'view' | 'rename' | 'delete'>('view');
  const [name, setName] = useState(r.name);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const save = SAVE[r.saveStatus];
  const when = new Date(r.startedAt);

  return (
    <li className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-3 py-2.5" aria-label={r.name}>
      {mode === 'rename' ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void recorder.rename(r.id, name).then((ok) => ok && setMode('view'));
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-slate-600">
            Recording name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus className="h-8 rounded-md border border-slate-300 px-2 text-sm text-slate-900" />
          </label>
          <Button size="sm" variant="primary" type="submit" disabled={!name.trim()}>
            Save name
          </Button>
          <Button size="sm" variant="ghost" onClick={() => (setName(r.name), setMode('view'))}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 text-sm font-semibold text-slate-900">{r.name}</span>
          <span className="tabular text-xs text-slate-600">
            {when.toLocaleDateString()} {when.toLocaleTimeString()}
          </span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        <div className="col-span-2">
          <dt className="text-slate-500">Case</dt>
          <dd className="text-slate-800">
            {r.caseName || '—'} <span className="text-slate-600">({r.caseId || 'no case ID'})</span>
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Duration · size</dt>
          <dd className="tabular font-mono text-slate-800">
            {r.approximateDuration ? '≈ ' : ''}
            {formatDuration(r.durationMs)} · {formatBytes(r.size)}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Format</dt>
          <dd className="text-slate-800" title={r.mimeType}>
            {formatName(r.mimeType)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={save.tone}>{save.label}</Badge>
        {!r.complete && <Badge tone="warning">Incomplete — recovered after an interruption</Badge>}
        {r.complete && r.endedBy === 'device-lost' && <Badge tone="warning">Ended early — microphone disconnected</Badge>}
        {r.complete && r.endedBy === 'recorder-error' && <Badge tone="warning">Ended early — recorder error</Badge>}
        {r.downloaded ? <Badge tone="success">✓ Downloaded</Badge> : <Badge tone="neutral">Not downloaded yet</Badge>}
      </div>

      {mode === 'delete' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-red-50 px-2 py-1.5" role="group" aria-label="Confirm delete">
          <span className="text-xs text-red-800">{r.downloaded ? 'Delete this recording from this browser?' : 'Not downloaded yet — delete it permanently?'}</span>
          <Button size="sm" variant="danger" onClick={() => void recorder.discard(r.id).then(() => setMode('view'))}>
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('view')}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant={playing ? 'secondary' : 'primary'} onClick={onPlay} aria-pressed={playing}>
            {playing ? 'Playing below' : 'Play'}
          </Button>
          <a
            href={r.url}
            download={r.filename}
            onClick={() => recorder.markDownloaded(r.id)}
            className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            Download original
          </a>
          {canShareFiles() && (
            <Button
              size="sm"
              onClick={() =>
                void shareRecording(r).then((res) =>
                  setShareMessage(res === 'unsupported' ? 'This browser can’t share audio files — use Download original.' : res === 'failed' ? 'Sharing failed — use Download original.' : null),
                )
              }
            >
              Share…
            </Button>
          )}
          {onOpenWithTranscript && (
            <Button size="sm" variant="ghost" onClick={() => onOpenWithTranscript(r)}>
              Open in transcript player
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setMode('rename')}>
            Rename
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('delete')} aria-label={`Delete ${r.name}`}>
            Delete
          </Button>
        </div>
      )}
      {shareMessage && (
        <p className="text-xs text-amber-800" role="status">
          {shareMessage}
        </p>
      )}
    </li>
  );
}

/** Saved recordings for this device: play, download, share, rename, delete, recover. */
export function RecordingLibrary({ onOpenWithTranscript }: { onOpenWithTranscript?: (r: RecordingResult) => void }) {
  const s = useRecorderState();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const playing = s.recordings.find((r) => r.id === playingId);

  return (
    <div className="flex flex-col gap-3" data-tour="recording-library">
      {s.restoring && <p className="text-xs text-slate-500" role="status">Loading saved recordings…</p>}

      {s.recoverable.map((p) => (
        <div key={p.id} className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5" role="group" aria-label="Interrupted recording">
          <p className="text-sm font-semibold text-amber-900">Interrupted recording found</p>
          <p className="text-xs text-amber-900">
            A recording started {new Date(p.startedAt).toLocaleString()} was cut off when the page closed. About {formatDuration(p.approxDurationMs)} of audio was kept and can be recovered;
            anything after the interruption was not captured.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => void recorder.recover(p.id)}>
              Recover recording
            </Button>
            {confirmDiscard === p.id ? (
              <>
                <span className="self-center text-xs text-red-800">Delete this audio permanently?</span>
                <Button size="sm" variant="danger" onClick={() => void recorder.discardRecoverable(p.id).then(() => setConfirmDiscard(null))}>
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(null)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(p.id)}>
                Discard
              </Button>
            )}
          </div>
        </div>
      ))}

      {playing && <LibraryPlayer key={playing.id} recording={playing} autoPlay onClose={() => setPlayingId(null)} />}

      {s.recordings.length === 0 && !s.restoring && s.recoverable.length === 0 && (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-sm text-slate-500">No saved recordings yet. Recordings appear here when you stop recording.</p>
      )}

      {s.recordings.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Saved recordings">
          {s.recordings.map((r) => (
            <RecordingItem key={r.id} r={r} playing={r.id === playingId} onPlay={() => setPlayingId(r.id)} onOpenWithTranscript={onOpenWithTranscript} />
          ))}
        </ul>
      )}

    </div>
  );
}
