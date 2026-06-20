import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const genericFailure = { ok: false, message: hooks.readerTotpResetFailureMessage };

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }

  bind(...params) {
    this.params = params;
    return this;
  }

  first() {
    return this.db.first(this.sql, this.params);
  }

  run() {
    return this.db.run(this.sql, this.params);
  }

  all() {
    return Promise.resolve({ results: [] });
  }
}

class FakeD1 {
  constructor(options = {}) {
    this.ready = {
      passwordCredentials: options.passwordCredentialsReady !== false,
      totpCredentials: options.totpCredentialsReady !== false,
      totpResetAttempts: options.totpResetAttemptsReady !== false
    };
    this.accounts = new Map();
    this.accountsByEmail = new Map();
    this.accountsByUsername = new Map();
    this.tokensByHash = new Map();
    this.attempts = new Map();
    this.cleanupRuns = 0;
    this.passwordUpdates = 0;
    this.revokedSessions = 0;
    this.sessions = [];
  }

  addAccount(account = {}) {
    const row = {
      id: account.id || 1,
      email: account.email || 'reader@example.com',
      normalized_email: account.normalizedEmail || account.email || 'reader@example.com',
      display_name: account.displayName || 'Reader',
      created_at: account.createdAt || '2026-06-20 00:00:00',
      username: account.username || 'reader',
      totp: account.totp || null
    };
    row.normalized_email = row.normalized_email.toLowerCase();
    row.normalized_username = row.username.toLowerCase();
    this.accounts.set(row.id, row);
    this.accountsByEmail.set(row.normalized_email, row);
    this.accountsByUsername.set(row.normalized_username, row);
    return row;
  }

  addResetToken(tokenHash, token = {}) {
    const account = this.accounts.get(token.accountId || 1);
    const row = {
      id: token.id || 1,
      account_id: account.id,
      email: account.email,
      normalized_email: account.normalized_email,
      display_name: account.display_name,
      created_at: account.created_at,
      username: account.username,
      consumed: false
    };
    this.tokensByHash.set(tokenHash, row);
    return row;
  }

