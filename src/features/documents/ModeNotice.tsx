import { documentService } from './documentsSession.ts';

/** Says plainly where documents are stored, so browser-only mode is never mistaken for a server. */
export function ModeNotice() {
  if (documentService.mode === 'server') return null;
  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="note">
      <b>Browser-only mode:</b> no document server is connected, so files are stored in this browser only and are not shared with anyone. Uploads can be paused and resumed (also after a
      refresh, by adding the same file again), but this is local storage, not a server upload.
    </p>
  );
}
