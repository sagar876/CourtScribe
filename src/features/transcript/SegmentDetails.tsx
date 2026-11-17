import { useSyncExternalStore } from 'react';
import type { TranscriptStore } from './TranscriptStore.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { Button } from '../../components/ui/Button.tsx';

/** Subscribes to the store itself so the parent viewer doesn't re-render on every append. */
export function SegmentDetails({ store, selectedId, onClear }: { store: TranscriptStore; selectedId: string | null; onClear: () => void }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const segment = selectedId ? store.get(selectedId) : undefined;
  if (!segment) {
    return <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">Click a line to see its details.</div>;
  }
  // [label, value, diagnostic-only]
  const fields: [string, string, boolean][] = [
    ['Speaker', segment.speakerName, false],
    ['Time', `${formatTimestamp(segment.startTime, true)} → ${formatTimestamp(segment.endTime, true)}`, false],
    ['Duration', `${((segment.endTime - segment.startTime) / 1000).toFixed(1)} s`, false],
    ['Status', segment.isPartial ? 'Interim' : 'Final', false],
    ['Seq', `#${segment.sequenceNumber}`, true],
    ['ID', segment.id, true],
    ['Confidence', `${(segment.confidence * 100).toFixed(1)}%`, true],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
      {fields.map(([k, v, diagnostic]) => (
        <span key={k} className="whitespace-nowrap" data-diagnostic={diagnostic ? '' : undefined}>
          <span className="text-slate-500">{k} </span>
          <span className="tabular font-mono text-slate-800">{v}</span>
        </span>
      ))}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
