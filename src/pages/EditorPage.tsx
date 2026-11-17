import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useParams } from 'react-router';
import type { NoteRecord, NoteVersion } from '../../shared/documents.ts';
import { Button } from '../components/ui/Button.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Icon } from '../components/ui/Icon.tsx';
import { InfoTip } from '../components/ui/InfoTip.tsx';
import { openCollabSession, type CollabSession, type SyncStatus } from '../features/editor/collaboration.ts';
import { EditorToolbar } from '../features/editor/EditorToolbar.tsx';
import { notesService } from '../features/editor/notesService.ts';

const AUTO_VERSION_MS = 2 * 60_000;
const fmt = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STATUS_TEXT: Record<SyncStatus, { label: string; tone: string; detail: string }> = {
  saved: { label: 'Saved', tone: 'text-emerald-700', detail: 'Your changes are stored on this device and have been sent to the document server.' },
  saving: { label: 'Saving…', tone: 'text-slate-600', detail: 'Sending your latest changes to the document server.' },
  offline: { label: 'Offline — saved on this device', tone: 'text-amber-700', detail: 'The document server can’t be reached. Your changes are kept on this device and will be sent automatically when the connection is back.' },
  local: { label: 'Saved in this browser', tone: 'text-emerald-700', detail: 'Browser-only mode: changes are stored in this browser and shared with its other tabs only.' },
  failed: { label: 'Save failed', tone: 'text-red-700', detail: 'The last change could not be saved. Keep this tab open and try again.' },
};

function useSession(session: CollabSession) {
  const status = useSyncExternalStore(session.subscribe, session.getStatus);
  const participants = useSyncExternalStore(session.subscribe, session.getParticipants);
  return { status, participants };
}

