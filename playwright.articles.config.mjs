import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/article-browser-tests',
  timeout: 30000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4183', browserName: 'chromium', viewport: { width: 1280, height: 900 } },
  webServer: { command: 'node scripts/serve-article-preview.mjs', env: { ARTICLE_PREVIEW_PORT: '4183' }, port: 4183, reuseExistingServer: false, timeout: 10000 }
});
