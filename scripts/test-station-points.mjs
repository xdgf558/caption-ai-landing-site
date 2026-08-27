import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [productSource, pageSource, librarySource, workerSource, migrationSource, sitemapSource] = await Promise.all([
  read('../src/data/products/station-points.ts'),
  read('../src/components/StationPointsPage.astro'),
  read('../src/components/ReaderLibraryPage.astro'),
  read('../src/worker.js'),
  read('../migrations/0028_station_points.sql'),
  read('../public/sitemap.xml')
]);

assert.match(productSource, /statusEndpoint:\s*'\/api\/novels\/payments\/status'/);
assert.doesNotMatch(productSource, /priceAmount:/);
assert.doesNotMatch(productSource, /priceCurrency:/);
assert.doesNotMatch(pageSource, /100 Station (積分|Points)/);
assert.match(pageSource, /一次性購買 · 無自動續費/);
assert.match(pageSource, /One-time purchase · No automatic renewal/);
assert.match(pageSource, /未標示的軟體不包含在內/);
assert.match(pageSource, /Unmarked software is not included/);
assert.match(pageSource, /fetch\(config\.statusEndpoint/);
assert.match(pageSource, /data\.publicCheckoutEnabled === true/);
assert.doesNotMatch(pageSource, /chapters, titles/);
assert.doesNotMatch(pageSource, /章節、作品/);
assert.match(productSource, /brodstem@protonmail\.com/);

assert.match(librarySource, /查看公開價格與積分規則/);
assert.doesNotMatch(librarySource, /100 Station 積分 · 10 美元/);
assert.match(librarySource, /locale:\s*readerLocale/);
assert.match(librarySource, /returnPath:\s*readerLibraryPath/);
assert.doesNotMatch(librarySource, /payCurrency:/);
assert.match(productSource, /en:\s*'\/en\/library\/'/);
assert.match(productSource, /ja:\s*'\/ja\/library\/'/);
assert.match(productSource, /zhHant:\s*'\/zh-hant\/library\/'/);
assert.match(productSource, /zhHans:\s*'\/zh-hans\/library\/'/);
assert.match(workerSource, /const novelCreditUnitLabel = 'Station Points'/);
assert.match(workerSource, /\{ credits: 100, priceAmount: 10, priceCurrency: 'USD', label: '100 Station Points' \}/);
assert.doesNotMatch(workerSource, /label: '10 SC Credits'/);
assert.doesNotMatch(workerSource, /label: '50 SC Credits'/);
assert.match(workerSource, /checkout\.orderType === novelCreditPackOrderType && !useCreem/);

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

class D1Statement {
  constructor(database, sql, params = []) {
    this.database = database;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new D1Statement(this.database, this.sql, params);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.params) || null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.params) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(result.changes || 0) }, success: true };
  }
}

class D1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new D1Statement(this.database, sql);
  }
}

const pricingDb = new DatabaseSync(':memory:');
pricingDb.exec(`
  CREATE TABLE admin_content_settings (
    setting_key TEXT PRIMARY KEY,
    setting_json TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO admin_content_settings (setting_key, setting_json) VALUES (
    'content.pricing-defaults.v1',
    '{"accessLevel":"paid","pricing":{"chapterCredits":3,"creditPacks":[{"credits":240,"label":"240 Station Points","priceAmount":17,"priceCurrency":"USD"}]}}'
  );
`);
const d1 = new D1Database(pricingDb);
const paymentEnv = {
  WAITLIST_DB: d1,
  CREEM_MODE: 'production',
  CREEM_API_KEY: 'live-api-key',
  CREEM_WEBHOOK_SECRET: 'live-webhook-secret',
  CREEM_CREDIT_PACK_PRODUCT_ID: 'prod_station_points_test',
  CREEM_CREDIT_PACK_CREDITS: '240',
  CREEM_CREDIT_PACK_PRICE_USD: '17'
};
const statusResponse = await hooks.handleNovelPaymentsStatus(
  new Request('https://wwwstationcat.org/api/novels/payments/status'),
  paymentEnv
);
const publicStatus = await statusResponse.json();
assert.equal(publicStatus.publicCheckoutEnabled, true);
assert.equal(publicStatus.provider, 'creem');
assert.deepEqual(publicStatus.supportedCurrencies, ['USD']);
assert.deepEqual(publicStatus.readerCredits.packs, [
  { credits: 240, label: '240 Station Points', priceAmount: '17.00', priceCurrency: 'USD' }
]);
const checkoutPack = await hooks.findConfiguredReaderCreditPack(d1, paymentEnv, 240);
assert.equal(Number(checkoutPack.priceAmount).toFixed(2), publicStatus.readerCredits.packs[0].priceAmount);
assert.equal(checkoutPack.priceCurrency, publicStatus.readerCredits.packs[0].priceCurrency);

