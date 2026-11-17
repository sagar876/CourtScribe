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
  await page.getByRole('link', { name: 'Connection & Reliability' }).click();
  await expect(banner).toBeVisible();
  await page.getByRole('link', { name: 'Recording controls' }).click();

  await panel.getByRole('button', { name: '■ Stop Recording' }).click();
  await expect(banner).toHaveCount(0);
  const saved = page.locator('[data-tour="recording-library"]').getByRole('listitem').first();
  const download = saved.getByRole('link', { name: 'Download original' });
  await expect(download).toHaveAttribute('download', /^CR-2026-00421_witness-deposition_.+\.(webm|ogg|m4a)$/);
  const size = await page.evaluate(async (href) => (await (await fetch(href)).blob()).size, (await download.getAttribute('href'))!);
  expect(size).toBeGreaterThan(0);

  expect(errors).toEqual([]);
});

