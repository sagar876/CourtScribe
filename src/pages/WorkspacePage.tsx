import { useSyncExternalStore } from 'react';
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

const CASE = {
  reference: 'CR/2026/00421',
  court: 'District Court, Ernakulam',
  session: 'Witness Deposition',
  language: 'Malayalam',
};

function LiveTranscriptStats() {
  useSyncExternalStore(liveTranscript.subscribe, liveTranscript.getVersion);
  const last = liveTranscript.at(liveTranscript.size - 1);
  return (
    <span className="tabular font-mono text-xs text-slate-500">
      {formatNumber(liveTranscript.size)} segments{last ? ` · up to ${formatTimestamp(last.endTime)}` : ''}
    </span>
  );
}

function RecordingStatusCard() {
  return (
    <Card title="Recording status" className="h-full">
      <div className="flex flex-col gap-3">
        <StatusIndicator tone="neutral" label="Not recording" />
        <p className="text-xs text-slate-500">Audio capture is not part of this proof of concept. Transcript segments arrive from the local stream server instead.</p>
        <div>
          <Button icon={<Icon name="mic" />} unavailableReason="Audio recording is not implemented in this POC">
            Start recording
          </Button>
        </div>
      </div>
    </Card>
  );
}

function TranscriptStatusCard() {
  const s = useLiveSnapshot();
  const conn = describeConnection(s);
  const running = s.server?.config.running ?? false;
  const open = s.state === 'connected' || s.state === 'syncing';
  return (
    <Card title="Transcript status" className="h-full">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusIndicator tone={conn.tone} label={conn.label} pulse={conn.pulse} />
          <LiveTranscriptStats />
        </div>
        <p className="truncate text-xs text-slate-500" title={conn.detail}>
          {conn.detail}
        </p>
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

export function WorkspacePage() {
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <RecordingStatusCard />
        <TranscriptStatusCard />
      </div>

      <Card
        title="Live transcript"
        description="Synthetic Malayalam deposition segments streamed over a real WebSocket. Scroll up to hold your place; new segments are counted, not forced into view."
        bodyClassName="p-0"
      >
        <div className="p-4">
          <TranscriptViewer store={liveTranscript} live listClassName="h-[clamp(360px,60vh,720px)]" />
        </div>
      </Card>
    </div>
  );
}
