import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { STATUS_INFO, STATUS_ORDER, type DocumentRecord } from '../../shared/documents.ts';
import { Badge } from '../components/ui/Badge.tsx';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { KeyValueGrid } from '../components/ui/KeyValueGrid.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { formatBytes } from '../lib/format.ts';
import { documentLibrary, documentService, useDocumentLibrary } from '../features/documents/documentsSession.ts';
import { PdfViewer } from '../features/documents/PdfViewer.tsx';
import { ProgressBar } from '../features/documents/ProgressBar.tsx';
import { StatusBadge } from '../features/documents/StatusBadge.tsx';
import { useDownload } from '../features/documents/useDownload.ts';

const fmt = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const IMAGE = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

function TextPreview({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => !cancelled && setText(t))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) return <p className="text-sm text-red-700" role="alert">The text could not be loaded. Try again, or download the file.</p>;
  if (text === null) return <p className="text-sm text-slate-500" role="status">Loading…</p>;
  // Rendered as plain text (never as HTML).
  return <pre className="max-h-[70vh] overflow-auto rounded-md border border-slate-200 bg-white p-4 font-mono text-sm whitespace-pre-wrap text-slate-800">{text}</pre>;
}

function Preview({ doc }: { doc: DocumentRecord }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let release = () => {};
    let cancelled = false;
    documentService.previewUrl(doc).then(
      (p) => {
        if (cancelled) return p.release();
        release = p.release;
        setUrl(p.url);
      },
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
      release();
    };
  }, [doc]);

  if (doc.status === 'failed') return <p className="text-sm text-slate-600">This document failed validation, so it is not previewed. {doc.error}</p>;
  if (error) return <p className="text-sm text-red-700" role="alert">The preview could not be loaded.</p>;
  if (!url) return <p className="text-sm text-slate-500" role="status">Loading preview…</p>;
  if (doc.extension === 'pdf') return <PdfViewer url={url} name={doc.name} />;
  if (doc.extension === 'txt') return <TextPreview url={url} />;
  if (IMAGE.includes(doc.extension))
    return (
      <div className="flex flex-col gap-2">
        <img src={url} alt={`Preview of ${doc.name}`} className="mx-auto max-h-[70vh] rounded-md border border-slate-200 object-contain" />
        <p className="text-xs text-slate-600">Text inside images is not searchable — that would need OCR, which is not available in this prototype.</p>
      </div>
    );
  return (
    <p className="rounded-md bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
      {doc.extension.startsWith('doc') ? 'Word documents can’t be previewed in the browser yet. Download the file to open it in Word.' : 'This file type can’t be previewed. Download it to open it.'}
    </p>
  );
}

export function DocumentDetailPage() {
  const { id } = useParams();
  const { documents, loading, error } = useDocumentLibrary();
  const doc = documents.find((d) => d.id === id);
  const { state, start, cancel } = useDownload();
  const [retrying, setRetrying] = useState(false);

  const back = (
    <Link to="/documents" className="inline-flex items-center gap-1 text-sm font-medium text-navy-900 underline-offset-2 hover:underline">
      <Icon name="chevronLeft" className="size-4" /> All documents
    </Link>
  );

  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-sm text-slate-600" role={loading ? 'status' : 'alert'}>
          {loading ? 'Loading document…' : error ? error : 'This document doesn’t exist or has been deleted.'}
        </p>
      </div>
    );
  }

  const reached = new Map(doc.history.map((h) => [h.status, h]));
  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        eyebrow={doc.sample ? 'Sample data — not a real case' : doc.extension.toUpperCase()}
        title={doc.name}
        description={`${formatBytes(doc.size)} · uploaded ${fmt(doc.uploadedAt)}`}
        actions={
          state.phase === 'downloading' ? (
            <Button onClick={cancel}>Cancel download</Button>
          ) : (
            <Button variant="primary" icon={<Icon name="download" />} onClick={() => void start(doc)}>
              {state.phase === 'failed' ? 'Retry download' : 'Download'}
            </Button>
          )
        }
      />
      {state.phase === 'downloading' && (
        <div className="flex flex-col gap-1">
          <ProgressBar value={state.progress.received} max={state.progress.total} label="Download progress" />
          <span className="text-xs text-slate-600">
            {formatBytes(state.progress.received)} of {formatBytes(state.progress.total)}
            {state.progress.resumes > 0 && ` · resumed ${state.progress.resumes}× after the connection dropped`}
          </span>
        </div>
      )}
      {state.phase === 'failed' && <p className="text-sm text-red-700" role="alert">{state.message}</p>}

      <Card title="Preview" bodyClassName="p-4">
        <Preview doc={doc} />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Details">
          <KeyValueGrid
            items={[
              { label: 'Status', value: <StatusBadge status={doc.status} /> },
              { label: 'Type', value: `${doc.extension.toUpperCase()} (${doc.mimeType})` },
              { label: 'Size', value: formatBytes(doc.size) },
              { label: 'Last changed', value: fmt(doc.modifiedAt) },
              { label: 'Stored', value: documentService.mode === 'server' ? 'Document server' : 'This browser only' },
              { label: 'SHA-256', value: <span className="font-mono text-xs break-all">{doc.sha256}</span> },
            ]}
          />
          {doc.sample && (
            <div className="mt-3">
              <Badge tone="warning">Sample data</Badge>
            </div>
          )}
        </Card>
        <Card title="Processing" info="Validation is real. Processing, text extraction and indexing are simulated in this prototype; each step’s note says what happened.">
          <ol className="flex flex-col gap-2.5">
            {(doc.status === 'failed' ? doc.history.map((h) => h.status) : STATUS_ORDER).map((s, i) => {
              const h = reached.get(s);
              return (
                <li key={`${s}-${i}`} className="flex gap-3 text-sm">
                  <span className={h ? (s === 'failed' ? 'text-red-600' : 'text-emerald-600') : 'text-slate-300'} aria-hidden="true">
                    {h ? (s === 'failed' ? '✕' : '●') : '○'}
                  </span>
                  <div>
                    <div className={h ? 'font-medium text-slate-900' : 'text-slate-500'}>
                      {STATUS_INFO[s].label}
                      {h && <span className="ml-2 text-xs font-normal text-slate-500">{fmt(h.at)}</span>}
                    </div>
                    {h?.note && <p className="text-xs text-slate-600">{h.note}</p>}
                  </div>
                </li>
              );
            })}
          </ol>
          {doc.status === 'failed' && (
            <Button
              className="mt-3"
              size="sm"
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                void documentLibrary.reprocess(doc.id).finally(() => setRetrying(false));
              }}
            >
              Retry processing
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
