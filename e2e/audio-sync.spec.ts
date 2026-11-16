import { expect, test } from '@playwright/test';
import { makeWav, trackErrors } from './helpers.ts';

test('audio playback syncs with a 100K-segment transcript and handles bad files', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/workspace');
  const fileInput = page.locator('input[type=file]');
  const readout = page.getByLabel('Playback position');

  // Unsupported file → clear error, nothing loaded
  await fileInput.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not audio') });
  await expect(page.getByText('“notes.txt” is not an audio file.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeDisabled();

  // 100K recorded session: only a handful of rows are mounted
  await page.getByRole('radio', { name: 'Recorded · 100K' }).click();
  await expect(page.locator('[data-transcript-row]').first()).toBeVisible();
  expect(await page.locator('[data-transcript-row]').count()).toBeLessThan(100);

  // Load a generated 60 s recording
  await fileInput.setInputFiles({ name: 'hearing.wav', mimeType: 'audio/wav', buffer: makeWav(60) });
  await expect(readout).toHaveText(/\/ 00:01:00\.0$/);
  await expect(page.getByRole('button', { name: 'Play' })).toBeEnabled();

  // Clicking a segment seeks to its start time and makes it active
  const row = page.locator('[data-transcript-row]').nth(4);
  const start = (await row.locator('span.font-mono').first().textContent())!;
  await row.click();
  await expect(readout).toHaveText(new RegExp(`^${start}\\.\\d`));
  await expect(row).toHaveClass(/shadow-amber-500/);
  await expect(page.getByText(/^Active segment #5 ·/)).toBeVisible();

  // Playback advances time and moves the active segment
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await page.getByText(/^Active segment #\d+/).textContent())?.match(/#(\d+)/)?.[1], { timeout: 15_000 }).not.toBe('5');
  await page.getByRole('button', { name: 'Pause' }).click();

  // Jumping past the end of the recording is refused with a notice
  await page.getByPlaceholder('hh:mm:ss').fill('10:00:00');
  await page.getByRole('button', { name: 'Go' }).click();
  await expect(page.getByText(/after the end of this recording/)).toBeVisible();

  expect(errors).toEqual([]);
});
