import { expect, test } from '@playwright/test';
import { tileValue, trackErrors } from './helpers.ts';

test('live transcript workflow: connect, stream, search, measure, navigate', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/workspace');

  // Case details
  for (const text of ['CR/2026/00421', 'District Court, Ernakulam', 'Witness Deposition', 'Malayalam']) await expect(page.getByText(text).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export' })).toBeDisabled();

  // Connect and stream
  await page.getByRole('button', { name: 'Connect live feed' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Connected/ })).toBeVisible();
  await page.getByRole('button', { name: 'Start feed' }).click();
  try {
    const rows = page.locator('[data-transcript-row]');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByText(/\d[\d,]* segments ·/)).toBeVisible();

    // Search while updates keep arriving (Web Worker)
    await page.getByPlaceholder(/Search speaker or text/).fill('Exhibit');
    await expect(page.getByText(/^\d[\d,]* \/ \d[\d,]*$/)).toBeVisible();
    await expect(page.locator('mark').first()).toBeVisible();

    // Performance Lab sees the same live session
    await page.getByRole('link', { name: 'Performance Lab' }).click();
    await expect(page.getByRole('heading', { name: 'Performance Lab' })).toBeVisible();
    await page.getByRole('radio', { name: 'Live stream' }).click();
    await expect.poll(async () => Number((await tileValue(page, 'Events per second').textContent())?.replace(/,/g, '')), { timeout: 10_000 }).toBeGreaterThan(0);
    // The overview polls at 4 Hz, so wait for it to read the newly mounted live viewer.
    const mountedRows = async () => Number((await tileValue(page, 'Rendered rows').textContent())?.replace(/,/g, ''));
    await expect.poll(mountedRows).toBeGreaterThan(0);
    expect(await mountedRows()).toBeLessThan(100); // virtualised

    // Repeated navigation must not leak page-scoped resources.
    for (let i = 0; i < 5; i++) {
      await page.getByRole('link', { name: 'Workspace' }).click();
      await expect(page.getByRole('heading', { name: 'Courtroom Workspace' })).toBeVisible();
      await page.getByRole('link', { name: 'Performance Lab' }).click();
      await expect(page.getByRole('heading', { name: 'Performance Lab' })).toBeVisible();
    }
  } finally {
    await page.getByRole('button', { name: 'Stop simulator' }).click().catch(() => {});
    await page.getByRole('button', { name: 'Disconnect' }).first().click().catch(() => {});
  }
  expect(errors).toEqual([]);
});
