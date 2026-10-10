import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareStationFullWithFocus } from '../src/redesign/musicClient.js';

function fixture() {
  const owner = { body: {}, documentElement: {}, activeElement: null };
  const button = { ownerDocument: owner, isConnected: true, disabled: false, focus() { owner.activeElement = this; } };
  owner.activeElement = button;
  let resolve, reject; const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  const prepare = () => { button.disabled = true; owner.activeElement = owner.body; return pending; };
  return { owner, button, prepare, resolve, reject };
}

test('full access completion restores the focused button after native disabling', async () => {
  for (const outcome of ['success', 'denied']) {
    const f = fixture(), request = prepareStationFullWithFocus(f.button, f.prepare);
    assert.equal(f.owner.activeElement, f.owner.body); f.button.disabled = false;
    if (outcome === 'success') f.resolve(); else f.reject(new Error('Access denied'));
    await request; assert.equal(f.owner.activeElement, f.button);
  }
});
test('late access completion preserves a newer user focus or open dialog', async () => {
  const f = fixture(), request = prepareStationFullWithFocus(f.button, f.prepare), newer = {};
  f.owner.activeElement = newer; f.button.disabled = false; f.resolve(); await request;
  assert.equal(f.owner.activeElement, newer);
});
test('detached, disposed, still-disabled and originally unfocused buttons cannot claim focus', async () => {
  for (const state of ['detached','disposed','disabled','unfocused']) {
    const f = fixture(); let disposed = false;
    if (state === 'unfocused') f.owner.activeElement = f.owner.body;
    const request = prepareStationFullWithFocus(f.button, f.prepare, () => disposed);
    f.button.disabled = state === 'disabled'; f.button.isConnected = state !== 'detached'; disposed = state === 'disposed';
    f.resolve(); await request; assert.equal(f.owner.activeElement, f.owner.body, state);
  }
});
