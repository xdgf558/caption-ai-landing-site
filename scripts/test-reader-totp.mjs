import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { __readerTotpTestHooks as hooks } from '../src/worker.js';

const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

assert.equal(await hooks.hotpCode(rfcSecret, 0), '755224');
assert.equal(await hooks.hotpCode(rfcSecret, 1), '287082');
assert.equal(hooks.normalizeTotpCode(' 123 456 '), '123456');
assert.equal(hooks.timingSafeEqualString('123456', '123456'), true);
assert.equal(hooks.timingSafeEqualString('123456', '123457'), false);

const roundTripBytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
assert.deepEqual([...hooks.base32ToBytes(hooks.bytesToBase32(roundTripBytes))], [...roundTripBytes]);

const currentStep = hooks.getTotpStep();
const currentCode = await hooks.hotpCode(rfcSecret, currentStep);
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
assert.equal(hooks.readerTotpResetFailureMessage, '账号或二步验证码不正确。');

const libraryPage = await readFile(new URL('../src/pages/library/index.astro', import.meta.url), 'utf8');
assert.match(libraryPage, /resetToken/);
assert.match(libraryPage, /legacyReset/);
assert.match(libraryPage, /token:\s*resetToken/);
assert.match(libraryPage, /safeLoadTotpStatus/);

const workerSource = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
assert.match(workerSource, /reader_totp_reset_attempts/);
assert.match(workerSource, /consumeReaderTotpStep/);
assert.match(workerSource, /last_used_step IS NULL OR last_used_step < \?/);
assert.match(workerSource, /unboundMessage: readerTotpResetFailureMessage/);
assert.doesNotMatch(workerSource, /无法用验证码重置密码/);

const migration = await readFile(
  new URL('../migrations/0013_reader_totp_reset_attempts.sql', import.meta.url),
  'utf8'
);
assert.match(migration, /reader_totp_reset_attempts/);
assert.match(migration, /UNIQUE\(scope, scope_key\)/);

console.log('reader TOTP tests passed');
