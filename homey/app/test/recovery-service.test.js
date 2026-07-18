'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RecoveryService,
  initialRecoveryState,
  constants,
} = require('../lib/recovery-service');

class MemoryLogicStore {
  constructor(initialValues = {}) {
    this.values = { ...initialValues };
    this.writes = [];
  }

  async ensureVariable(name, value) {
    if (!(name in this.values)) {
      this.values[name] = value;
      this.writes.push(`ensure:${name}`);
    }
  }

  async getValue(name, fallback = null) {
    return name in this.values ? this.values[name] : fallback;
  }

  async setValue(name, value) {
    this.values[name] = value;
    this.writes.push(`set:${name}`);
  }
}

function createService({
  available = true,
  engineState = 'IDLE',
  apps = {
    'com.ugrbnk.esphome': {
      id: 'com.ugrbnk.esphome',
      name: 'ESPHome Controller',
      version: '1.3.18',
      enabled: true,
    },
  },
  restartApp = async () => {},
  now = () => 1000,
  initialState = null,
} = {}) {
  const logicStore = new MemoryLogicStore({
    [constants.VAR.engineState]: engineState,
    ...(initialState ? { [constants.VAR.state]: JSON.stringify(initialState) } : {}),
  });
  const restartCalls = [];
  const api = {
    devices: {
      async getDevice() {
        if (available instanceof Error) {
          throw available;
        }
        return { available };
      },
    },
    apps: {
      async getApps() {
        return apps;
      },
      async restartApp(args) {
        restartCalls.push(args);
        return restartApp(args);
      },
    },
  };
  const service = new RecoveryService({
    homey: {
      app: {
        log() {},
        error() {},
      },
      setInterval() {
        return 1;
      },
      clearInterval() {},
    },
    apiClient: {
      async getApi() {
        return api;
      },
    },
    logicStore,
    now,
    logger: {
      log() {},
      error() {},
    },
  });

  return { service, logicStore, restartCalls };
}

function storedState(logicStore) {
  return JSON.parse(logicStore.values[constants.VAR.state]);
}

test('restarts ESPHome Controller after three failed checks while idle', async () => {
  const initialState = initialRecoveryState();
  initialState.consecutiveFailures = 2;
  const { service, logicStore, restartCalls } = createService({
    available: false,
    initialState,
    now: () => 2000,
  });

  const result = await service.check();
  const state = storedState(logicStore);

  assert.equal(result.status, 'RESTART_REQUESTED');
  assert.deepEqual(restartCalls, [{ id: 'com.ugrbnk.esphome' }]);
  assert.equal(state.attemptsInIncident, 1);
  assert.equal(state.awaitingRecovery, true);
  assert.equal(state.events[0].type, 'RESTART_REQUESTED');
  assert.deepEqual(logicStore.writes.slice(-3), [
    `set:${constants.VAR.state}`,
    `set:${constants.VAR.message}`,
    `set:${constants.VAR.trigger}`,
  ]);
});

test('restarts after two failed checks while the engine is running', async () => {
  const initialState = initialRecoveryState();
  initialState.consecutiveFailures = 1;
  const { service, restartCalls } = createService({
    available: false,
    engineState: 'RUNNING',
    initialState,
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_REQUESTED');
  assert.equal(restartCalls.length, 1);
});

test('does not restart during cooldown', async () => {
  const initialState = initialRecoveryState();
  initialState.consecutiveFailures = 3;
  initialState.lastRestartTs = 1000;
  const { service, restartCalls } = createService({
    available: false,
    initialState,
    now: () => 1000 + constants.RESTART_COOLDOWN_MS - 1,
  });

  const result = await service.check();

  assert.equal(result.status, 'COOLDOWN');
  assert.equal(restartCalls.length, 0);
});

test('notifies exhaustion only once after three attempts', async () => {
  const initialState = initialRecoveryState();
  initialState.consecutiveFailures = 3;
  initialState.attemptsInIncident = 3;
  const { service, logicStore } = createService({
    available: false,
    initialState,
  });

  const first = await service.check();
  const afterFirst = storedState(logicStore);
  const second = await service.check();
  const afterSecond = storedState(logicStore);

  assert.equal(first.status, 'EXHAUSTED');
  assert.equal(second.status, 'EXHAUSTED');
  assert.equal(afterFirst.events[0].type, 'EXHAUSTED');
  assert.equal(afterSecond.events.filter(event => event.type === 'EXHAUSTED').length, 1);
});

test('resets incident counters when ESPHome is available again', async () => {
  const initialState = initialRecoveryState();
  initialState.consecutiveFailures = 2;
  initialState.attemptsInIncident = 1;
  initialState.awaitingRecovery = true;
  const { service, logicStore } = createService({
    available: true,
    initialState,
    now: () => 3000,
  });

  const result = await service.check();
  const state = storedState(logicStore);

  assert.equal(result.status, 'RECOVERED');
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.attemptsInIncident, 0);
  assert.equal(state.awaitingRecovery, false);
  assert.equal(state.lastRecoveryTs, 3000);
  assert.equal(state.events[0].type, 'RECOVERED');
});
