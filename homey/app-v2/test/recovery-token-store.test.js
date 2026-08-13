'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { SETTING } = require('../lib/constants');
const {
  RecoveryTokenStore,
  maskToken,
  normalizeToken,
} = require('../lib/recovery-token-store');

function createStore() {
  const settings = new Map();
  const store = new RecoveryTokenStore({
    settings: {
      get(name) {
        return settings.get(name);
      },
      set(name, value) {
        settings.set(name, value);
      },
      unset(name) {
        settings.delete(name);
      },
    },
  });

  return { store, settings };
}

test('normalizes and masks recovery tokens', () => {
  assert.equal(normalizeToken('  abc123  '), 'abc123');
  assert.equal(normalizeToken(null), '');
  assert.equal(maskToken('abcdef1234'), '***1234');
  assert.equal(maskToken(''), null);
});

test('stores recovery controller token in an isolated setting', async () => {
  const { store, settings } = createStore();

  const saved = await store.setToken('  pat-secret-1234  ');

  assert.equal(settings.get(SETTING.recoveryControllerToken), 'pat-secret-1234');
  assert.deepEqual(saved, {
    configured: true,
    masked: '***1234',
  });
  assert.equal(await store.getToken(), 'pat-secret-1234');
});

test('clears recovery controller token', async () => {
  const { store, settings } = createStore();
  await store.setToken('pat-secret-1234');

  const status = await store.clearToken();

  assert.equal(settings.has(SETTING.recoveryControllerToken), false);
  assert.deepEqual(status, {
    configured: false,
    masked: null,
  });
});
