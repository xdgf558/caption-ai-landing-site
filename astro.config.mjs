import { defineConfig } from 'astro/config';

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: 'https://wwwstationcat.org',
  trailingSlash: 'always',
  adapter: cloudflare()
});