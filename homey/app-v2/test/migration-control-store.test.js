'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODE, SERVICE } = require('../lib/constants');
const { MigrationControlStore } = require('../lib/migration-control-store');

function createStore(initial = null) {
  let stored = initial;
  const store = new MigrationControlStore({
    settings: {
      get() {
        return stored;
      },
      set(key, value) {
        stored = value;
      },
    },
  });

  return {
    store,
    getStored() {
      return stored;
    },
  };
}

test('supports ACTIVE_COMPAT for implemented migration services', async () => {
  const { store, getStored } = createStore();

  const schedulerControl = await store.setServiceMode(
    SERVICE.SCHEDULER,
    MODE.ACTIVE_COMPAT,
    { acknowledgeDuplicateWriteRisk: true },
  );
  const statusSyncControl = await store.setServiceMode(
    SERVICE.STATUS_SYNC,
    MODE.ACTIVE_COMPAT,
    { acknowledgeDuplicateWriteRisk: true },
  );
  const healthControl = await store.setServiceMode(
    SERVICE.HEALTH,
    MODE.ACTIVE_COMPAT,
    { acknowledgeDuplicateWriteRisk: true },
  );
  const historyControl = await store.setServiceMode(
    SERVICE.HISTORY,
    MODE.ACTIVE_COMPAT,
    { acknowledgeDuplicateWriteRisk: true },
  );
  const recoveryControl = await store.setServiceMode(
    SERVICE.RECOVERY,
    MODE.ACTIVE_COMPAT,
    { acknowledgeDuplicateWriteRisk: true },
  );

  assert.equal(schedulerControl.services[SERVICE.SCHEDULER], MODE.ACTIVE_COMPAT);
  assert.equal(statusSyncControl.services[SERVICE.STATUS_SYNC], MODE.ACTIVE_COMPAT);
  assert.equal(healthControl.services[SERVICE.HEALTH], MODE.ACTIVE_COMPAT);
  assert.equal(historyControl.services[SERVICE.HISTORY], MODE.ACTIVE_COMPAT);
  assert.equal(recoveryControl.services[SERVICE.RECOVERY], MODE.ACTIVE_COMPAT);
  assert.equal(schedulerControl.activeCompatSupported[SERVICE.SCHEDULER], true);
  assert.equal(healthControl.activeCompatSupported[SERVICE.STATUS_SYNC], true);
  assert.equal(healthControl.activeCompatSupported[SERVICE.HEALTH], true);
  assert.equal(historyControl.activeCompatSupported[SERVICE.HISTORY], true);
  assert.equal(recoveryControl.activeCompatSupported[SERVICE.RECOVERY], true);
  assert.equal(recoveryControl.services[SERVICE.ENGINE], MODE.SHADOW);
  assert.equal(recoveryControl.activeCompatSupported[SERVICE.ENGINE], true);
  assert.equal(getStored().services[SERVICE.SCHEDULER], MODE.ACTIVE_COMPAT);
  assert.equal(getStored().services[SERVICE.STATUS_SYNC], MODE.ACTIVE_COMPAT);
  assert.equal(getStored().services[SERVICE.HEALTH], MODE.ACTIVE_COMPAT);
  assert.equal(getStored().services[SERVICE.HISTORY], MODE.ACTIVE_COMPAT);
  assert.equal(getStored().services[SERVICE.RECOVERY], MODE.ACTIVE_COMPAT);
  assert.equal(getStored().services[SERVICE.ENGINE], MODE.SHADOW);
});

test('allows engine ACTIVE_COMPAT only with a clean activation precheck', async () => {
  const { store, getStored } = createStore();

  await assert.rejects(
    () => store.setServiceMode(SERVICE.ENGINE, MODE.ACTIVE_COMPAT, {
      acknowledgeDuplicateWriteRisk: true,
    }),
    /precheck limpio/,
  );

  const control = await store.setServiceMode(SERVICE.ENGINE, MODE.ACTIVE_COMPAT, {
    acknowledgeDuplicateWriteRisk: true,
    engineActivationPrecheck: {
      allowed: true,
      blockers: [],
    },
  });

  assert.equal(control.services[SERVICE.ENGINE], MODE.ACTIVE_COMPAT);
  assert.equal(control.activeCompatSupported[SERVICE.ENGINE], true);
  assert.equal(getStored().services[SERVICE.ENGINE], MODE.ACTIVE_COMPAT);
});

test('keeps engine implementation support marker when rolling back to SHADOW', async () => {
  const { store, getStored } = createStore();

  await store.setServiceMode(SERVICE.ENGINE, MODE.ACTIVE_COMPAT, {
    acknowledgeDuplicateWriteRisk: true,
    engineActivationPrecheck: {
      allowed: true,
      blockers: [],
    },
  });

  const control = await store.setServiceMode(SERVICE.ENGINE, MODE.SHADOW);

  assert.equal(control.services[SERVICE.ENGINE], MODE.SHADOW);
  assert.equal(control.activeCompatSupported[SERVICE.ENGINE], true);
  assert.equal(getStored().services[SERVICE.ENGINE], MODE.SHADOW);
  assert.equal(getStored().activeCompatSupported[SERVICE.ENGINE], true);
});

test('requires explicit acknowledgement to activate ACTIVE_COMPAT', async () => {
  const { store } = createStore();

  await assert.rejects(
    () => store.setServiceMode(SERVICE.STATUS_SYNC, MODE.ACTIVE_COMPAT),
    /acknowledgeDuplicateWriteRisk=true/,
  );
});

test('rejects unsupported migration services', async () => {
  const { store } = createStore();

  await assert.rejects(
    () => store.setServiceMode('unknown', MODE.ACTIVE_COMPAT, {
      acknowledgeDuplicateWriteRisk: true,
    }),
    /Servicio de migracion no soportado/,
  );
});