pricingDb.prepare(`UPDATE admin_content_settings SET setting_json = ? WHERE setting_key = ?`).run(
  '{"accessLevel":"paid","pricing":{"chapterCredits":3,"creditPacks":[{"credits":300,"label":"300 Station Points","priceAmount":21,"priceCurrency":"USD"}]}}',
  'content.pricing-defaults.v1'
);
const updatedStatus = await (await hooks.handleNovelPaymentsStatus(
  new Request('https://wwwstationcat.org/api/novels/payments/status'),
  paymentEnv
)).json();
const updatedCheckoutPack = await hooks.findConfiguredReaderCreditPack(d1, paymentEnv, 300);
assert.equal(updatedStatus.readerCredits.packs[0].priceAmount, '21.00');
assert.equal(updatedCheckoutPack.priceAmount, 21);

pricingDb.prepare(`UPDATE admin_content_settings SET setting_json = ? WHERE setting_key = ?`).run(
  '{"accessLevel":"paid","pricing":{"chapterCredits":3,"creditPacks":[]}}',
  'content.pricing-defaults.v1'
);
const stoppedStatus = await (await hooks.handleNovelPaymentsStatus(
  new Request('https://wwwstationcat.org/api/novels/payments/status'),
  paymentEnv
)).json();
assert.equal(stoppedStatus.publicCheckoutEnabled, false);
assert.equal(stoppedStatus.readerCredits.enabled, false);
assert.deepEqual(stoppedStatus.readerCredits.packs, []);
const stoppedCredits = await (await hooks.handleReaderCredits(
  new Request('https://wwwstationcat.org/api/readers/credits'),
  paymentEnv
)).json();
assert.equal(stoppedCredits.checkoutEnabled, false);
assert.deepEqual(stoppedCredits.packs, []);
await assert.rejects(
  hooks.findConfiguredReaderCreditPack(d1, paymentEnv, 100),
  (error) => error?.code === 'CREDIT_PACK_NOT_AVAILABLE'
);

pricingDb.prepare(`UPDATE admin_content_settings SET setting_json = ? WHERE setting_key = ?`).run(
  '{"accessLevel":"paid","pricing":{"chapterCredits":3,"creditPacks":[{"credits":300,"label":"300 Station Points","priceAmount":21,"priceCurrency":"USD"}]}}',
  'content.pricing-defaults.v1'
);
const creditsWithoutPayment = await (await hooks.handleReaderCredits(
  new Request('https://wwwstationcat.org/api/readers/credits'),
  { WAITLIST_DB: d1 }
)).json();
assert.equal(creditsWithoutPayment.ok, true);
assert.equal(creditsWithoutPayment.authenticated, false);
assert.equal(creditsWithoutPayment.checkoutEnabled, false);
assert.equal(creditsWithoutPayment.packs.length, 1);
const creditsWithOnlyNowPayments = await (await hooks.handleReaderCredits(
  new Request('https://wwwstationcat.org/api/readers/credits'),
  {
    WAITLIST_DB: d1,
    NOWPAYMENTS_API_KEY: 'test-api-key',
    NOWPAYMENTS_IPN_SECRET: 'test-ipn-secret'
  }
)).json();
assert.equal(creditsWithOnlyNowPayments.checkoutEnabled, false);
assert.match(librarySource, /renderCreditPacks\(data\.packs \|\| \[\], data\.checkoutEnabled === true\)/);

const unavailableStatus = await (await hooks.handleNovelPaymentsStatus(
  new Request('https://wwwstationcat.org/api/novels/payments/status'),
  { NOWPAYMENTS_API_KEY: 'test-api-key', NOWPAYMENTS_IPN_SECRET: 'test-ipn-secret' }
)).json();
assert.equal(unavailableStatus.publicCheckoutEnabled, false);
assert.equal(unavailableStatus.readerCredits.enabled, false);
assert.equal(unavailableStatus.provider, 'creem');
assert.deepEqual(unavailableStatus.supportedCurrencies, ['USD']);
pricingDb.close();

console.log('Station Points pricing and compatibility checks passed.');
