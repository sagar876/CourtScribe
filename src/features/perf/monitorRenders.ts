import { useLayoutEffect } from 'react';

let commits = 0;

/** Counts commits of monitoring UI components, so the dashboard can report its own render cost. */
export function useMonitorCommit(): void {
  useLayoutEffect(() => {
    commits++;
  });
}

export const readMonitorCommits = (): number => commits;