function DocumentEditor({ note, session, onRenamed }: { note: NoteRecord; session: CollabSession; onRenamed: (n: NoteRecord) => void }) {
  const { status, participants } = useSession(session);
  const [title, setTitle] = useState(note.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  const [versionStatus, setVersionStatus] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<NoteVersion | null>(null);
  const changedSinceVersion = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
      TableKit.configure({ table: { resizable: false } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Collaboration.configure({ document: session.doc }),
      CollaborationCaret.configure({ provider: { awareness: session.awareness }, user: session.awareness.getLocalState()?.user as Record<string, unknown> }),
    ],
    editorProps: { attributes: { 'aria-label': `${note.title} — document text`, role: 'textbox', 'aria-multiline': 'true', spellcheck: 'true' } },
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) changedSinceVersion.current = true;
    },
  });

  const loadVersions = useCallback(() => {
    notesService.versions(note.id).then(setVersions, () => setVersionError('Version history could not be loaded.'));
  }, [note.id]);
  useEffect(loadVersions, [loadVersions]);

  const saveVersion = useCallback(
    async (kind: NoteVersion['kind'], content?: JSONContent) => {
      if (!editor) return false;
      setVersionError(null);
      try {
        await notesService.addVersion(note.id, { kind, title, content: content ?? editor.getJSON() });
        changedSinceVersion.current = false;
        setVersionStatus(kind === 'auto' ? `Automatic version saved ${new Date().toLocaleTimeString()}` : 'Version saved');
        loadVersions();
        return true;
      } catch (err) {
        setVersionError(err instanceof Error ? err.message : 'The version could not be saved.');
        return false;
      }
    },
    [editor, note.id, title, loadVersions],
  );

  // Periodic automatic versions, only when something changed.
  useEffect(() => {
    const t = setInterval(() => {
      if (changedSinceVersion.current) void saveVersion('auto');
    }, AUTO_VERSION_MS);
    return () => clearInterval(t);
  }, [saveVersion]);

  const restore = async (v: NoteVersion) => {
    if (!editor) return;
    // Keep the current text as a version first, so a restore can itself be undone.
    if (!(await saveVersion('before-restore'))) return;
    editor.commands.setContent((v.content as JSONContent) ?? { type: 'doc', content: [] });
    setConfirmRestore(null);
    setVersionStatus(`Restored the version from ${fmt(v.createdAt)}. The previous text was kept as a version.`);
  };

  const commitTitle = async () => {
    const t = title.trim();
    if (!t || t === note.title) return setTitle(note.title);
    try {
      onRenamed(await notesService.rename(note.id, t));
      setTitleError(null);
    } catch {
      setTitleError('The title could not be saved. Try again.');
    }
  };

  const st = STATUS_TEXT[status];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="doc-title" className="sr-only">
            Document title
          </label>
          <input
            id="doc-title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-full rounded-md border border-transparent px-1 text-xl font-semibold tracking-tight text-slate-900 hover:border-slate-200 focus:border-slate-300"
          />
          {titleError && <p className="text-xs text-red-700" role="alert">{titleError}</p>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className={st.tone} role="status" aria-live="polite">
            {st.label}
          </span>
          <InfoTip label="saving">{st.detail}</InfoTip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_300px]">
        <div className="cs-editor overflow-hidden rounded-lg border border-slate-200 bg-white">
          {editor && <EditorToolbar editor={editor} />}
          <EditorContent editor={editor} />
        </div>

        <div className="flex flex-col gap-4">
          <Card
            title="In this document"
            info="People with this document open right now. There is no sign-in in this prototype, so everyone appears as an unauthenticated guest with a random name for their browser tab — these are not verified identities."
          >
            <ul className="flex flex-col gap-1.5">
              {participants.map((p) => (
                <li key={p.clientId} className="flex items-center gap-2 text-sm text-slate-800">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} aria-hidden="true" />
                  {p.name}
                  {p.self && <span className="text-xs text-slate-500">(you)</span>}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Unauthenticated guests{session.mode === 'browser' ? ' · tabs of this browser only' : ''}</p>
          </Card>

          <Card title="Versions" info="Automatic versions are saved every two minutes while you edit. Save a version yourself before big changes. Restoring keeps the current text as a version first.">
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="primary" onClick={() => void saveVersion('manual')}>
                Save version
              </Button>
              {versionStatus && <p className="text-xs text-slate-600" role="status">{versionStatus}</p>}
              {versionError && <p className="text-xs text-red-700" role="alert">{versionError}</p>}
              {versions === null ? (
                <p className="text-xs text-slate-500">Loading…</p>
              ) : versions.length === 0 ? (
                <p className="text-xs text-slate-500">No versions yet.</p>
              ) : (
                <ul className="flex max-h-[360px] flex-col divide-y divide-slate-100 overflow-auto">
                  {versions.map((v) => (
                    <li key={v.id} className="flex flex-col gap-1 py-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-800">{fmt(v.createdAt)}</span>
                        <span className="text-slate-500">{v.kind === 'auto' ? 'Automatic' : v.kind === 'before-restore' ? 'Before restore' : 'Saved'}</span>
                      </div>
                      {confirmRestore?.id === v.id ? (
                        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Confirm restore">
                          <span className="text-xs text-amber-800">Replace the current text with this version?</span>
                          <Button size="sm" variant="primary" onClick={() => void restore(v)}>
                            Restore
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="self-start" onClick={() => setConfirmRestore(v)}>
                          Restore…
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export function EditorPage() {
  const { id } = useParams();
  const [note, setNote] = useState<NoteRecord | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [session, setSession] = useState<CollabSession | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    notesService.list().then(
      (all) => !cancelled && setNote(all.find((n) => n.id === id) ?? null),
      () => !cancelled && setLoadError(true),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!note) return;
    const s = openCollabSession(note.id);
    let cancelled = false;
    // Show the editor once locally saved content is loaded, so recovery after a crash is immediate.
    void s.ready.then(() => !cancelled && setSession(s));
    return () => {
      cancelled = true;
      setSession(null);
      s.destroy();
    };
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const back = (
    <Link to="/editor" className="inline-flex items-center gap-1 text-sm font-medium text-navy-900 underline-offset-2 hover:underline">
      <Icon name="chevronLeft" className="size-4" /> All documents
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      {back}
      {loadError ? (
        <p className="text-sm text-red-700" role="alert">
          The document could not be loaded. Check your connection and try again.
        </p>
      ) : note === null ? (
        <p className="text-sm text-slate-600">This document doesn’t exist or has been deleted.</p>
      ) : !note || !session ? (
        <p className="text-sm text-slate-500" role="status">
          Opening document…
        </p>
      ) : (
        <DocumentEditor key={note.id} note={note} session={session} onRenamed={setNote} />
      )}
    </div>
  );
}
