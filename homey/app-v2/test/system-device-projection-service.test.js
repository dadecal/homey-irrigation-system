'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  SystemDeviceProjectionService,
  constants,
} = require('../lib/system-device-projection-service');

const NOW = 1721300000000;

function capability(title, value) {
  return { title, value };
}

function createService({
  engine = {},
  rawAvailable = true,
  rawCapabilities = {},
  appState = null,
  apiOverrides = {},
  homeyOverrides = {},
} = {}) {
  const writes = [];
  const apiDevices = {};
  const engineFromValues = {
    state: String(engine.state || 'IDLE'),
    activeSector: Number(engine.activeSector || 0),
    startTs: Number(engine.startTs || 0),
    endTs: Number(engine.endTs || 0),
    source: String(engine.source || 'none'),
    stopReason: String(engine.stopReason || 'none'),
    queue: Array.isArray(engine.queue) ? engine.queue : [],
    history: [],
    lastTickTs: 0,
  };
  const raw = {
    id: constants.RAW_DEVICE_ID,
    available: rawAvailable,
    capabilitiesObj: {
      'measure_temperature.temperatura': capability('Temperatura Riego', 34.2),
      'measure_humidity.humedad_riego': capability('Humedad Riego', 57.4),
      'measure_temperature.esp_internal': capability('ESP Internal Temp', 86.1),
      'binary_sensor.fuga_l_nea_1': capability('Fuga Linea 1', false),
      ...rawCapabilities,
    },
  };
  apiDevices[constants.RAW_DEVICE_ID] = raw;

  const service = new SystemDeviceProjectionService({
    homey: {
      app: {},
      setInterval() {
        return 1;
      },
      clearInterval() {},
      setTimeout(callback, delayMs) {
        return { callback, delayMs };
      },
      clearTimeout() {},
      ...homeyOverrides,
    },
    apiClient: {
      async getApi() {
        return {
          devices: {
            async getDevice({ id }) {
              assert.equal(id, constants.RAW_DEVICE_ID);
              return raw;
            },
            async getDevices() {
              return apiDevices;
            },
          },
          ...apiOverrides,
        };
      },
    },
    appStateStore: {
      async getState() {
        return appState || {
          version: 1,
          health: {
            status: 'OK',
            updatedTs: NOW - 1000,
          },
          recovery: null,
          history: {
            lastProjectedEventId: null,
            lastProjection: null,
          },
          engine: engineFromValues,
          events: [],
        };
      },
    },
    now: () => NOW,
    logger: {
      log() {},
      error() {},
    },
  });

  const capabilities = Object.fromEntries(
    Object.values(constants.CAP).map(capabilityId => [capabilityId, null]),
  );
  const device = {
    getData() {
      return { id: 'irrigation_system' };
    },
    hasCapability(capabilityId) {
      return Object.prototype.hasOwnProperty.call(capabilities, capabilityId);
    },
    getCapabilityValue(capabilityId) {
      return capabilities[capabilityId];
    },
    async setCapabilityValue(capabilityId, value) {
      writes.push({ capabilityId, value });
      capabilities[capabilityId] = value;
    },
  };

  return { service, device, writes, capabilities };
}

test('builds a native system projection from engine, RAW and app state', async () => {
  const { service } = createService({
    engine: {
      state: 'RUNNING',
      activeSector: 3,
      startTs: NOW - 120000,
      endTs: NOW + 180000,
      source: 'SCHEDULER',
      queue: [{ sector: 4, duration: 10 }],
    },
  });

  const projection = await service.buildProjection();

  assert.equal(projection.writesOperationalVariables, false);
  assert.equal(projection.rawAvailable, true);
  assert.equal(projection.engine.state, 'RUNNING');
  assert.equal(projection.values[constants.CAP.activeSector], 3);
  assert.equal(projection.values[constants.CAP.remainingMinutes], 3);
  assert.equal(projection.values[constants.CAP.queueLength], 1);
  assert.equal(projection.values[constants.CAP.program], 'SCHEDULER');
  assert.equal(projection.values[constants.CAP.temperature], 34.2);
  assert.equal(projection.values[constants.CAP.healthStatus], 'OK');
});

test('updates registered native devices without writing operational variables', async () => {
  const { service, device, writes } = createService();
  await service.registerDevice(device);

  const projection = await service.check();

  assert.equal(projection.pairedDevices, 1);
  assert.equal(projection.writesOperationalVariables, false);
  assert(writes.some(write => write.capabilityId === constants.CAP.state && write.value === 'IDLE'));
  assert(writes.some(write => write.capabilityId === constants.CAP.activeSector && write.value === 0));
  assert(writes.some(write => write.capabilityId === constants.CAP.remainingMinutes && write.value === 0));
  assert(writes.some(write => write.capabilityId === constants.CAP.queueLength && write.value === 0));
  assert(writes.some(write => write.capabilityId === constants.CAP.espConnected && write.value === 'Conectado'));
});

