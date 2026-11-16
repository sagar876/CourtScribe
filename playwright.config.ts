import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Tests share the stream server's global simulator state, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  use: {
    // Point at an already running dev server with E2E_BASE_URL; never start a second one alongside it.
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    // Use the locally installed Chrome; no browser download needed.
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'npm run dev',
    url: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
