'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAdapters, buildManualStartPreview, buildStopPlan } = require('../lib/engine-dry-run-adapters');
const { AppStateStore } = require('../lib/app-state-store');
const {
  DEVICE_ID,
  RAW_CAP,
  EnginePlanExecutor,
} = require('../lib/engine-plan-executor');

const NOW = 1784620000000;

function createDevice(capabilitiesObj) {
  return {
    capabilitiesObj,
    writes: [],
    async setCapabilityValue(capability, value) {
      this.writes.push({ capability, value });
      if (!this.capabilitiesObj[capability]) {
        this.capabilitiesObj[capability] = { value: null };
      }
      this.capabilitiesObj[capability].value = value;
    },
  };
}

function createExecutor() {
  const homeyValues = new Map();
  const appStateStore = new AppStateStore({
    settings: {
      get(key) {
        return homeyValues.get(key);
      },
      set(key, value) {
        homeyValues.set(key, value);
      },
    },
  }, { now: () => NOW });
  const devices = {
    [DEVICE_ID.raw]: createDevice(Object.fromEntries(
      Object.values(RAW_CAP.relays).map(capability => [capability, { value: false }]),
    )),
  };

  const executor = new EnginePlanExecutor({
    apiClient: {
      async getApi() {
        return {
          devices: {
            async getDevice({ id }) {
              return devices[id];
            },
          },
        };
      },
    },
    appStateStore,
    now: () => NOW,
  });

  return { executor, devices, appStateStore };
}

function createAppStateExecutor() {
  const homeyValues = new Map();
  const sectorTriggers = [];
  const sectorStartedTrigger = {
    async trigger(tokens) {
      sectorTriggers.push({ id: 'sector_started', tokens });
    },
  };
  const sectorEndedTrigger = {
    async trigger(tokens) {
      sectorTriggers.push({ id: 'sector_ended', tokens });
    },
  };
  const appStateStore = new AppStateStore({
    settings: {
      get(key) {
        return homeyValues.get(key);
      },
      set(key, value) {
        homeyValues.set(key, value);
      },
    },
  }, { now: () => NOW });
  const devices = {
    [DEVICE_ID.raw]: createDevice(Object.fromEntries(
      Object.values(RAW_CAP.relays).map(capability => [capability, { value: false }]),
    )),
  };

  const executor = new EnginePlanExecutor({
    apiClient: {
      async getApi() {
        return {
          devices: {
            async getDevice({ id }) {
              return devices[id];
            },
          },
        };
      },
    },
    appStateStore,
    stateBackend: 'appState',
    sectorStartedTrigger,
    sectorEndedTrigger,
    now: () => NOW,
  });

  return { executor, appStateStore, devices, sectorTriggers };
}

test('executes an active manual start plan against appState and raw relays only', async () => {
  const { executor, devices, appStateStore } = createExecutor();
  const plan = buildManualStartPreview({
    snapshot: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
    },
    input: { sector: 2, duration: 3 },
    now: NOW,
    adapters: createAdapters({ dryRun: false }),
  });

  const result = await executor.execute(plan);

  assert.equal(plan.dryRun, false);
  assert.equal(result.dryRun, false);
  const engine = await appStateStore.getEngineState();
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 2);
  assert.equal(engine.endTs, NOW + 3 * 60 * 1000);
  assert.deepEqual(engine.queue, []);
  assert.equal(engine.lastSectorEvent.type, 'sectorStart');
  assert.equal(devices[DEVICE_ID.raw].capabilitiesObj[RAW_CAP.relays[2]].value, true);
});

test('executes engine state steps against appStateV2 without writing Logic variables', async () => {
  const { executor, appStateStore, devices, sectorTriggers } = createAppStateExecutor();
  const plan = buildManualStartPreview({
    snapshot: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
    },
    input: { sector: 2, duration: 3 },
    now: NOW,
    adapters: createAdapters({ dryRun: false }),
  });

  const result = await executor.execute(plan);
  const engine = await appStateStore.getEngineState();

  assert.equal(result.dryRun, false);
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 2);
  assert.equal(engine.endTs, NOW + 3 * 60 * 1000);
  assert.deepEqual(engine.queue, []);
  assert.equal(engine.lastSectorEvent.type, 'sectorStart');
  assert.equal(sectorTriggers.length, 1);
  assert.equal(sectorTriggers[0].id, 'sector_started');
  assert.equal(sectorTriggers[0].tokens.sector, 2);
  assert.equal(sectorTriggers[0].tokens.duration, 3);
  assert.equal(sectorTriggers[0].tokens.source, 'MANUAL');
  assert.equal(devices[DEVICE_ID.raw].capabilitiesObj[RAW_CAP.relays[2]].value, true);
});

test('active engine plan persists state and raw relay changes together', async () => {
  const { executor, devices } = createAppStateExecutor();

  const plan = buildManualStartPreview({
    snapshot: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
    },
    input: { sector: 2, duration: 3 },
    now: NOW,
    adapters: createAdapters({ dryRun: false }),
  });

  const result = await executor.execute(plan);
  assert.equal(result.dryRun, false);
  assert.equal(devices[DEVICE_ID.raw].capabilitiesObj[RAW_CAP.relays[2]].value, true);
});

test('triggers native sector ended flow after appState sector end persistence', async () => {
  const { executor, appStateStore, sectorTriggers } = createAppStateExecutor();
  const plan = buildStopPlan({
    snapshot: {
      state: 'RUNNING',
      activeSector: 4,
      startTs: NOW - 5 * 60 * 1000,
      endTs: NOW,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
      activeRelays: [4],
      anyRelayOn: true,
    },
    reason: 'timeout',
    now: NOW,
    liters: 12.5,
    adapters: createAdapters({ dryRun: false }),
  });

  await executor.execute(plan);
  const engine = await appStateStore.getEngineState();

  assert.equal(engine.lastSectorEvent.type, 'sectorEnd');
  assert.equal(sectorTriggers.length, 1);
  assert.equal(sectorTriggers[0].id, 'sector_ended');
  assert.equal(sectorTriggers[0].tokens.sector, 4);
  assert.equal(sectorTriggers[0].tokens.duration, 5);
  assert.equal(sectorTriggers[0].tokens.liters, 12.5);
  assert.equal(sectorTriggers[0].tokens.reason, 'timeout');
  assert.equal(sectorTriggers[0].tokens.source, 'MANUAL');
});
