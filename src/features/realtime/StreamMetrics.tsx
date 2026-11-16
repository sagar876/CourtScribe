import { Button } from '../../components/ui/Button.tsx';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { SourceBadge } from '../../components/ui/SourceBadge.tsx';
import { formatMs, formatNumber } from '../../lib/format.ts';
import { live, QUEUE_CAPACITY, useLiveSnapshot } from './liveSession.ts';

function Section({ title, source, children, note }: { title: string; source: 'browser' | 'server'; children: React.ReactNode; note?: string }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-slate-700">{title}</h3>
        <SourceBadge source={source} />
        {note && <span className="text-[11px] text-slate-500">{note}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">{children}</div>
    </div>
  );
}

export function StreamMetrics() {
  const s = useLiveSnapshot();
  const srv = s.server;
  const you = srv?.you;
  const noView = s.renderSamples === 0 && s.renderUnmeasured > 0;

  return (
    <div className="flex flex-col gap-5">
      <Section title="Throughput & latency" source="browser" note="All latencies use performance.now(), starting at the WebSocket message event.">
        <MetricTile label="Incoming" value={formatNumber(s.incomingPerSecond)} unit="events/s" hint={`${formatNumber(s.received)} events total`} />
        <MetricTile label="Processed" value={formatNumber(s.processedPerSecond)} unit="events/s" hint={`${formatNumber(s.processed)} applied to store`} />
        <MetricTile label="Processing p50" value={formatMs(s.processingP50)} unit="ms" hint="receive → applied to store" />
        <MetricTile label="Processing p95" value={formatMs(s.processingP95)} unit="ms" hint={`includes ${s.windowMs} ms batching window`} />
        <MetricTile label="Event → render p50" value={formatMs(s.renderP50)} unit="ms" hint={noView ? 'no live transcript mounted' : 'receive → React commit'} />
        <MetricTile
          label="Event → render p95"
          value={formatMs(s.renderP95)}
          unit="ms"
          tone={s.renderP95 > s.windowMs + 50 ? 'warning' : 'default'}
          hint={noView ? 'switch dataset to Live stream' : `${formatNumber(s.renderSamples)} samples`}
        />
      </Section>

      <Section title="Queue, batching & integrity" source="browser">
        <MetricTile label="Queue depth" value={formatNumber(s.queueDepth)} hint={`max ${formatNumber(s.maxQueueDepth)} / cap ${formatNumber(QUEUE_CAPACITY)}`} tone={s.queueDepth > QUEUE_CAPACITY * 0.8 ? 'danger' : 'default'} />
        <MetricTile label="Batch size" value={formatNumber(s.avgBatchSize, 1)} hint={`avg · last ${formatNumber(s.lastBatchSize)} · ${formatNumber(s.batches)} batches`} />
        <MetricTile label="Duplicates" value={formatNumber(s.duplicates)} tone={s.duplicates ? 'warning' : 'default'} hint={`${formatNumber(s.duplicateById)} by eventId · ${formatNumber(s.duplicateBySeq)} by seq`} />
        <MetricTile label="Out-of-order" value={formatNumber(s.outOfOrder)} hint={`reordered · ${formatNumber(s.reorderPending)} pending`} />
        <MetricTile label="Stale" value={formatNumber(s.stale)} hint="seq ≤ processed watermark" />
        <MetricTile label="Dropped" value={formatNumber(s.dropped)} tone={s.dropped ? 'danger' : 'default'} hint={`${formatNumber(s.queueDropped)} queue overflow · ${formatNumber(s.gapsSkipped)} gaps`} />
        <MetricTile label="Replay duplicates" value={formatNumber(s.replayDuplicates)} hint="resend after resume, discarded" />
        <MetricTile label="Last ACK sent" value={`#${formatNumber(s.lastAckSent)}`} hint={`processed #${formatNumber(s.lastProcessedSeq)}`} />
        <MetricTile label="Disconnects" value={formatNumber(s.disconnects)} hint={`${formatNumber(s.reconnectAttempts)} reconnect attempts`} />
        <MetricTile label="Last reconnect" value={formatMs(s.lastReconnectMs)} unit={s.lastReconnectMs !== null ? 'ms' : undefined} hint="drop → handshake" />
        <MetricTile
          label="Next retry"
          value={s.nextRetryInMs !== null ? formatMs(s.nextRetryInMs) : '—'}
          unit={s.nextRetryInMs !== null ? 'ms' : undefined}
          hint={s.outageRemainingMs !== null ? `outage ${formatMs(s.outageRemainingMs)} ms left (simulated)` : s.nextRetryCeilingMs !== null ? `jitter 0–${formatNumber(s.nextRetryCeilingMs)} ms` : 'exp. backoff + full jitter'}
        />
        <MetricTile label="Frames received" value={formatNumber(s.framesReceived)} hint="events + control frames" />
      </Section>

      <Section title="Server" source="server" note={srv ? `session ${s.sessionId ?? '—'} · ${srv.clients} client(s)` : 'No stats frame received yet.'}>
        <MetricTile label="Send rate" value={srv ? formatNumber(srv.sendRateLastSecond) : '—'} unit="frames/s" hint={srv ? `configured ${srv.config.rate}/s · ${srv.config.running ? 'running' : 'stopped'}` : undefined} />
        <MetricTile label="Sent to this tab" value={you ? formatNumber(you.sent) : '—'} hint={srv ? `${formatNumber(srv.sentTotal)} across all clients` : undefined} />
        <MetricTile label="Generated" value={srv ? formatNumber(srv.generatedTotal) : '—'} hint={srv ? `head seq #${formatNumber(srv.headSeq)}` : undefined} />
        <MetricTile label="Duplicates injected" value={srv ? formatNumber(srv.duplicatesInjected) : '—'} hint={srv ? `${formatNumber(srv.reorderedInjected)} reorders injected` : undefined} />
        <MetricTile label="Replayed on resume" value={srv ? formatNumber(srv.replayedTotal) : '—'} hint={srv ? `buffer ${formatNumber(srv.bufferedEvents)} from #${formatNumber(srv.oldestBufferedSeq)}` : undefined} />
        <MetricTile label="ACK seen by server" value={you ? `#${formatNumber(you.lastAckedSeq)}` : '—'} hint={you ? `socket buffer ${formatNumber(you.bufferedAmount)} B` : undefined} />
      </Section>

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={live.resetCounters}>
          Reset client counters
        </Button>
      </div>
    </div>
  );
}
