import { expect, test } from '@playwright/test';
import { trackErrors } from './helpers.ts';

const labHeading = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1, name: 'Connection & Reliability' });
const workspaceHeading = (page: import('@playwright/test').Page) => page.getByRole('heading', { level: 1, name: 'Courtroom' });
const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Primary' });

test('Connection & Reliability navigation: sidebar, URL, refresh, direct load, back/forward', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(workspaceHeading(page)).toBeVisible();

  // Sidebar click → page, URL and active state
  await nav(page).getByRole('link', { name: 'Connection & Reliability' }).click();
  await expect(page).toHaveURL(/\/connection$/);
  await expect(labHeading(page)).toBeVisible();
  await expect(nav(page).getByRole('link', { name: 'Connection & Reliability' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('radiogroup', { name: 'Network condition' })).toBeVisible();

  // Refresh keeps the page (no 404)
  await page.reload();
  await expect(labHeading(page)).toBeVisible();

  // Back to the workspace, then forward again
  await nav(page).getByRole('link', { name: 'Courtroom' }).click();
  await expect(workspaceHeading(page)).toBeVisible();
  await page.goBack();
  await expect(labHeading(page)).toBeVisible();
  await page.goBack();
  await expect(workspaceHeading(page)).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/connection$/);
  await expect(labHeading(page)).toBeVisible();

  // Direct URL in a fresh load
  await page.goto('/connection');
  await expect(labHeading(page)).toBeVisible();
  // Unknown routes fall back to the workspace
  await page.goto('/does-not-exist');
  await expect(page).toHaveURL(/\/workspace$/);
  expect(errors).toEqual([]);
});

test('Connection & Reliability navigation on a phone-sized screen uses the drawer', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog', { name: 'Navigation' }).getByRole('link', { name: 'Connection & Reliability' }).click();
  await expect(labHeading(page)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Navigation' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a page whose code cannot load explains itself instead of breaking the app', async ({ page }) => {
  // Simulates a stale tab after a rebuild: the lazily loaded Connection & Reliability chunk is gone.
  await page.route(/ConnectionLabPage/, (route) => route.abort());
  await page.goto('/workspace');
  await nav(page).getByRole('link', { name: 'Connection & Reliability' }).click();
  // First failure → one automatic reload; the chunk still fails → explanation with a reload button.
  await expect(page.getByRole('alert').filter({ hasText: 'This page needs a refresh' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  // The rest of the app still works.
  await nav(page).getByRole('link', { name: 'Courtroom' }).click();
  await expect(workspaceHeading(page)).toBeVisible();
});
