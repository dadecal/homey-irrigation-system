'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const HealthService = require('../lib/health-service');

const NOW = 1721300000000;
const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';

function capability(title, value) {
  return { title, value };
}

function rawDevice(capabilitiesObj = {}, available = true) {
  return { id: RAW_DEVICE_ID, available, capabilitiesObj };
}

function createService({
  mode = 'SHADOW',
  engineMode = 'SHADOW',
  appState = null,
  raw = rawDevice({
    seq: capability('ESP secuencia error', 0),
    level: capability('ESP nivel error', ''),
    component: capability('ESP componente error', ''),
    message: capability('ESP ultimo error', ''),
  }),
  trigger = null,
} = {}) {
  const writes = [];
  const stateWrites = [];
  const triggerCalls = [];
  const notificationCalls = [];
  const appStateData = appState || {
    version: 1,
    updatedTs: 0,
    health: null,
    history: {
      lastProjectedEventId: null,
      lastProjection: null,
    },
    engine: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'none',
      stopReason: 'none',
      queue: [],
      history: [],
      lastTickTs: 0,
    },
    events: [],
  };
  const apiClient = {
    async getApi() {
      return {
        devices: {
          async getDevice({ id }) {
            if (id === RAW_DEVICE_ID) {
              if (raw instanceof Error) throw raw;
              return raw;
            }
            throw new Error(`Unexpected device ${id}`);
          },
        },
      };
    },
  };

  const homey = {
    setInterval() {
      return 1;
    },
    clearInterval() {},
    notifications: {
      async createNotification(payload) {
        notificationCalls.push(payload);
      },
    },
    app: {},
  };

  const logs = [];
  const service = new HealthService({
    homey,
    apiClient,
    appStateStore: {
      async getState() {
        return appStateData;
      },
      async setHealth(health) {
        stateWrites.push({ key: 'health', value: health });
        appStateData.health = health;
        return appStateData;
      },
      async appendEvent(event) {
        stateWrites.push({ key: 'event', value: event });
        appStateData.events.unshift(event);
        return appStateData;
      },
    },
    controlStore: {
      async getControl() {
        return {
          services: {
            health: mode,
            engine: engineMode,
          },
        };
      },
    },
    healthTransitionTrigger: trigger || {
      async trigger(tokens) {
        triggerCalls.push(tokens);
      },
    },
    now: () => NOW,
    logger: {
      log(...args) {
        logs.push(args);
      },
      error(...args) {
        logs.push(args);
      },
    },
  });

  return { service, writes, stateWrites, triggerCalls, notificationCalls, logs, appStateData };
}

test('reports OK in shadow mode without writing operational variables', async () => {
  const { service, writes } = createService();

  const health = await service.check();

  assert.equal(health.mode, 'SHADOW');
  assert.equal(health.status, 'OK');
  assert.equal(health.writesOperationalVariables, false);
  assert.equal(health.updatesDevices, false);
  assert.deepEqual(writes, []);
});

test('persists health to app state and triggers native flow in ACTIVE_COMPAT mode', async () => {
  const { service, writes, stateWrites, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: 0,
      health: {
        status: 'OK',
        issues: [],
        telemetry: {
          lastEspSequence: 0,
        },
      },
      history: { lastProjectedEventId: null, lastProjection: null },
      events: [],
    },
    raw: rawDevice({}, false),
  });

  const health = await service.check();

  assert.equal(health.mode, 'ACTIVE_COMPAT');
  assert.equal(health.status, 'OFFLINE');
  assert.equal(health.writesOperationalVariables, false);
  assert.equal(health.writesInternalState, true);
  assert.equal(health.updatesDevices, false);
  assert.equal(health.changed, true);
  assert.deepEqual(stateWrites.map(write => write.key), [
    'health',
    'event',
  ]);
  assert.deepEqual(triggerCalls, [{
    status: 'OFFLINE',
    message: 'OFFLINE - Controlador ESP32 desconectado',
    issueCodes: 'ESP_OFFLINE',
  }]);
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: false,
  }]);
  assert.deepEqual(health.applied.devices, []);
  assert.deepEqual(writes, []);
});

