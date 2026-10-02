import { defineConfig } from '@playwright/test';
const port = Number(process.env.ARCADE_TEST_PORT || 4713);
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome' } },
    // WebKit peer tests need public STUN here; opt in to network-dependent checks.
    { name: 'webkit', testIgnore: process.env.ARCADE_NETWORK_TESTS ? undefined : '**/online.spec.js', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/game.html`,
    reuseExistingServer: false,
  },
});
