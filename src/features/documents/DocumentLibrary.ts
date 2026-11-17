import type { DocumentRecord } from '../../../shared/documents.ts';
import type { DocumentService } from './DocumentService.ts';

export interface LibraryState {
  documents: DocumentRecord[];
  loading: boolean;
  error: string | null;
}

const BUSY_POLL_MS = 1_000;

/** Document list with polling while anything is still being processed. */
export class DocumentLibrary {
  private state: LibraryState = { documents: [], loading: true, error: null };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly service: DocumentService) {}

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    if (this.listeners.size === 1) void this.refresh();
    return () => {
      this.listeners.delete(l);
      if (this.listeners.size === 0 && this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    };
  };

  getSnapshot = () => this.state;

  refresh(): Promise<void> {
    this.inFlight ??= (async () => {
      try {
        const documents = await this.service.list();
        this.set({ documents, loading: false, error: null });
      } catch {
        this.set({
          loading: false,
          error:
            this.service.mode === 'server'
              ? 'The document server could not be reached, so documents cannot be shown right now. Check your connection and try again.'
              : 'Documents could not be read from this browser’s storage.',
        });
      } finally {
        this.inFlight = null;
        this.schedule();
      }
    })();
    return this.inFlight;
  }

  async remove(id: string): Promise<void> {
    await this.service.remove(id);
    this.set({ documents: this.state.documents.filter((d) => d.id !== id) });
  }

  async reprocess(id: string): Promise<void> {
    await this.service.reprocess(id);
    await this.refresh();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.listeners.size === 0) return;
    const busy = this.state.documents.some((d) => d.status !== 'available' && d.status !== 'failed');
    if (busy) this.timer = setTimeout(() => void this.refresh(), BUSY_POLL_MS);
  }

  private set(patch: Partial<LibraryState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }
}