test('keeps health active without projecting to another system device', async () => {
  const { service, writes } = createService({
    mode: 'ACTIVE_COMPAT',
  });

  const health = await service.check();

  assert.equal(health.status, 'OK');
  assert.equal(service.lastError, null);
  assert.deepEqual(writes, []);
  assert.deepEqual(health.applied.devices, []);
});

test('does not append a health event or trigger native flow when the active app-state signature is unchanged', async () => {
  const persistedHealth = {
    status: 'OFFLINE',
    issues: [{
      code: 'ESP_OFFLINE',
      severity: 'OFFLINE',
      component: 'ESP32',
      message: 'Controlador ESP32 desconectado',
      firstSeenTs: NOW - 60000,
      lastSeenTs: NOW - 60000,
    }],
    telemetry: {
      lastEspSequence: 0,
    },
  };
  const { service, writes, stateWrites, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: NOW - 60000,
      health: persistedHealth,
      history: {
        lastProjectedEventId: null,
        lastProjection: null,
      },
      events: [],
    },
    raw: rawDevice({}, false),
  });

  const health = await service.check();

  assert.equal(health.changed, false);
  assert(stateWrites.some(write => write.key === 'health'));
  assert(!stateWrites.some(write => write.key === 'event'));
  assert.deepEqual(triggerCalls, []);
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: true,
    reason: 'UNCHANGED',
  }]);
  assert.deepEqual(writes, []);
});

test('does not trigger the incident flow when health recovers to OK', async () => {
  const persistedHealth = {
    status: 'WARNING',
    issues: [{
      code: 'ESPHOME_WARNING_4',
      severity: 'WARNING',
      component: 'ESPHome',
      message: 'Aviso anterior',
      firstSeenTs: NOW - 60_000,
      lastSeenTs: NOW - 60_000,
      expiresTs: NOW - 1,
    }],
    telemetry: {
      lastEspSequence: 4,
    },
  };
  const { service, stateWrites, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: NOW - 60_000,
      health: persistedHealth,
      history: {
        lastProjectedEventId: null,
        lastProjection: null,
      },
      events: [],
    },
    raw: rawDevice({
      seq: capability('ESP secuencia error', 4),
      level: capability('ESP nivel error', 'warning'),
      component: capability('ESP componente error', 'sensor'),
      message: capability('ESP ultimo error', 'Aviso anterior'),
    }),
  });

  const health = await service.check();

  assert.equal(health.status, 'OK');
  assert.equal(health.changed, true);
  assert.deepEqual(triggerCalls, []);
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: true,
    reason: 'NOT_ACTIONABLE',
  }]);
  assert(stateWrites.some(write => write.key === 'health'));
});

test('ignores noisy ESPHome api and web server warnings as user incidents', async () => {
  const { service, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: 0,
      health: {
        status: 'OK',
        telemetry: {
          lastEspSequence: 10,
        },
      },
      history: { lastProjectedEventId: null, lastProjection: null },
      events: [],
    },
    raw: rawDevice({
      seq: capability('ESP secuencia error', 11),
      level: capability('ESP nivel error', 'warning'),
      component: capability('ESP componente error', 'api.connection'),
      message: capability('ESP ultimo error', '@2colors/esphome-native-api: Reading failed CONNECTION_CLOSED errno=128'),
    }),
  });

  const health = await service.check();

  assert.equal(health.status, 'OK');
  assert.deepEqual(health.issues, []);
  assert.equal(health.telemetry.lastEspSequence, 11);
  assert.deepEqual(triggerCalls, []);
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: true,
    reason: 'NOT_ACTIONABLE',
  }]);
});

test('keeps non-noisy ESPHome warnings visible without notifying as incidents', async () => {
  const { service, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: 0,
      health: {
        status: 'OK',
        telemetry: {
          lastEspSequence: 20,
        },
      },
      history: { lastProjectedEventId: null, lastProjection: null },
      events: [],
    },
    raw: rawDevice({
      seq: capability('ESP secuencia error', 21),
      level: capability('ESP nivel error', 'warning'),
      component: capability('ESP componente error', 'sensor'),
      message: capability('ESP ultimo error', 'Aviso de sensor'),
    }),
  });

  const health = await service.check();

  assert.equal(health.status, 'WARNING');
  assert.deepEqual(health.issues.map(issue => issue.code), ['ESPHOME_WARNING_21']);
  assert.deepEqual(triggerCalls, []);
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: true,
    reason: 'NOT_ACTIONABLE',
  }]);
});