test('reports unavailable values without writing null capabilities', async () => {
  const { service, device, writes } = createService({
    rawAvailable: false,
  });
  await service.registerDevice(device);

  await service.check();

  assert(!writes.some(write => write.value === null));
  assert(writes.some(write => write.capabilityId === constants.CAP.espConnected && write.value === 'Desconectado'));
  assert(writes.some(write => write.capabilityId === constants.CAP.leakStatus && write.value === 'Sin conexion'));
});

test('schedules fast refreshes and clears previous timers', () => {
  const delays = [];
  const cleared = [];
  let nextTimerId = 0;
  const { service } = createService({
    homeyOverrides: {
      setTimeout(callback, delayMs) {
        const timer = { id: nextTimerId += 1, callback, delayMs };
        delays.push(delayMs);
        return timer;
      },
      clearTimeout(timer) {
        cleared.push(timer.id);
      },
    },
  });

  const first = service.scheduleFastRefresh('manual-START', [1000, 3000]);
  const second = service.scheduleFastRefresh('manual-STOP', [2000]);

  assert.deepEqual(first, {
    reason: 'manual-START',
    delaysMs: [1000, 3000],
    scheduled: 2,
  });
  assert.deepEqual(second, {
    reason: 'manual-STOP',
    delaysMs: [2000],
    scheduled: 1,
  });
  assert.deepEqual(delays, [1000, 3000, 2000]);
  assert.deepEqual(cleared, [1, 2]);
});

test('ensureDevice returns the existing Homey device without creating duplicates', async () => {
  const existingDevice = {
    id: 'native-system-device-id',
    name: constants.SYSTEM_DEVICE_NAME,
    driverId: constants.SYSTEM_DRIVER_ID,
    data: {
      id: constants.SYSTEM_DEVICE_DATA_ID,
    },
    available: true,
  };

  let createPairSessionCalls = 0;
  const { service } = createService({
    apiOverrides: {
      devices: {
        async getDevice({ id }) {
          assert.equal(id, constants.RAW_DEVICE_ID);
          return {
            id: constants.RAW_DEVICE_ID,
            available: true,
            capabilitiesObj: {},
          };
        },
        async getDevices() {
          return {
            [constants.RAW_DEVICE_ID]: {
              id: constants.RAW_DEVICE_ID,
              driverId: 'homey:app:esphome:riego',
              data: {
                id: constants.RAW_DEVICE_ID,
              },
            },
            [existingDevice.id]: existingDevice,
          };
        },
      },
      drivers: {
        async createPairSession() {
          createPairSessionCalls += 1;
          throw new Error('should not create a pair session when device exists');
        },
      },
    },
  });

  const result = await service.ensureDevice();

  assert.equal(result.created, false);
  assert.equal(result.reason, 'ALREADY_EXISTS');
  assert.equal(result.device.id, existingDevice.id);
  assert.equal(createPairSessionCalls, 0);
});

test('ensureDevice creates and closes a pair session when missing', async () => {
  const calls = [];
  const createdDevice = {
    id: 'created-system-device-id',
    name: constants.SYSTEM_DEVICE_NAME,
    driverId: constants.SYSTEM_DRIVER_ID,
    data: {
      id: constants.SYSTEM_DEVICE_DATA_ID,
    },
    available: true,
  };

  const { service } = createService({
    apiOverrides: {
      devices: {
        async getDevice({ id }) {
          assert.equal(id, constants.RAW_DEVICE_ID);
          return {
            id: constants.RAW_DEVICE_ID,
            available: true,
            capabilitiesObj: {},
          };
        },
        async getDevices() {
          return {};
        },
      },
      drivers: {
        async createPairSession({ pairsession }) {
          calls.push(['createPairSession', pairsession]);
          assert.equal(pairsession.type, 'pair');
          assert.equal(pairsession.driverId, constants.SYSTEM_DRIVER_ID);
          return { id: 'pair-session-id' };
        },
        async createPairSessionDevice({ id, device }) {
          calls.push(['createPairSessionDevice', id, device]);
          assert.equal(id, 'pair-session-id');
          assert.equal(device.name, constants.SYSTEM_DEVICE_NAME);
          assert.deepEqual(device.data, { id: constants.SYSTEM_DEVICE_DATA_ID });
          return createdDevice;
        },
        async deletePairSession({ id }) {
          calls.push(['deletePairSession', id]);
          assert.equal(id, 'pair-session-id');
        },
      },
    },
  });

  const result = await service.ensureDevice();

  assert.equal(result.created, true);
  assert.equal(result.reason, 'CREATED');
  assert.equal(result.device.id, createdDevice.id);
  assert.deepEqual(calls.map(call => call[0]), [
    'createPairSession',
    'createPairSessionDevice',
    'deletePairSession',
  ]);
});
