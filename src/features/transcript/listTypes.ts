import type { TranscriptStore } from './TranscriptStore.ts';
import type { ViewerStats } from './renderStats.ts';

export interface ListHandle {
  scrollToIndex: (index: number) => void;
  /** The scrolling element (used to count mounted DOM rows). */
  element: () => HTMLElement | null;
}

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
  ref?: React.Ref<ListHandle>;
}
