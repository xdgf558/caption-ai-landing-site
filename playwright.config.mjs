import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/browser-tests',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4178',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 900 }
  },
  webServer: {
    command: 'node scripts/serve-cat-life-browser-test.mjs',
    port: 4178,
    reuseExistingServer: false,
    timeout: 10000
  }
});