test('does not re-notify the same actionable incident when only non-actionable warning details change', async () => {
  const persistedHealth = {
    status: 'ERROR',
    issues: [{
      code: 'ENGINE_STOP_UNCONFIRMED',
      severity: 'ERROR',
      component: 'Motor',
      message: 'Riego interrumpido: comprobar que todas las electroválvulas están cerradas',
      firstSeenTs: NOW - 60_000,
      lastSeenTs: NOW - 60_000,
    }],
    telemetry: {
      lastEspSequence: 41,
    },
  };
  const { service, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    engineMode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: NOW - 60_000,
      health: persistedHealth,
      history: {
        lastProjectedEventId: null,
        lastProjection: null,
      },
      engine: {
        state: 'ERROR',
        activeSector: 0,
        startTs: 0,
        endTs: 0,
        source: 'none',
        stopReason: 'error',
        queue: [],
        history: [],
        lastTickTs: NOW - 30_000,
      },
      events: [],
    },
    raw: rawDevice({
      seq: capability('ESP secuencia error', 42),
      level: capability('ESP nivel error', 'warning'),
      component: capability('ESP componente error', 'wifi'),
      message: capability('ESP ultimo error', 'Network no longer found'),
    }),
  });

  const health = await service.check();

  assert.equal(health.status, 'ERROR');
  assert.equal(health.changed, true);
  assert.equal(health.notificationChanged, false);
  assert.deepEqual(health.issues.map(issue => issue.code), [
    'ENGINE_STOP_UNCONFIRMED',
    'ESPHOME_WARNING_42',
  ]);
  assert.deepEqual(triggerCalls, []);
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: true,
    reason: 'NOT_ACTIONABLE',
  }]);
});

test('keeps persisted health when the native health trigger fails', async () => {
  const { service, writes } = createService({
    mode: 'ACTIVE_COMPAT',
    raw: rawDevice({}, false),
    trigger: {
      async trigger() {
        throw new Error('Flow unavailable');
      },
    },
  });

  const health = await service.check();

  assert.equal(health.status, 'OFFLINE');
  assert.deepEqual(health.applied.triggers, [{
    id: 'health_transition',
    skipped: true,
    reason: 'TRIGGER_FAILED',
    message: 'Flow unavailable',
  }]);
  assert.deepEqual(health.applied.devices, []);
  assert.deepEqual(writes, []);
});

test('detects ESPHome offline without writing public health variables', async () => {
  const { service, writes, notificationCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    raw: rawDevice({}, false),
  });

  const health = await service.check();

  assert.equal(health.status, 'OFFLINE');
  assert.deepEqual(health.issues.map(issue => issue.code), ['ESP_OFFLINE']);
  assert.deepEqual(notificationCalls, []);
  assert.deepEqual(health.applied.notifications, [{
    id: 'homey_notification',
    skipped: true,
    reason: 'FLOW_OWNS_NOTIFICATION',
  }]);
  assert.deepEqual(writes, []);
});

test('detects controller offline during an active irrigation run', async () => {
  const { service } = createService({
    appState: {
      version: 1,
      updatedTs: 0,
      health: null,
      history: { lastProjectedEventId: null, lastProjection: null },
      engine: {
        state: 'RUNNING',
        activeSector: 3,
        startTs: NOW - 60_000,
        endTs: NOW + 60_000,
        source: 'SCHEDULER',
        stopReason: 'none',
        queue: [],
        history: [],
        lastTickTs: NOW - 30_000,
      },
      events: [],
    },
    raw: rawDevice({}, false),
  });

  const health = await service.check();

  assert.equal(health.status, 'OFFLINE');
  assert.deepEqual(
    health.issues.map(issue => issue.code),
    ['ENGINE_CONTROLLER_OFFLINE', 'ESP_OFFLINE'],
  );
  assert.equal(health.issues[0].sector, 3);
});

