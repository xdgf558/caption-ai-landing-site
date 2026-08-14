import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [productSource, pageSource, librarySource, workerSource, migrationSource, sitemapSource] = await Promise.all([
  read('../src/data/products/station-points.ts'),
  read('../src/components/StationPointsPage.astro'),
  read('../src/pages/library/index.astro'),
  read('../src/worker.js'),
  read('../migrations/0028_station_points.sql'),
  read('../public/sitemap.xml')
]);

assert.match(productSource, /points:\s*100/);
assert.match(productSource, /priceAmount:\s*10/);
assert.match(productSource, /priceCurrency:\s*'USD'/);
assert.match(productSource, /billingType:\s*'one-time'/);

assert.match(pageSource, /100 Station 積分/);
assert.match(pageSource, /100 Station Points/);
assert.match(pageSource, /一次性購買 · 無自動續費/);
assert.match(pageSource, /One-time purchase · No automatic renewal/);
assert.match(pageSource, /未標示的軟體不包含在內/);
assert.match(pageSource, /Unmarked software is not included/);
assert.match(productSource, /brodstem@protonmail\.com/);

assert.match(librarySource, /100 Station 積分 · 10 美元/);
assert.match(librarySource, /查看公開價格與積分規則/);
assert.match(workerSource, /const novelCreditUnitLabel = 'Station Points'/);
assert.match(workerSource, /\{ credits: 100, priceAmount: 10, priceCurrency: 'USD', label: '100 Station Points' \}/);
assert.doesNotMatch(workerSource, /label: '10 SC Credits'/);
assert.doesNotMatch(workerSource, /label: '50 SC Credits'/);

assert.match(migrationSource, /UPDATE reader_credit_accounts/);
assert.match(migrationSource, /100 Station Points/);
assert.match(sitemapSource, /https:\/\/wwwstationcat\.org\/zh-hant\/points\//);
assert.match(sitemapSource, /https:\/\/wwwstationcat\.org\/points\//);

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE reader_credit_accounts (
    account_id INTEGER PRIMARY KEY,
    currency_label TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE admin_content_settings (
    setting_key TEXT PRIMARY KEY,
    setting_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO reader_credit_accounts (account_id, currency_label) VALUES (1, 'SC Credits');
  INSERT INTO admin_content_settings (setting_key, setting_json) VALUES (
    'content.pricing-defaults.v1',
    '{"accessLevel":"paid","pricing":{"chapterCredits":1,"creditPacks":[{"credits":10,"label":"10 SC Credits","priceAmount":1,"priceCurrency":"USD"}]}}'
  );
`);
db.exec(migrationSource);

const migratedAccount = db.prepare('SELECT currency_label FROM reader_credit_accounts WHERE account_id = 1').get();
assert.equal(migratedAccount.currency_label, 'Station Points');
const migratedSettings = JSON.parse(
  db.prepare("SELECT setting_json FROM admin_content_settings WHERE setting_key = 'content.pricing-defaults.v1'").get().setting_json
);
assert.equal(migratedSettings.pricing.chapterCredits, 1);
assert.deepEqual(migratedSettings.pricing.creditPacks, [
  { credits: 100, label: '100 Station Points', priceAmount: 10, priceCurrency: 'USD' }
]);
db.close();

console.log('Station Points pricing and compatibility checks passed.');
