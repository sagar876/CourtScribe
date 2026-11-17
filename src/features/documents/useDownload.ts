import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentRecord } from '../../../shared/documents.ts';
import { saveBlob, type DownloadProgress } from './DocumentService.ts';
import { documentService } from './documentsSession.ts';

export type DownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; progress: DownloadProgress }
  | { phase: 'done' }
  | { phase: 'cancelled' }
  | { phase: 'failed'; message: string };

/** Download with progress, cancel, retry and integrity verification; saves under the original name. */
export function useDownload() {
  const [state, setState] = useState<DownloadState>({ phase: 'idle' });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (doc: DocumentRecord) => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setState({ phase: 'downloading', progress: { received: 0, total: doc.size, resumes: 0 } });
    try {
      const blob = await documentService.download(doc, (progress) => setState({ phase: 'downloading', progress }), c.signal);
      saveBlob(blob, doc.name);
      setState({ phase: 'done' });
    } catch (err) {
      if (c.signal.aborted) return setState({ phase: 'cancelled' });
      setState({ phase: 'failed', message: err instanceof Error ? err.message : 'The download failed.' });
    }
  }, []);

  const cancel = useCallback(() => controller.current?.abort(), []);
  return { state, start, cancel };
}
