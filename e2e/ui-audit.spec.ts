import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWav, trackErrors } from './helpers.ts';
import { auditPage } from './ui-audit.ts';

const VIEWPORTS = [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
] as const;
const ROUTES = [
  ['workspace', '/workspace', 'Courtroom Workspace'],
  ['performance-lab', '/performance-lab', 'Performance Lab'],
] as const;
const SHOTS = 'test-results/screens';
process.env.FAKE_MIC = join(tmpdir(), 'courtscribe-audit-mic.wav');
writeFileSync(process.env.FAKE_MIC, makeWav(30, 48_000));
// Chrome's fake microphone (auto-granted) so recording states can be audited without hardware.
test.use({ launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${process.env.FAKE_MIC}`] } });
mkdirSync(SHOTS, { recursive: true });

for (const [w, h] of VIEWPORTS) {
  for (const [name, path, heading] of ROUTES) {
    test(`UI audit ${name} @ ${w}×${h}`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${SHOTS}/${name}-${w}x${h}.png`, fullPage: true });
      const findings = await auditPage(page);
      if (findings.length) console.log(`\n[${name} ${w}×${h}]\n` + findings.map((f) => `  ${f.kind}: ${f.detail}`).join('\n'));
      expect(findings).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

// Stateful screens: the same checks while recording (fake microphone) and while the live feed streams.
test.describe('UI audit in active states', () => {
  for (const [w, h] of [[1440, 900], [1024, 768], [390, 844]] as const) {
    test(`workspace recording + live feed @ ${w}×${h}`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/workspace');
      const panel = page.locator('[data-tour="recording-panel"]');
      await panel.getByRole('button', { name: '● Start Recording' }).click();
      await expect(panel.getByRole('button', { name: 'Pause' })).toBeVisible();
      await page.getByRole('button', { name: 'Connect live feed' }).click();
      await page.getByRole('button', { name: 'Start feed' }).click();
      await expect(page.locator('[data-transcript-row]').first()).toBeVisible();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/workspace-active-${w}x${h}.png` });
      const findings = await auditPage(page);
      await page.getByRole('button', { name: 'Stop feed' }).click();
      await page.getByRole('button', { name: 'Disconnect' }).first().click();
      await panel.getByRole('button', { name: '■ Stop Recording' }).click();
      await expect(panel.getByRole('link', { name: 'Download' })).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/workspace-stopped-${w}x${h}.png` });
      findings.push(...(await auditPage(page)));
      if (findings.length) console.log(`\n[active ${w}×${h}]\n` + findings.map((f) => `  ${f.kind}: ${f.detail}`).join('\n'));
      expect(findings).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
});
