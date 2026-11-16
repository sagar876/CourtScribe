/** 00:12:34 (or 00:12:34.5 with `tenths`) from milliseconds. */
export function formatTimestamp(ms: number, tenths = false): string {
  const total = Math.max(0, ms) / 1000;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const base = `${pad(h)}:${pad(m)}:${pad(s)}`;
  return tenths ? `${base}.${Math.floor((total * 10) % 10)}` : base;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Parses "hh:mm:ss", "mm:ss" or plain seconds into milliseconds; null when invalid. */
export function parseTimestamp(input: string): number | null {
  const parts = input.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
  let seconds = 0;
  for (const p of parts) seconds = seconds * 60 + Number(p);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

export function formatNumber(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatMs(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n < 10 ? n.toFixed(digits) : Math.round(n).toLocaleString('en-IN');
}
