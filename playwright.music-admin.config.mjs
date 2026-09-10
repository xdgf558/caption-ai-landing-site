import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./scripts/music-admin-browser-tests',timeout:60000,workers:1,
  use:{baseURL:'http://127.0.0.1:4198',browserName:'chromium',viewport:{width:1280,height:900},trace:'retain-on-failure'},
  webServer:{command:'node scripts/serve-music-admin-preview.mjs',env:{MUSIC_ADMIN_PREVIEW_PORT:'4198'},port:4198,reuseExistingServer:false,timeout:30000}
});
