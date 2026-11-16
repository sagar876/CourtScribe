import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { makeWav, trackErrors } from './helpers.ts';

// Chrome's fake microphone (auto-granted) reading from a generated file — no real hardware or prompt.
const fakeMic = join(tmpdir(), 'courtscribe-fake-mic.wav');
writeFileSync(fakeMic, makeWav(20, 48_000));
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fakeMic}`] } });

test('audio recording: explicit start, pause/resume, indicator across pages, stop and download', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/workspace');
  const panel = page.locator('[data-tour="recording-panel"]');
  const banner = page.getByText('Recording audio');

  // Nothing is captured until the user presses Start.
  await expect(panel.getByRole('status').first()).toHaveText('Not recording');
  await expect(banner).toHaveCount(0);

  await panel.getByRole('button', { name: '● Start Recording' }).click();
  await expect(panel.getByRole('status').first()).toHaveText('Recording');
  await expect(banner).toBeVisible();
  await expect(panel.getByLabel('Recording duration')).toHaveText(/00:0[2-9]/, { timeout: 8_000 });

  await panel.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Recording paused').first()).toBeVisible();
  const pausedAt = await panel.getByLabel('Recording duration').textContent();
  await page.waitForTimeout(1_500);
  await expect(panel.getByLabel('Recording duration')).toHaveText(pausedAt!);
  await panel.getByRole('button', { name: 'Resume' }).click();

  // The transcript stream is independent and the indicator follows the user to other pages.
  await page.getByRole('link', { name: 'Performance Lab' }).click();
  await expect(banner).toBeVisible();
  await expect(page.locator('[data-metric="Recording state"] span.font-mono')).toHaveText('recording');
  await page.getByRole('link', { name: 'Recording controls' }).click();

  await panel.getByRole('button', { name: '■ Stop Recording' }).click();
  await expect(banner).toHaveCount(0);
  const download = panel.getByRole('link', { name: 'Download' });
  await expect(download).toHaveAttribute('download', /^CR-2026-00421_witness-deposition_.+\.(webm|ogg|m4a)$/);
  const size = await page.evaluate(async (href) => (await (await fetch(href)).blob()).size, (await download.getAttribute('href'))!);
  expect(size).toBeGreaterThan(0);

  // Played back in the workspace player with a real duration.
  await panel.getByRole('button', { name: 'Play in player' }).click();
  await expect(page.getByLabel('Playback position')).not.toHaveText(/\/ 00:00:00\.0$/);
  expect(errors).toEqual([]);
});

test('recordings survive reloads until downloaded or discarded; an interrupted one is recovered', async ({ page }) => {
  const errors = trackErrors(page);
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.accept(); // leave the page
  });
  await page.goto('/workspace');
  const panel = page.locator('[data-tour="recording-panel"]');
  const items = panel.getByRole('listitem');

  // A finished, not-yet-downloaded recording: leaving warns, and it is still there afterwards.
  await panel.getByRole('button', { name: '● Start Recording' }).click();
  await expect(panel.getByLabel('Recording duration')).toHaveText(/00:0[2-9]/, { timeout: 8_000 });
  await panel.getByRole('button', { name: '■ Stop Recording' }).click();
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Not downloaded yet');
  await page.reload();
  expect(dialogs).toContain('beforeunload');
  await expect(items).toHaveCount(1);
  await expect(panel.getByText(/not been downloaded yet was restored/)).toBeVisible();

  // Downloading marks it, and then leaving no longer warns.
  const [download] = await Promise.all([page.waitForEvent('download'), items.first().getByRole('link', { name: 'Download' }).click()]);
  expect((await download.path()) && download.suggestedFilename()).toMatch(/^CR-2026-00421_witness-deposition_/);
  await expect(items.first()).toContainText('✓ Downloaded');
  dialogs.length = 0;
  await page.reload();
  expect(dialogs).toEqual([]);
  await expect(items.first()).toContainText('✓ Downloaded');

  // Reloading in the middle of a recording keeps the audio captured so far.
  await panel.getByRole('button', { name: '● Start Recording' }).click();
  await expect(panel.getByLabel('Recording duration')).toHaveText(/00:0[3-9]/, { timeout: 8_000 });
  await page.reload();
  expect(dialogs).toContain('beforeunload');
  await expect(panel.getByText(/Recovered a recording/)).toBeVisible();
  const recovered = items.filter({ hasText: 'recovered after the page was reloaded or closed' });
  await expect(recovered).toHaveCount(1);
  await expect(panel.getByRole('status').first()).toHaveText('Not recording'); // never restarts by itself
  const size = await page.evaluate(async (href) => (await (await fetch(href)).blob()).size, (await recovered.getByRole('link', { name: 'Download' }).getAttribute('href'))!);
  expect(size).toBeGreaterThan(1_000);

  // Discard asks first, then removes it permanently.
  await recovered.getByRole('button', { name: /^Discard/ }).click();
  await expect(recovered.getByText('Not downloaded — delete permanently?')).toBeVisible();
  await recovered.getByRole('button', { name: 'Delete' }).click();
  await expect(items).toHaveCount(1);
  await page.reload();
  await expect(items).toHaveCount(1);
  expect(errors).toEqual([]);
});
