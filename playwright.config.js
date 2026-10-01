import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', channel: process.env.CI ? undefined : 'chrome' } },
    // WebKit peer tests need public STUN here; opt in to network-dependent checks.
    { name: 'webkit', testIgnore: process.env.ARCADE_NETWORK_TESTS ? undefined : '**/online.spec.js', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
