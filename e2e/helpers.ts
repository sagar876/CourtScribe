import type { Page } from '@playwright/test';

/** Collects uncaught page errors and console errors for a test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // Failed WebSocket attempts are logged by the browser itself; the app handles them.
    if (m.type() === 'error' && !/WebSocket connection to/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Value text of a metric tile, located by its label. */
export function tileValue(page: Page, label: string) {
  return page.locator(`[data-metric="${label}"] span.font-mono`).first();
}

/** A small mono 16-bit PCM WAV generated in memory (no audio asset is stored in the repo). */
export function makeWav(seconds: number, sampleRate = 8_000): Buffer {
  const n = seconds * sampleRate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.3 * 32767), 44 + i * 2);
  return b;
}
