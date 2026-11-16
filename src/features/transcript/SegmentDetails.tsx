import { useSyncExternalStore } from 'react';
import type { TranscriptStore } from './TranscriptStore.ts';
import { formatTimestamp } from '../../lib/format.ts';
import { Button } from '../../components/ui/Button.tsx';

/** Subscribes to the store itself so the parent viewer doesn't re-render on every append. */
export function SegmentDetails({ store, selectedId, onClear }: { store: TranscriptStore; selectedId: string | null; onClear: () => void }) {
  useSyncExternalStore(store.subscribe, store.getVersion);
  const segment = selectedId ? store.get(selectedId) : undefined;
  if (!segment) {
    return <div className="border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-500">Select a segment to inspect it.</div>;
  }
  const fields = [
    ['Seq', `#${segment.sequenceNumber}`],
    ['ID', segment.id],
    ['Speaker', segment.speakerName],
    ['Time', `${formatTimestamp(segment.startTime, true)} → ${formatTimestamp(segment.endTime, true)}`],
    ['Duration', `${((segment.endTime - segment.startTime) / 1000).toFixed(1)} s`],
    ['Confidence', `${(segment.confidence * 100).toFixed(1)}% (synthetic)`],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs">
      {fields.map(([k, v]) => (
        <span key={k} className="whitespace-nowrap">
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