test('uses appStateV2 engine state only when engine migration is ACTIVE_COMPAT', async () => {
  const { service } = createService({
    mode: 'ACTIVE_COMPAT',
    engineMode: 'ACTIVE_COMPAT',
    appState: {
      version: 1,
      updatedTs: 0,
      health: null,
      history: {
        lastProjectedEventId: null,
        lastProjection: null,
      },
      engine: {
        state: 'RUNNING',
        activeSector: 4,
        startTs: NOW - 60_000,
        endTs: NOW + 60_000,
        source: 'MANUAL',
        stopReason: 'none',
        queue: [],
        history: [],
        lastTickTs: NOW - 30_000,
      },
      events: [],
    },
    raw: rawDevice({}, false),
  });

  const health = await service.check();

  assert(health.issues.some(issue => issue.code === 'ENGINE_CONTROLLER_OFFLINE'));
  assert.equal(health.telemetry.engineStateSource, 'appStateV2.engine');
  assert.equal(health.telemetry.activeSector, 4);
});

test('detects unconfirmed engine stop from engine state', async () => {
  const { service } = createService({
    appState: {
      version: 1,
      updatedTs: 0,
      health: null,
      history: { lastProjectedEventId: null, lastProjection: null },
      engine: {
        state: 'ERROR',
        activeSector: 2,
        startTs: NOW - 60_000,
        endTs: 0,
        source: 'MANUAL',
        stopReason: 'manual_timeout',
        queue: [],
        history: [],
        lastTickTs: NOW - 30_000,
      },
      events: [],
    },
  });

  const health = await service.check();

  assert.equal(health.status, 'ERROR');
  assert.deepEqual(health.issues.map(issue => issue.code), ['ENGINE_STOP_UNCONFIRMED']);
  assert.equal(health.issues[0].sector, 2);
  assert.equal(health.issues[0].stopReason, 'manual_timeout');
});

test('detects ESPHome telemetry and hydraulic warnings', async () => {
  const { service } = createService({
    appState: {
      version: 1,
      updatedTs: 0,
      health: {
        status: 'OK',
        telemetry: {
          lastEspSequence: 5,
          uptimeSeconds: 1000,
        },
      },
      history: { lastProjectedEventId: null, lastProjection: null },
      engine: {
        state: 'IDLE',
        activeSector: 0,
        startTs: 0,
        endTs: 0,
        source: 'none',
        stopReason: 'none',
        queue: [],
        history: [],
        lastTickTs: 0,
      },
      events: [],
    },
    raw: rawDevice({
      seq: capability('ESP secuencia error', 6),
      level: capability('ESP nivel error', 'warning'),
      component: capability('ESP componente error', 'sensor'),
      message: capability('ESP ultimo error', '\u001B[31mAviso\u001B[0m'),
      leak: capability('Fuga linea 4', true),
      relay: capability('Conflicto rele', true),
      loop: capability('Tiempo loop', 250),
      heap: capability('Heap libre', 20000),
      uptime: capability('Uptime', 900),
    }),
  });

  const health = await service.check();

  assert.equal(health.status, 'ERROR');
  assert.deepEqual(health.issues.map(issue => issue.code), [
    'LEAK_4',
    'RELAY_CONFLICT',
    'ESP_HEAP_LOW',
    'ESP_LOOP_SLOW',
    'ESP_RESTARTED',
    'ESPHOME_WARNING_6',
  ]);
  assert.equal(health.lastEvent.message, 'Aviso');
});

test('compares health result with previous appState health', async () => {
  const { service } = createService({
    appState: {
      version: 1,
      updatedTs: 0,
      health: {
        status: 'OFFLINE',
        issues: [{ code: 'ESP_OFFLINE', severity: 'OFFLINE', firstSeenTs: 1 }],
      },
      history: { lastProjectedEventId: null, lastProjection: null },
      engine: {
        state: 'IDLE',
        activeSector: 0,
        startTs: 0,
        endTs: 0,
        source: 'none',
        stopReason: 'none',
        queue: [],
        history: [],
        lastTickTs: 0,
      },
      events: [],
    },
    raw: rawDevice({}, false),
  });

  const health = await service.check();

  assert.equal(health.comparison.previousStatus, 'OFFLINE');
  assert.deepEqual(health.comparison.previousIssueCodes, ['ESP_OFFLINE']);
  assert.equal(health.comparison.matchesPreviousHealth, true);
});
