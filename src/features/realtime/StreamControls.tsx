import { STREAM_RATES, type StreamRate } from '../../../shared/protocol.ts';
import { Button } from '../../components/ui/Button.tsx';
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx';
import { SourceBadge } from '../../components/ui/SourceBadge.tsx';
import { StatusIndicator } from '../../components/ui/StatusIndicator.tsx';
import { useMonitorCommit } from '../perf/monitorRenders.ts';
import { describeConnection } from './connectionStatus.ts';
import { BATCH_WINDOWS, live, QUEUE_CAPACITY, useLiveSnapshot } from './liveSession.ts';

const CHAOS = [
  { value: 0, label: 'Off' },
  { value: 0.01, label: '1%' },
  { value: 0.05, label: '5%' },
  { value: 0.2, label: '20%' },
] as const;

function Group({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
        {badge}
      </div>
      <div className="flex flex-wrap items-end gap-3">{children}</div>
    </div>
  );
}

export function StreamControls() {
  useMonitorCommit();
  const s = useLiveSnapshot();
  const conn = describeConnection(s);
  const online = s.state === 'connected' || s.state === 'syncing';
  const needsConnection = online ? undefined : 'Connect to the stream server first';
  const cfg = s.server?.config;
  const nearest = (v: number | undefined) => CHAOS.reduce((best, o) => (Math.abs(o.value - (v ?? 0)) < Math.abs(best.value - (v ?? 0)) ? o : best)).value;

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-4">
      <Group title="Connection">
        <div className="flex w-full flex-col gap-1">
          <StatusIndicator tone={conn.tone} label={conn.label} pulse={conn.pulse} />
          <span className="truncate text-xs text-slate-500" title={conn.detail}>
            {conn.detail}
          </span>
        </div>
        {s.state === 'disconnected' ? (
          <Button variant="primary" size="sm" onClick={live.connect}>
            Connect
          </Button>
        ) : (
          <>
            <Button size="sm" onClick={live.disconnect}>
              Disconnect
            </Button>
            <Button size="sm" onClick={live.reconnectNow} title="Close the socket and reconnect immediately, resuming from the last ACK">
              Reconnect now
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={live.clearTranscript}>
          Clear transcript
        </Button>
      </Group>

      <Group title="Simulator (server)">
        <Button size="sm" variant={cfg?.running ? 'secondary' : 'primary'} disabled={!online} title={needsConnection} onClick={() => live.configureServer({ running: !cfg?.running })}>
          {cfg?.running ? 'Stop simulator' : 'Start simulator'}
        </Button>
        <SegmentedControl<StreamRate>
          label="Rate (events/s)"
          disabledHint="connect first"
          value={cfg?.rate ?? 50}
          options={STREAM_RATES.map((r) => ({ value: r, label: String(r), disabled: !online }))}
          onChange={(rate) => live.configureServer({ rate })}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Burst</span>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!online} title={needsConnection} onClick={() => live.burst(1_000)}>
              +1,000
            </Button>
            <Button
              size="sm"
              disabled={!online}
              title={needsConnection ?? `Overflow drops happen only if more than ${QUEUE_CAPACITY.toLocaleString()} events queue up before a batch is applied`}
              onClick={() => live.burst(10_000)}
            >
              +10,000
            </Button>
          </div>
        </div>
      </Group>

      <Group title="Fault injection" badge={<SourceBadge source="server" compact />}>
        <SegmentedControl<number>
          label="Duplicates"
          disabledHint="connect first"
          value={nearest(cfg?.duplicateRate)}
          options={CHAOS.map((o) => ({ ...o, disabled: !online }))}
          onChange={(duplicateRate) => live.configureServer({ duplicateRate })}
        />
        <SegmentedControl<number>
          label="Out-of-order"
          disabledHint="connect first"
          value={nearest(cfg?.reorderRate)}
          options={CHAOS.map((o) => ({ ...o, disabled: !online }))}
          onChange={(reorderRate) => live.configureServer({ reorderRate })}
        />
        <Button size="sm" variant="danger" disabled={!online} title={needsConnection ?? 'Server terminates this socket without a close handshake'} onClick={live.requestServerDrop}>
          Server drops socket
        </Button>
      </Group>

      <Group title="Client processing">
        <SegmentedControl<number>
          label="Batching window"
          value={s.windowMs}
          options={BATCH_WINDOWS.map((ms) => ({ value: ms, label: `${ms} ms` }))}
          onChange={live.setWindow}
        />
        <div className="flex flex-col gap-1">
          <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-500 uppercase">
            Network outage <SourceBadge source="simulated" compact />
          </span>
          <div className="flex gap-1.5">
            <Button size="sm" variant="danger" disabled={!online} title={needsConnection} onClick={() => live.simulateOutage(3_000)}>
              3 s
            </Button>
            <Button size="sm" variant="danger" disabled={!online} title={needsConnection} onClick={() => live.simulateOutage(15_000)}>
              15 s
            </Button>
          </div>
        </div>
      </Group>
    </div>
  );
}
