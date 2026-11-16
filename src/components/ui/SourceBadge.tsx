import { Badge, type Tone } from './Badge.tsx';

/** Where a number comes from. Every metric in the app carries one of these. */
export type MetricSource = 'browser' | 'server' | 'simulated';

const meta: Record<MetricSource, { label: string; tone: Tone; title: string }> = {
  browser: { label: 'Browser-measured', tone: 'info', title: 'Measured in this tab from real application behaviour.' },
  server: { label: 'Server-reported', tone: 'neutral', title: 'Reported by the local WebSocket server in its stats frames.' },
  simulated: { label: 'Simulated', tone: 'warning', title: 'Synthetic input or a simulated condition — not a real-world measurement.' },
};

export function SourceBadge({ source, compact = false }: { source: MetricSource; compact?: boolean }) {
  const m = meta[source];
  return (
    <Badge tone={m.tone} title={m.title}>
      {compact ? m.label.split('-')[0] : m.label}
    </Badge>
  );
}
