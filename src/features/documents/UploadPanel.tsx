import { useRef, useState } from 'react';
import { Button } from '../../components/ui/Button.tsx';
import { cn } from '../../lib/cn.ts';
import { formatBytes } from '../../lib/format.ts';
import { ALLOWED_EXTENSIONS } from '../../../shared/documents.ts';
import { MAX_UPLOAD_BYTES } from './config.ts';
import { uploadQueue, useUploads } from './documentsSession.ts';
import { ProgressBar } from './ProgressBar.tsx';
import type { UploadItem, UploadStatus } from './UploadQueue.ts';

const ACCEPT = Object.keys(ALLOWED_EXTENSIONS).map((e) => `.${e}`).join(',');

const LABEL: Record<UploadStatus, string> = {
  queued: 'Waiting',
  checking: 'Checking file…',
  duplicate: 'Already uploaded',
  uploading: 'Uploading',
  paused: 'Paused',
  completed: 'Uploaded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  rejected: 'Not uploaded',
};

function UploadRow({ item }: { item: UploadItem }) {
  const tone = item.status === 'completed' ? 'success' : item.status === 'failed' || item.status === 'rejected' ? 'danger' : item.status === 'paused' || item.status === 'duplicate' ? 'warning' : 'accent';
  const showBar = ['uploading', 'paused', 'completed', 'failed', 'checking'].includes(item.status);
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900" title={item.name}>
          {item.name}
        </span>
        <span className="tabular text-xs text-slate-600">
          {item.status === 'uploading' || item.status === 'paused' ? `${formatBytes(item.sent)} of ${formatBytes(item.size)}` : formatBytes(item.size)} · {LABEL[item.status]}
        </span>
      </div>
      {showBar && <ProgressBar value={item.status === 'checking' ? 0 : item.sent} max={item.size} label={`Upload progress for ${item.name}`} tone={tone} />}
      {item.resumedFrom !== undefined && item.status !== 'completed' && <p className="text-xs text-slate-600">Continued from {formatBytes(item.resumedFrom)} — an earlier attempt was resumed.</p>}
      {item.error && (
        <p className={cn('text-xs', item.status === 'failed' || item.status === 'rejected' ? 'text-red-700' : 'text-slate-600')} role={item.status === 'failed' || item.status === 'rejected' ? 'alert' : undefined}>
          {item.error}
        </p>
      )}
      {item.status === 'duplicate' && <p className="text-xs text-amber-800">An identical file is already in the library{item.duplicateOf ? ` (“${item.duplicateOf}”)` : ''}.</p>}
      <div className="flex flex-wrap gap-1.5">
        {item.status === 'uploading' && (
          <Button size="sm" onClick={() => uploadQueue.pause(item.id)}>
            Pause
          </Button>
        )}
        {item.status === 'paused' && (
          <Button size="sm" variant="primary" onClick={() => uploadQueue.resume(item.id)}>
            Resume
          </Button>
        )}
        {item.status === 'failed' && (
          <Button size="sm" variant="primary" onClick={() => uploadQueue.retry(item.id)}>
            Retry
          </Button>
        )}
        {item.status === 'duplicate' && (
          <Button size="sm" onClick={() => uploadQueue.uploadAnyway(item.id)}>
            Upload anyway
          </Button>
        )}
        {['queued', 'checking', 'uploading', 'paused', 'failed', 'duplicate'].includes(item.status) && (
          <Button size="sm" variant="ghost" onClick={() => void uploadQueue.cancel(item.id)}>
            {item.status === 'duplicate' ? 'Skip' : 'Cancel'}
          </Button>
        )}
      </div>
    </li>
  );
}

export function UploadPanel() {
  const items = useUploads();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const batch = items.filter((i) => !['rejected', 'cancelled'].includes(i.status));
  const total = batch.reduce((a, i) => a + i.size, 0);
  const sent = batch.reduce((a, i) => a + (i.status === 'completed' ? i.size : i.sent), 0);
  const running = items.some((i) => ['queued', 'checking', 'uploading'].includes(i.status));
  const done = batch.filter((i) => i.status === 'completed').length;

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          uploadQueue.add(e.dataTransfer.files);
        }}
        className={cn('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors', over ? 'border-accent-500 bg-accent-50' : 'border-slate-300 bg-slate-50')}
      >
        <p className="text-sm font-medium text-slate-800">Drag and drop case files here</p>
        <p className="text-xs text-slate-600">PDF, Word (DOC, DOCX), text (TXT) or images · up to {formatBytes(MAX_UPLOAD_BYTES)} each · several at once</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose files to upload"
          onChange={(e) => {
            if (e.target.files) uploadQueue.add(e.target.files);
            e.target.value = '';
          }}
        />
        <Button variant="primary" onClick={() => input.current?.click()}>
          Browse files
        </Button>
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-700" aria-live="polite">
              {running ? `Uploading ${done} of ${batch.length} files · ${formatBytes(sent)} of ${formatBytes(total)}` : `${done} of ${batch.length} files uploaded`}
            </p>
            {!running && (
              <Button size="sm" variant="ghost" onClick={() => uploadQueue.clearFinished()}>
                Clear finished
              </Button>
            )}
          </div>
          {running && <ProgressBar value={sent} max={total} label="Overall upload progress" />}
          <ul className="flex flex-col gap-2" aria-label="Uploads">
            {items.map((i) => (
              <UploadRow key={i.id} item={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
