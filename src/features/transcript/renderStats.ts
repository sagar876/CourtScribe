/**
 * Mutable render counters. Written from layout effects (one increment per real
 * commit, never per discarded render) and read by the benchmark display on a
 * timer, so measuring renders never causes renders.
 */
export interface ViewerStats {
  rowCommits: number;
  listCommits: number;
  lastCommitMs: number;
  totalCommitMs: number;
  profiledCommits: number;
}

export function createViewerStats(): ViewerStats {
  return { rowCommits: 0, listCommits: 0, lastCommitMs: NaN, totalCommitMs: 0, profiledCommits: 0 };
}

export function resetViewerStats(s: ViewerStats): void {
  Object.assign(s, createViewerStats());
}
