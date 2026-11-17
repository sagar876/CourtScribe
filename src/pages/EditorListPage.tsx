import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { NoteRecord } from '../../shared/documents.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { PageHeader } from '../components/ui/PageHeader.tsx';
import { CASE } from '../features/case/caseSession.ts';
import { notesService } from '../features/editor/notesService.ts';

const fmt = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function EditorListPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(() => {
    notesService.list().then(setNotes, () => setError(notesService.mode === 'server' ? 'The document server could not be reached. Check your connection and try again.' : 'Documents could not be read from this browser.'));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setCreating(true);
    try {
      const note = await notesService.create(title || 'Untitled document');
      void navigate(`/editor/${note.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The document could not be created.');
      setCreating(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await notesService.remove(id);
      setConfirmId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The document could not be deleted.');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow={CASE.reference} title="Editor" description="Write orders, notes and summaries. These are separate from uploaded documents, which stay unchanged." />
      {notesService.mode === 'browser' && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="note">
          <b>Browser-only mode:</b> documents are saved in this browser. Other tabs of this browser can edit together, but nothing is shared with other computers.
        </p>
      )}
      <Card
        title="New document"
        info="Creates an empty document. It is saved automatically as you type; you can also save named versions and restore earlier ones."
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[11px] font-medium tracking-wide text-slate-600 uppercase">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Order on bail application" className="h-9 rounded-md border border-slate-300 px-2.5 text-sm font-normal tracking-normal normal-case" />
          </label>
          <Button type="submit" variant="primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create document'}
          </Button>
        </form>
      </Card>
      <Card title="Documents">
        {error && (
          <div className="mb-3 flex items-center gap-2 text-sm text-red-700" role="alert">
            {error}
            <Button
              size="sm"
              onClick={() => {
                setError(null);
                load();
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {notes === null && !error ? (
          <p className="text-sm text-slate-500" role="status">
            Loading…
          </p>
        ) : notes?.length === 0 ? (
          <p className="rounded-md border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500">No documents yet. Create one above.</p>
        ) : (
          <ul className="divide-y divide-slate-200">
            {notes?.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <Link to={`/editor/${n.id}`} className="font-medium break-words text-navy-900 underline-offset-2 hover:underline">
                    {n.title}
                  </Link>
                  <div className="text-xs text-slate-600">Last changed {fmt(n.modifiedAt)}</div>
                </div>
                {confirmId === n.id ? (
                  <div className="flex items-center gap-1.5" role="group" aria-label={`Confirm delete ${n.title}`}>
                    <span className="text-xs text-red-800">Delete this document and all its versions?</span>
                    <Button size="sm" variant="danger" onClick={() => void remove(n.id)}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-1.5">
                    <Link to={`/editor/${n.id}`} className="inline-flex h-8 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-800 hover:bg-slate-50">
                      Open
                    </Link>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${n.title}`} onClick={() => setConfirmId(n.id)}>
                      Delete
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
