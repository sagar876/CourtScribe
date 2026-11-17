import { useEffect, useState } from 'react';
import { MetricTile } from '../../components/ui/MetricTile.tsx';
import { formatBytes } from '../../lib/format.ts';
import { transferStats } from '../documents/transferStats.ts';

const POLL_MS = 500;

interface Storage {
  usage: number;
  quota: number;
  persisted: boolean | null;
}

/** Real transfer and storage measurements from this browser (no simulated values). */
export function TransferOverview() {
  const [t, setT] = useState(() => transferStats.snapshot());
  const [storage, setStorage] = useState<Storage | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setT(transferStats.snapshot()), POLL_MS);
    const readStorage = async () => {
      if (!navigator.storage?.estimate) return;
      const e = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      setStorage({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted });
    };
    void readStorage();
    const slow = setInterval(() => void readStorage(), 5_000);
    return () => {
      clearInterval(tick);
      clearInterval(slow);
    };
  }, []);

  const pct = storage && storage.quota > 0 ? (storage.usage / storage.quota) * 100 : 0;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile
        label="Upload speed"
        value={t.activeUploads > 0 || t.uploadBytesPerSecond > 0 ? `${formatBytes(t.uploadBytesPerSecond)}/s` : '—'}
        hint={`${formatBytes(t.uploadedBytes)} sent this visit`}
        info="Bytes confirmed by the document server (or written to this browser in browser-only mode) per second, measured from upload progress. Upload files on the Documents page — uploads keep running while you look at this page."
      />
      <MetricTile
        label="Active uploads"
        value={String(t.activeUploads)}
        hint="Up to 2 files upload at once; the rest wait"
        info="Files sending right now. Paused, waiting and finished uploads are not counted."
      />
      <MetricTile
        label="Download progress"
        value={t.activeDownloads > 0 ? `${formatBytes(t.downloadReceived)}` : '—'}
        hint={t.activeDownloads > 0 ? `${t.activeDownloads} active · ${formatBytes(t.downloadBytesPerSecond)}/s` : 'No download running'}
        info="Bytes received for document downloads in progress, and the current speed. If a connection drops, downloads continue from the last received byte."
      />
      <MetricTile
        label="Browser storage used"
        value={storage ? formatBytes(storage.usage) : 'Not available'}
        hint={storage ? `${pct < 0.1 ? '<0.1' : pct.toFixed(1)}% of ${formatBytes(storage.quota)} allowed${storage.persisted ? ' · protected from automatic clearing' : ''}` : undefined}
        tone={pct > 80 ? 'warning' : 'default'}
        info="Space this site uses in the browser: audio recordings, recovery copies of unfinished recordings, editor drafts and — in browser-only mode — uploaded documents. The browser reports an estimate. When it nears the limit, new recordings or documents may fail to save."
      />
    </div>
  );
}
