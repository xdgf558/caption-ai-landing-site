import { defineConfig } from '@playwright/test';
import articleConfig from './playwright.articles.config.mjs';

// Reuse the built-site preview; payment endpoints are mocked by this suite.
export default defineConfig({ ...articleConfig, testDir: './scripts/payment-browser-tests' });
