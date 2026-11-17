/** Minimal inline stroke icons (no icon dependency). */
const paths = {
  workspace: 'M3 5h18v14H3zM3 9h18M8 9v10',
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3',
  scale: 'M12 4v16M6 8h12M6 8l-3 6h6zM18 8l-3 6h6zM9 20h6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronUp: 'M6 15l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  check: 'M5 12l5 5 9-10',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  plug: 'M9 3v5M15 3v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  document: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  waveform: 'M4 12h2M8 8v8M12 5v14M16 9v6M20 12h0',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'size-4' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}
