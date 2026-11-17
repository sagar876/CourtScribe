import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { STATUS_INFO, type DocumentRecord, type DocumentStatus } from '../../../shared/documents.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { formatBytes } from '../../lib/format.ts';
import { saveBlob } from './DocumentService.ts';
import { documentLibrary, documentService, useDocumentLibrary } from './documentsSession.ts';
import { ProgressBar } from './ProgressBar.tsx';
import { StatusBadge } from './StatusBadge.tsx';
import { useDownload } from './useDownload.ts';

type SortKey = 'uploadedAt' | 'name' | 'size';
const TYPE_GROUPS: Record<string, string[]> = { PDF: ['pdf'], Word: ['doc', 'docx'], Text: ['txt'], Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tif', 'tiff'] };
const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function DocumentRow({ doc, selected, onToggle }: { doc: DocumentRecord; selected: boolean; onToggle: () => void }) {
  const { state, start, cancel } = useDownload();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr className="border-t border-slate-200 align-top">
      <td className="px-3 py-3">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${doc.name}`} className="size-4 accent-navy-900" />
      </td>
      <td className="max-w-[320px] px-3 py-3">
        <Link to={`/documents/${doc.id}`} className="font-medium break-words text-navy-900 underline-offset-2 hover:underline">
          {doc.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          {doc.sample && <Badge tone="warning">Sample data</Badge>}
          <span>{doc.extension.toUpperCase()}</span>
          <span>· {formatBytes(doc.size)}</span>
        </div>
        {doc.status === 'failed' && doc.error && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {doc.error}
          </p>
        )}
        {state.phase === 'downloading' && (
          <div className="mt-2 flex flex-col gap-1">
            <ProgressBar value={state.progress.received} max={state.progress.total} label={`Download progress for ${doc.name}`} />
            <span className="text-xs text-slate-600">
              Downloading {formatBytes(state.progress.received)} of {formatBytes(state.progress.total)}
              {state.progress.resumes > 0 && ` · connection dropped and resumed ${state.progress.resumes}×`}
            </span>
          </div>
        )}
        {state.phase === 'failed' && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {state.message}
          </p>
        )}
        {error && (
          <p className="mt-1 text-xs text-red-700" role="alert">
            {error}
          </p>
        )}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <StatusBadge status={doc.status} />
      </td>
      <td className="px-3 py-3 text-xs whitespace-nowrap text-slate-600">
        {fmtDate(doc.uploadedAt)}
        <div className="text-slate-500">changed {fmtDate(doc.modifiedAt)}</div>
      </td>
      <td className="px-3 py-3">
        {confirm ? (
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={`Confirm delete ${doc.name}`}>
            <span className="text-xs text-red-800">Delete permanently?</span>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => documentLibrary.remove(doc.id))}>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            <Link
              to={`/documents/${doc.id}`}
              className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              Open
            </Link>
            {state.phase === 'downloading' ? (
              <Button size="sm" onClick={cancel}>
                Cancel download
              </Button>
            ) : (
              <Button size="sm" onClick={() => void start(doc)}>
                {state.phase === 'failed' ? 'Retry download' : 'Download'}
              </Button>
            )}
            {doc.status === 'failed' && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => documentLibrary.reprocess(doc.id))}>
                Retry processing
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)} aria-label={`Delete ${doc.name}`}>
              Delete
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

export function DocumentLibraryTable() {
  const { documents, loading, error } = useDocumentLibrary();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState<'all' | DocumentStatus | 'processing-any'>('all');
  const [sort, setSort] = useState<SortKey>('uploadedAt');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [zipState, setZipState] = useState<{ phase: 'idle' | 'working' | 'failed'; received?: number; message?: string }>({ phase: 'idle' });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .filter((d) => type === 'all' || TYPE_GROUPS[type]?.includes(d.extension))
      .filter((d) => (status === 'all' ? true : status === 'processing-any' ? d.status !== 'available' && d.status !== 'failed' : d.status === status))
      .sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size : b.uploadedAt - a.uploadedAt));
  }, [documents, query, type, status, sort]);

  const chosen = visible.filter((d) => selected.has(d.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const downloadZip = async () => {
    setZipState({ phase: 'working', received: 0 });
    try {
      const blob = await documentService.zip(chosen.map((d) => d.id), (received) => setZipState({ phase: 'working', received }), new AbortController().signal);
      saveBlob(blob, `CR-2026-00421_documents_${new Date().toISOString().slice(0, 10)}.zip`);
      setZipState({ phase: 'idle' });
    } catch (err) {
      setZipState({ phase: 'failed', message: err instanceof Error ? err.message : 'The ZIP could not be created.' });
    }
  };

  const selectClass = 'h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
          Search
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Document name" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm font-normal tracking-normal normal-case" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
          Type
          <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
            <option value="all">All types</option>
            {Object.keys(TYPE_GROUPS).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={selectClass}>
            <option value="all">All statuses</option>
            <option value="available">{STATUS_INFO.available.label}</option>
            <option value="processing-any">In progress</option>
            <option value="failed">{STATUS_INFO.failed.label}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className={selectClass}>
            <option value="uploadedAt">Newest first</option>
            <option value="name">Name</option>
            <option value="size">Largest first</option>
          </select>
        </label>
      </div>

      {chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-accent-50 px-3 py-2 text-sm text-slate-800">
          {chosen.length} selected
          <Button size="sm" variant="primary" disabled={zipState.phase === 'working'} onClick={() => void downloadZip()}>
            {zipState.phase === 'working' ? `Preparing ZIP… ${formatBytes(zipState.received ?? 0)}` : 'Download as ZIP'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
          {zipState.phase === 'failed' && (
            <span className="text-xs text-red-700" role="alert">
              {zipState.message}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-slate-500" role="status">
          Loading documents…
        </p>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center" role="alert">
          <p className="text-sm text-red-700">{error}</p>
          <Button size="sm" onClick={() => void documentLibrary.refresh()}>
            Try again
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500">
          {documents.length === 0 ? 'No documents yet. Upload case files above.' : 'No documents match these filters.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Case documents</caption>
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all shown documents"
                    checked={visible.length > 0 && visible.every((d) => selected.has(d.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((d) => d.id)) : new Set())}
                    className="size-4 accent-navy-900"
                  />
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Document
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Uploaded
                </th>
                <th scope="col" className="px-3 py-2 font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((d) => (
                <DocumentRow key={d.id} doc={d} selected={selected.has(d.id)} onToggle={() => toggle(d.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
