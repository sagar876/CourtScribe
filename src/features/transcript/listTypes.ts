import type { TranscriptStore } from './TranscriptStore.ts';
import type { ViewerStats } from './renderStats.ts';
import type { SearchResult } from './useTranscriptSearch.ts';

export interface ListHandle {
  scrollToIndex: (index: number) => void;
  /** The scrolling element (used to count mounted DOM rows). */
  element: () => HTMLElement | null;
}

/**
 * What the transcript needs from a media player. Structural, so the
 * transcript feature does not depend on the audio feature.
 */
export interface PlaybackSync {
  subscribeActive: (listener: () => void) => () => void;
  getActiveId: () => string | null;
  /** Returns false when nothing is loaded or `ms` is beyond the recording. */
  seekMs: (ms: number) => boolean;
}

export const noopSubscribe = () => () => {};
export const getNoActive = (): string | null => null;

export interface TranscriptListProps {
  store: TranscriptStore;
  live: boolean;
  activeIndex: number;
  selectedId: string | null;
  matches: Int32Array;
  currentMatchRow: number;
  query: string;
  onSelect: (id: string, index: number) => void;
  stats: ViewerStats;
  playback?: PlaybackSync;
  ref?: React.Ref<ListHandle>;
}

/** Mutable read-only window into a mounted viewer, polled by dashboards (never triggers renders). */
export interface ViewerProbe {
  store: TranscriptStore | null;
  list: ListHandle | null;
  search: SearchResult | null;
}

export const createViewerProbe = (): ViewerProbe => ({ store: null, list: null, search: null });