  prepare(sql) {
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  assertReady(name, table) {
    if (!this.ready[name]) throw new Error(`no such table: ${table}`);
  }

  attemptKey(scope, key) {
    return `${scope}:${key}`;
  }

  credentialForAccount(accountId) {
    const account = this.accounts.get(Number(accountId));
    if (!account?.totp) return null;
    return {
      account_id: account.id,
      secret_base32: account.totp.secretBase32 || rfcSecret,
      enabled_at: account.totp.enabled ? '2026-06-20 00:00:00' : null,
      disabled_at: account.totp.disabled ? '2026-06-20 00:00:00' : null,
      last_used_step: account.totp.lastUsedStep ?? null
    };
  }

  accountResetRow(account) {
    if (!account) return null;
    const credential = this.credentialForAccount(account.id) || {};
    return {
      id: account.id,
      email: account.email,
      normalized_email: account.normalized_email,
      display_name: account.display_name,
      created_at: account.created_at,
      username: account.username,
      secret_base32: credential.secret_base32 || null,
      enabled_at: credential.enabled_at || null,
      disabled_at: credential.disabled_at || null,
      last_used_step: credential.last_used_step ?? null
    };
  }

  async first(sql, params) {
    if (/SELECT id FROM reader_password_credentials LIMIT 1/.test(sql)) {
      this.assertReady('passwordCredentials', 'reader_password_credentials');
      return { id: 1 };
    }
    if (/SELECT id FROM reader_totp_credentials LIMIT 1/.test(sql)) {
      this.assertReady('totpCredentials', 'reader_totp_credentials');
      return { id: 1 };
    }
    if (/SELECT id FROM reader_totp_reset_attempts LIMIT 1/.test(sql)) {
      this.assertReady('totpResetAttempts', 'reader_totp_reset_attempts');
      return { id: 1 };
    }
    if (/FROM reader_totp_reset_attempts/.test(sql)) {
      const [scope, key] = params;
      return this.attempts.get(this.attemptKey(scope, key)) || null;
    }
    if (/FROM reader_login_tokens/.test(sql)) {
      const row = this.tokensByHash.get(params[0]);
      return row && !row.consumed ? { ...row } : null;
    }
    if (/WHERE reader_accounts\.normalized_email = \?/.test(sql)) {
      return this.accountResetRow(this.accountsByEmail.get(String(params[0]).toLowerCase()));
    }
    if (/WHERE reader_password_credentials\.normalized_username = \?/.test(sql)) {
      return this.accountResetRow(this.accountsByUsername.get(String(params[0]).toLowerCase()));
    }
    if (/FROM reader_totp_credentials\s+WHERE account_id = \?/.test(sql)) {
      const credential = this.credentialForAccount(params[0]);
      return credential ? { ...credential } : null;
    }
    throw new Error(`Unhandled first SQL: ${sql}`);
  }

  async run(sql, params) {
    if (/DELETE FROM reader_totp_reset_attempts\s+WHERE id IN/.test(sql)) {
      this.cleanupRuns += 1;
      return { meta: { changes: 0 } };
    }
    if (/INSERT INTO reader_totp_reset_attempts/.test(sql)) {
      const [scope, key, nowEpoch] = params;
      const attemptKey = this.attemptKey(scope, key);
      const existing = this.attempts.get(attemptKey) || {
        scope,
        scope_key: key,
        failure_count: 0,
        locked_until_epoch: 0,
        last_failed_epoch: 0
      };
      existing.failure_count += 1;
      existing.last_failed_epoch = nowEpoch;
      this.attempts.set(attemptKey, existing);
      return { meta: { changes: 1 } };
    }
    if (/UPDATE reader_totp_reset_attempts\s+SET locked_until_epoch/.test(sql)) {
      const [lockedUntil, scope, key, minimumLockedUntil] = params;
      const attempt = this.attempts.get(this.attemptKey(scope, key));
      if (attempt && Number(attempt.locked_until_epoch || 0) < Number(minimumLockedUntil)) {
        attempt.locked_until_epoch = lockedUntil;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (/DELETE FROM reader_totp_reset_attempts\s+WHERE scope = \? AND scope_key = \?/.test(sql)) {
      const [scope, key] = params;
      const deleted = this.attempts.delete(this.attemptKey(scope, key));
      return { meta: { changes: deleted ? 1 : 0 } };
    }
    if (/UPDATE reader_totp_credentials\s+SET last_used_step = \?/.test(sql)) {
      const [step, accountId, minimumStep] = params;
      const account = this.accounts.get(Number(accountId));
      const credential = account?.totp;
      if (!credential?.enabled || credential.disabled) return { meta: { changes: 0 } };
      const lastUsedStep = credential.lastUsedStep ?? null;
      if (lastUsedStep !== null && Number(lastUsedStep) >= Number(minimumStep)) {
        return { meta: { changes: 0 } };
      }
      credential.lastUsedStep = step;
      return { meta: { changes: 1 } };
    }
    if (/UPDATE reader_password_credentials\s+SET password_hash/.test(sql)) {
      this.passwordUpdates += 1;
      return { meta: { changes: 1 } };
    }
    if (/UPDATE reader_sessions\s+SET revoked_at/.test(sql)) {
      this.revokedSessions += 1;
      return { meta: { changes: 1 } };
    }
    if (/UPDATE reader_login_tokens\s+SET consumed_at/.test(sql)) {
      const tokenId = params[0];
      for (const token of this.tokensByHash.values()) {
        if (token.id === tokenId) token.consumed = true;
      }
      return { meta: { changes: 1 } };
    }
    if (/UPDATE reader_accounts\s+SET last_login_at/.test(sql)) {
      return { meta: { changes: 1 } };
    }
    if (/INSERT INTO reader_sessions/.test(sql)) {
      this.sessions.push({ accountId: params[0], sessionHash: params[1] });
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unhandled run SQL: ${sql}`);
  }
}

const resetRequest = (body, headers = {}) =>
  new Request('https://wwwstationcat.org/api/readers/password-reset/confirm', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.42',
      'user-agent': 'reader-test',
      ...headers
    },
    body: JSON.stringify(body)
  });

const parseJson = async (response) => ({
  status: response.status,
  body: await response.json()
});

let invalidTotpCode = '111111';

const resetBody = (overrides = {}) => ({
  identifier: 'reader@example.com',
  totpCode: invalidTotpCode,
  password: 'new-password-123',
  confirmPassword: 'new-password-123',
  ...overrides
});

assert.equal(await hooks.hotpCode(rfcSecret, 0), '755224');
assert.equal(await hooks.hotpCode(rfcSecret, 1), '287082');
assert.equal(hooks.normalizeTotpCode(' 123 456 '), '123456');
assert.equal(hooks.timingSafeEqualString('123456', '123456'), true);
assert.equal(hooks.timingSafeEqualString('123456', '123457'), false);

const roundTripBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
assert.deepEqual([...hooks.base32ToBytes(hooks.bytesToBase32(roundTripBytes))], [...roundTripBytes]);

const currentStep = hooks.getTotpStep();
const currentCode = await hooks.hotpCode(rfcSecret, currentStep);
invalidTotpCode = currentCode === invalidTotpCode ? '222222' : invalidTotpCode;
const verified = await hooks.verifyTotpCode(rfcSecret, currentCode, { windowSize: 0 });
assert.equal(verified.ok, true);
assert.equal(verified.step, currentStep);

const reused = await hooks.verifyTotpCode(rfcSecret, currentCode, {
  windowSize: 0,
  lastUsedStep: currentStep
});
assert.equal(reused.ok, false);
assert.equal(reused.reason, 'reused-code');

assert.equal(hooks.getD1ChangeCount({ meta: { changes: 1 } }), 1);
assert.equal(hooks.getD1ChangeCount({ changes: 2 }), 2);
assert.equal(hooks.readerTotpResetFailureMessage, genericFailure.message);

const sameIpDifferentUaA = await hooks.getRequestClientHashes(
  resetRequest({}, { 'user-agent': 'agent-a' })
);
const sameIpDifferentUaB = await hooks.getRequestClientHashes(
  resetRequest({}, { 'user-agent': 'agent-b' })
);
assert.equal(sameIpDifferentUaA.ipHash, sameIpDifferentUaB.ipHash);
assert.notEqual(sameIpDifferentUaA.ipUaHash, sameIpDifferentUaB.ipUaHash);

const identifierHash = await hooks.sha256Hex('reader@example.com');
const limitKeys = hooks.getReaderTotpResetLimitKeys({
  identifierHash,
  ipHash: sameIpDifferentUaA.ipHash,
  ipUaHash: sameIpDifferentUaA.ipUaHash
});
assert.equal(limitKeys.some((limitKey) => limitKey.key.includes('reader@example.com')), false);
assert.equal(limitKeys.some((limitKey) => limitKey.key.includes(identifierHash)), true);

const cleanupDb = new FakeD1();
await hooks.reserveReaderTotpResetAttempt(cleanupDb, limitKeys, 1, { cleanup: false });
assert.equal(cleanupDb.cleanupRuns, 0);
await hooks.reserveReaderTotpResetAttempt(cleanupDb, limitKeys, 1, { cleanup: true });
assert.equal(cleanupDb.cleanupRuns, 1);

const missingAttemptsDb = new FakeD1({ totpResetAttemptsReady: false });
let response = await hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), {
  WAITLIST_DB: missingAttemptsDb
});
let parsed = await parseJson(response);
assert.equal(parsed.status, 503);
assert.equal(parsed.body.code, 'READER_TOTP_RESET_ATTEMPTS_NOT_READY');

const readyDb = new FakeD1();
response = await hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), { WAITLIST_DB: readyDb });
parsed = await parseJson(response);
assert.equal(parsed.status, 401);
assert.deepEqual(parsed.body, genericFailure);
assert.equal(
  [...readyDb.attempts.values()].some((attempt) => attempt.scope_key.includes('reader@example.com')),
  false
);

const unboundDb = new FakeD1();
unboundDb.addAccount({ totp: { enabled: false } });
response = await hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), { WAITLIST_DB: unboundDb });
const unboundParsed = await parseJson(response);

const wrongCodeDb = new FakeD1();
wrongCodeDb.addAccount({ totp: { enabled: true, secretBase32: rfcSecret } });
response = await hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), { WAITLIST_DB: wrongCodeDb });
const wrongCodeParsed = await parseJson(response);

assert.equal(unboundParsed.status, 401);
assert.equal(wrongCodeParsed.status, 401);
assert.deepEqual(unboundParsed.body, genericFailure);
assert.deepEqual(wrongCodeParsed.body, genericFailure);

const limitedDb = new FakeD1();
limitedDb.addAccount({ totp: { enabled: true, secretBase32: rfcSecret } });
const failureStatuses = [];
for (let index = 0; index < hooks.readerTotpResetFailureThreshold + 1; index += 1) {
  response = await hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), { WAITLIST_DB: limitedDb });
  failureStatuses.push(response.status);
}
assert.deepEqual(failureStatuses.slice(0, hooks.readerTotpResetFailureThreshold), [401, 401, 401, 401, 401]);
assert.equal(failureStatuses.at(-1), 429);
assert.equal([...limitedDb.attempts.values()].some((attempt) => attempt.failure_count > 5), true);

const parallelDb = new FakeD1();
parallelDb.addAccount({ totp: { enabled: true, secretBase32: rfcSecret } });
const parallelResponses = await Promise.all(
  Array.from({ length: 20 }, () =>
    hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), { WAITLIST_DB: parallelDb })
  )
);
const parallelStatuses = parallelResponses.map((item) => item.status);
assert.equal(
  parallelStatuses.filter((status) => status === 401).length <= hooks.readerTotpResetFailureThreshold,
  true
);
assert.equal(parallelStatuses.filter((status) => status === 429).length >= 15, true);
assert.equal(Math.max(...[...parallelDb.attempts.values()].map((attempt) => attempt.failure_count)) >= 20, true);

const successDb = new FakeD1();
successDb.addAccount({ totp: { enabled: true, secretBase32: rfcSecret } });
for (let index = 0; index < 2; index += 1) {
  response = await hooks.handleReaderPasswordResetConfirm(resetRequest(resetBody()), { WAITLIST_DB: successDb });
  assert.equal(response.status, 401);
}
assert.equal(successDb.attempts.size > 0, true);
response = await hooks.handleReaderPasswordResetConfirm(
  resetRequest(resetBody({ totpCode: currentCode })),
  { WAITLIST_DB: successDb }
);
parsed = await parseJson(response);
assert.equal(parsed.status, 200);
assert.equal(parsed.body.authenticated, true);
assert.equal(successDb.passwordUpdates, 1);
assert.equal(successDb.attempts.size, 0);

const legacyDb = new FakeD1();
legacyDb.addAccount({ id: 7, email: 'legacy@example.com', username: 'legacy-reader' });
const rawResetToken = 'legacy-reset-token';
const tokenHash = await hooks.sha256Hex(rawResetToken);
const legacyToken = legacyDb.addResetToken(tokenHash, { id: 22, accountId: 7 });
response = await hooks.handleReaderPasswordResetConfirm(
  resetRequest({
    token: rawResetToken,
    password: 'legacy-password-123',
    confirmPassword: 'legacy-password-123'
  }),
  { WAITLIST_DB: legacyDb }
);
parsed = await parseJson(response);
assert.equal(parsed.status, 200);
assert.equal(parsed.body.authenticated, true);
assert.equal(legacyToken.consumed, true);
assert.equal(legacyDb.passwordUpdates, 1);

const consumeDb = new FakeD1();
consumeDb.addAccount({ id: 11, totp: { enabled: true, secretBase32: rfcSecret } });
const consumeResults = await Promise.all([
  hooks.verifyAndConsumeReaderTotpCode(consumeDb, 11, currentCode),
  hooks.verifyAndConsumeReaderTotpCode(consumeDb, 11, currentCode)
]);
assert.equal(consumeResults.filter((result) => result.ok).length, 1);
assert.equal(consumeResults.filter((result) => !result.ok).length, 1);

const libraryPage = await readFile(new URL('../src/pages/library/index.astro', import.meta.url), 'utf8');
assert.match(libraryPage, /resetToken/);
assert.match(libraryPage, /legacyReset/);
assert.match(libraryPage, /token:\s*resetToken/);
assert.match(libraryPage, /safeLoadTotpStatus/);

const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
assert.match(workerSource, /reader_totp_reset_attempts/);
assert.match(workerSource, /reserveReaderTotpResetAttempt/);
assert.match(workerSource, /failure_count = reader_totp_reset_attempts\.failure_count \+ 1/);
assert.match(workerSource, /shouldSampleReaderTotpResetCleanup/);
assert.match(workerSource, /LIMIT 200/);
assert.match(workerSource, /last_used_step IS NULL OR last_used_step < \?/);
assert.match(workerSource, /unboundMessage: readerTotpResetFailureMessage/);
assert.doesNotMatch(workerSource, /无法用验证码重置密码/);

const migration = await readFile(
  new URL('../migrations/0013_reader_totp_reset_attempts.sql', import.meta.url),
  'utf8'
);
assert.match(migration, /reader_totp_reset_attempts/);
assert.match(migration, /UNIQUE\(scope, scope_key\)/);
assert.match(migration, /idx_reader_totp_reset_attempts_updated_at/);

console.log('reader TOTP tests passed');
