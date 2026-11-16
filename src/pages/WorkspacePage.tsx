import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { generateTranscript } from '../../shared/transcriptGenerator.ts';
import { SegmentedControl } from '../components/ui/SegmentedControl.tsx';
import { TranscriptStore } from '../features/transcript/TranscriptStore.ts';
import { AudioEngine } from '../features/audio/AudioEngine.ts';
import { AudioPlayer } from '../features/audio/AudioPlayer.tsx';
import { CASE } from '../features/case/caseSession.ts';
import { RecordingLibrary } from '../features/recording/RecordingLibrary.tsx';
import { RecordingPanel } from '../features/recording/RecordingPanel.tsx';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { KeyValueGrid } from '../components/ui/KeyValueGrid.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { StatusIndicator } from '../components/ui/StatusIndicator.tsx';
import { describeConnection } from '../features/realtime/connectionStatus.ts';
import { live, liveTranscript, useLiveSnapshot } from '../features/realtime/liveSession.ts';
import { TranscriptViewer } from '../features/transcript/TranscriptViewer.tsx';
import { formatNumber, formatTimestamp } from '../lib/format.ts';


function LiveTranscriptStats() {
  useSyncExternalStore(liveTranscript.subscribe, liveTranscript.getVersion);
  const last = liveTranscript.at(liveTranscript.size - 1);
  return (
    <span className="tabular font-mono text-xs text-slate-500">
      {formatNumber(liveTranscript.size)} segments{last ? ` · up to ${formatTimestamp(last.endTime)}` : ''}
    </span>
  );
}

function TranscriptStatusCard() {
  const s = useLiveSnapshot();
  const conn = describeConnection(s);
  const running = s.server?.config.running ?? false;
  const open = s.state === 'connected' || s.state === 'syncing';
  return (
    <Card title="Transcript stream" description="Synthetic demo transcript from the local WebSocket server — not generated from the recording." className="h-full">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusIndicator tone={conn.tone} label={conn.label} pulse={conn.pulse} />
          <LiveTranscriptStats />
        </div>
        <div className="font-mono text-[11px] text-slate-500">
          Case {CASE.reference} · stream session {s.sessionId ?? '—'}
        </div>
        <p className="truncate text-xs text-slate-500" title={conn.detail}>
          {conn.detail}
        </p>
        {s.sessionRestarted && (
          <p className="text-xs text-amber-700" role="status">
            The demo server restarted with a new session, so the live transcript started again from the beginning.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {s.state === 'disconnected' ? (
            <Button variant="primary" icon={<Icon name="plug" />} onClick={live.connect}>
              Connect live feed
            </Button>
          ) : (
            <>
              <Button onClick={live.disconnect}>Disconnect</Button>
              <Button onClick={live.reconnectNow}>Reconnect</Button>
            </>
          )}
          <Button disabled={!open} title={open ? undefined : 'Connect the live feed first'} onClick={() => live.configureServer({ running: !running })}>
            {running ? 'Stop feed' : 'Start feed'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

type TranscriptSource = 'live' | 10_000 | 100_000;

export function WorkspacePage() {
  const [{ source, store }, setSelection] = useState<{ source: TranscriptSource; store: TranscriptStore }>({ source: 'live', store: liveTranscript });
  // Recorded-session transcripts start at 00:00 so they line up with any recording; built on first use, kept for this visit.
  const recorded = useRef(new Map<number, TranscriptStore>());
  const selectSource = (next: TranscriptSource) => {
    if (next === 'live') return setSelection({ source: next, store: liveTranscript });
    let s = recorded.current.get(next);
    if (!s) {
      s = new TranscriptStore(generateTranscript(next));
      recorded.current.set(next, s);
    }
    setSelection({ source: next, store: s });
  };

  // One engine per Workspace visit; disposed (audio, listeners, waveform, object URL) on leave.
  const [audio] = useState(() => new AudioEngine());
  useEffect(() => () => audio.dispose(), [audio]);
  useEffect(() => audio.setTimeline(store), [audio, store]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={CASE.reference}
        title="Courtroom Workspace"
        description={`${CASE.session} · ${CASE.court}`}
        actions={
          <>
            <Button icon={<Icon name="download" />} unavailableReason="Transcript export is not implemented yet">
              Export
            </Button>
            <Button icon={<Icon name="check" />} unavailableReason="Transcript certification is not implemented yet">
              Certify transcript
            </Button>
          </>
        }
      />

      <Card title="Case details">
        <KeyValueGrid
          items={[
            { label: 'Case reference', value: <span className="font-mono">{CASE.reference}</span> },
            { label: 'Court', value: CASE.court },
            { label: 'Session', value: CASE.session },
            {
              label: 'Language',
              value: (
                <span className="flex items-center gap-2">
                  {CASE.language} <Badge>ml-IN</Badge>
                </span>
              ),
            },
          ]}
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Audio recording" description="Captures audio from a microphone on this device. Independent of the transcript stream." className="h-full">
          <RecordingPanel />
        </Card>
        <TranscriptStatusCard />
      </div>

      <Card title="Saved recordings" description="Recordings stored on this device. They play offline, without the transcript server.">
        <RecordingLibrary onOpenWithTranscript={(r) => audio.loadUrl(r.url, r.name)} />
      </Card>

      <Card title="Playback" description="Play a recording or a local audio file, synchronised with the transcript by segment start time. Click a segment to seek to it.">
        <AudioPlayer engine={audio} store={store} />
      </Card>

      <Card
        title="Transcript"
        description={
          source === 'live'
            ? 'Synthetic Malayalam segments streamed over a real WebSocket. Times are relative to the server session, so a late join starts mid-session.'
            : 'Synthetic recorded session starting at 00:00 — use it to check audio synchronisation.'
        }
        actions={
          <SegmentedControl<TranscriptSource>
            label="Source"
            value={source}
            onChange={selectSource}
            options={[
              { value: 'live', label: 'Live feed' },
              { value: 10_000, label: 'Recorded · 10K' },
              { value: 100_000, label: 'Recorded · 100K' },
            ]}
          />
        }
        bodyClassName="p-0"
      >
        <div className="p-4">
          <TranscriptViewer key={String(source)} store={store} live={source === 'live'} playback={audio} listClassName="h-[clamp(360px,60vh,720px)]" />
        </div>
      </Card>
    </div>
  );
}
