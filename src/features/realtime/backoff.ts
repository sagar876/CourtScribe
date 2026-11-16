export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 250, maxMs: 10_000 };

/**
 * Exponential backoff with "full jitter": a uniform random delay between 0 and
 * min(max, base * 2^attempt). Spreads reconnect storms across clients.
 */
export function backoffDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const ceiling = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt));
  return Math.round(random() * ceiling);
}

export function backoffCeiling(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
  return Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt));
}
