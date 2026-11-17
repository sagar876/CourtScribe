import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { makeWav, trackErrors } from './helpers.ts';

// Runs against the production build (vite preview): service worker, offline and deep links behave as deployed.
const PREVIEW = process.env.E2E_PREVIEW_URL ?? 'http://localhost:4173';
const fakeMic = join(tmpdir(), 'courtscribe-library-mic.wav');
writeFileSync(fakeMic, makeWav(30, 48_000));
test.use({ baseURL: PREVIEW, launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${fakeMic}`] } });

const panel = (page: Page) => page.locator('[data-tour="recording-panel"]');
const library = (page: Page) => page.locator('[data-tour="recording-library"]');
const items = (page: Page) => library(page).getByRole('list', { name: 'Saved recordings' }).getByRole('listitem');

async function record(page: Page, seconds: RegExp) {
  await panel(page).getByRole('button', { name: '● Start Recording' }).click();
  await expect(panel(page).getByLabel('Recording duration')).toHaveText(seconds, { timeout: 10_000 });
  await panel(page).getByRole('button', { name: '■ Stop Recording' }).click();
}

test('deep links and refresh work on the production build', async ({ page }) => {
  for (const path of ['/workspace', '/connection']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});

test('record → saved → refresh → play, seek, download original, rename, delete', async ({ page }) => {
  const errors = trackErrors(page);
  page.on('dialog', (d) => void d.accept());
  await page.goto('/workspace');
  await record(page, /00:0[3-9]/);
  await expect(items(page).first()).toContainText('✓ Saved in this browser'); // only after IndexedDB confirmed
  await expect(items(page).first()).toContainText('CR/2026/00421');
  await expect(items(page).first()).toContainText('SES-2026-11-16-WD-01');

  await page.reload();
  const item = items(page).first();
  await expect(item).toContainText('✓ Saved in this browser');
  const mime = (await item.locator('dd.font-mono').last().textContent())!;
  expect(mime).toMatch(/^audio\//);

  // Player: load, play, pause, seek, speed, volume.
  await item.getByRole('button', { name: 'Play', exact: true }).click();
  const player = library(page).getByRole('region', { name: /^Player:/ });
  await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });
  const seek = player.getByLabel('Seek');
  await expect(seek).toHaveAttribute('aria-valuetext', /of 00:0[3-9]/);
  await page.waitForTimeout(1_200);
  await player.getByRole('button', { name: 'Pause' }).click();
  await expect(player.getByRole('button', { name: 'Play' })).toBeVisible();
  const max = Number(await seek.getAttribute('max'));
  await seek.fill(String(max / 2));
  await expect(seek).toHaveAttribute('aria-valuetext', new RegExp(`^00:0${Math.floor(max / 2)} of`));
  await player.getByLabel('Speed').selectOption('1.5');
  await player.getByLabel('Volume').fill('0.4');

  // Download original: exactly the stored bytes, descriptive name, real format extension.
  const [download] = await Promise.all([page.waitForEvent('download'), item.getByRole('link', { name: 'Download original' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^CR-2026-00421_witness-deposition_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.(webm|ogg|m4a|aac)$/);
  const downloaded = readFileSync((await download.path())!);
  const stored = await page.evaluate(async (href) => Array.from(new Uint8Array(await (await fetch(href)).arrayBuffer())), (await item.getByRole('link', { name: 'Download original' }).getAttribute('href'))!);
  expect(Buffer.compare(downloaded, Buffer.from(stored))).toBe(0);
  await expect(item).toContainText('✓ Downloaded');

  // Rename persists.
  await item.getByRole('button', { name: 'Rename' }).click();
  await item.getByLabel('Recording name').fill('Cross-examination of PW-1');
  await item.getByRole('button', { name: 'Save name' }).click();
  await page.reload();
  await expect(items(page).first()).toContainText('Cross-examination of PW-1');

  // Delete asks first, then it is gone for good.
  await items(page).first().getByRole('button', { name: /^Delete/ }).click();
  await items(page).first().getByRole('group', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete' }).click();
  await expect(items(page)).toHaveCount(0);
  await page.reload();
  await expect(library(page).getByText('No saved recordings on this device yet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('saved recordings open and play offline (service worker + IndexedDB)', async ({ page, context }) => {
  await page.goto('/workspace');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // now controlled by the service worker
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await record(page, /00:0[2-9]/);
  await expect(items(page).first()).toContainText('✓ Saved in this browser');

  await context.setOffline(true);
  page.on('dialog', (d) => void d.accept());
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Courtroom' })).toBeVisible();
  await expect(items(page).first()).toContainText('✓ Saved in this browser');
  await items(page).first().getByRole('button', { name: 'Play', exact: true }).click();
  await expect(library(page).getByRole('region', { name: /^Player:/ }).getByRole('button', { name: 'Pause' })).toBeVisible({ timeout: 10_000 });
  // The transcript server is not needed for any of this.
  await expect(page.getByText('Disconnected').first()).toBeVisible();
  await context.setOffline(false);
});

test('an interrupted recording is offered for recovery and marked incomplete', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('/workspace');
  await panel(page).getByRole('button', { name: '● Start Recording' }).click();
  await expect(panel(page).getByLabel('Recording duration')).toHaveText(/00:0[3-9]/, { timeout: 10_000 });
  await page.reload(); // interrupt mid-recording
  const found = library(page).getByRole('group', { name: 'Interrupted recording' });
  await expect(found).toContainText('Interrupted recording found');
  await expect(items(page)).toHaveCount(0); // not presented as a finished recording
  await found.getByRole('button', { name: 'Recover recording' }).click();
  await expect(found).toHaveCount(0);
  await expect(items(page).first()).toContainText('Incomplete — recovered after an interruption');
  await expect(items(page).first()).toContainText('✓ Saved in this browser');
});

test('a full browser storage quota is reported, never shown as saved', async ({ page, context }) => {
  await page.goto('/workspace');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(PREVIEW).origin, quotaSize: 1 });
  await record(page, /00:0[2-9]/);
  await expect(panel(page).getByRole('alert').filter({ hasText: /could not be saved in this browser/ })).toBeVisible();
  await expect(items(page).first()).toContainText('Not saved — browser storage refused it');
  await expect(items(page).first()).not.toContainText('✓ Saved');
  await expect(items(page).first().getByRole('link', { name: 'Download original' })).toBeVisible(); // still downloadable now
  await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(PREVIEW).origin });
});
