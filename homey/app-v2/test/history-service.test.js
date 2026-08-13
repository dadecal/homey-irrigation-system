'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODE, SERVICE } = require('../lib/constants');
const HistoryService = require('../lib/history-service');
const { NATIVE_HISTORY_CAP, NATIVE_HISTORY_DRIVER_ID, NATIVE_HISTORY_DEVICE_DATA_ID } = HistoryService.constants;

const NOW = 1721300200000;

const DEVICES = {
  raw: '1120df26-8201-49de-b262-8fb98289d811',
  nativeHistory: 'irrigation_history',
};

const HISTORY_CAP = {
  lastWatering: 'devicecapabilities_text-custom_40.text2',
  totalDurationMin: 'measure_devicecapabilities_number.number4',
  totalWaterLiters: 'measure_devicecapabilities_number.number5',
  accumulatedLiters: 'measure_devicecapabilities_number.number21',
  timestamp: 'devicecapabilities_text-custom_61.text3',
  program: 'devicecapabilities_text-custom_20.text4',
  sectorLastWatering1: 'devicecapabilities_text-custom_40.text1',
  sectorDurationMin1: 'measure_devicecapabilities_number.number1',
  sectorLiters1: 'measure_devicecapabilities_number.number2',
  sectorAvgFlow1: 'measure_devicecapabilities_number.number3',
  wateringCount: 'measure_devicecapabilities_number.number22',
  accumulatedDurationMin: 'measure_devicecapabilities_number.number23',
};

function capability(value) {
  return { value };
}

function createDevice(id, capabilitiesObj = {}, writes = []) {
  return {
    id,
    available: true,
    capabilitiesObj,
    async setCapabilityValue(capability, value) {
      writes.push({ device: id, capability, value });
    },
  };
}

function latestEntry(overrides = {}) {
  return {
    id: '1784323620295-1',
    sector: 1,
    source: 'SCHEDULER',
    reason: 'timeout',
    startTs: 1784323200000,
    plannedEndTs: 1784323620000,
    endTs: 1784323620295,
    plannedDurationMin: 6,
    durationRealMin: 7.01,
    liters: 0,
    ...overrides,
  };
}

function baseHistoryCapabilities() {
  return {
    [HISTORY_CAP.lastWatering]: capability('S1 · 0 L · 6 min · timeout'),
    [HISTORY_CAP.timestamp]: capability('17/07/2026, 23:27'),
    [HISTORY_CAP.program]: capability('SCHEDULER/manual'),
    [HISTORY_CAP.totalDurationMin]: capability(6),
    [HISTORY_CAP.totalWaterLiters]: capability(0),
    [HISTORY_CAP.sectorLastWatering1]: capability('17/07/2026, 23:27 · 0 L · 6 min'),
    [HISTORY_CAP.sectorDurationMin1]: capability(6),
    [HISTORY_CAP.sectorLiters1]: capability(0),
    [HISTORY_CAP.sectorAvgFlow1]: capability(0),
    [HISTORY_CAP.accumulatedLiters]: capability(1507),
    [HISTORY_CAP.wateringCount]: capability(90),
    [HISTORY_CAP.accumulatedDurationMin]: capability(1507),
  };
}

function nativeHistoryValuesFromCapabilities(historyCapabilities = {}) {
  return {
    [NATIVE_HISTORY_CAP.lastWatering]: historyCapabilities[HISTORY_CAP.lastWatering]?.value ?? null,
    [NATIVE_HISTORY_CAP.timestamp]: historyCapabilities[HISTORY_CAP.timestamp]?.value ?? null,
    [NATIVE_HISTORY_CAP.program]: historyCapabilities[HISTORY_CAP.program]?.value ?? null,
    [NATIVE_HISTORY_CAP.totalDurationMin]: historyCapabilities[HISTORY_CAP.totalDurationMin]?.value ?? null,
    [NATIVE_HISTORY_CAP.totalWaterLiters]: historyCapabilities[HISTORY_CAP.totalWaterLiters]?.value ?? null,
    [NATIVE_HISTORY_CAP.accumulatedLiters]: historyCapabilities[HISTORY_CAP.accumulatedLiters]?.value ?? 0,
    [NATIVE_HISTORY_CAP.wateringCount]: historyCapabilities[HISTORY_CAP.wateringCount]?.value ?? 0,
    [NATIVE_HISTORY_CAP.accumulatedDurationMin]: historyCapabilities[HISTORY_CAP.accumulatedDurationMin]?.value ?? 0,
    ...Object.fromEntries(Object.entries(NATIVE_HISTORY_CAP.sectorLastWatering).map(([sector, capability]) => [
      capability,
      sector === '1' ? historyCapabilities[HISTORY_CAP.sectorLastWatering1]?.value ?? null : null,
    ])),
    ...Object.fromEntries(Object.entries(NATIVE_HISTORY_CAP.sectorDurationMin).map(([sector, capability]) => [
      capability,
      sector === '1' ? historyCapabilities[HISTORY_CAP.sectorDurationMin1]?.value ?? 0 : 0,
    ])),
    ...Object.fromEntries(Object.entries(NATIVE_HISTORY_CAP.sectorLiters).map(([sector, capability]) => [
      capability,
      sector === '1' ? historyCapabilities[HISTORY_CAP.sectorLiters1]?.value ?? 0 : 0,
    ])),
    ...Object.fromEntries(Object.entries(NATIVE_HISTORY_CAP.sectorAvgFlow).map(([sector, capability]) => [
      capability,
      sector === '1' ? historyCapabilities[HISTORY_CAP.sectorAvgFlow1]?.value ?? 0 : 0,
    ])),
  };
}

function createService({
  historyEntries = [latestEntry()],
  appStateEngineHistoryEntries = historyEntries,
  appStateLastProjectedEventId = null,
  historyCapabilities = baseHistoryCapabilities(),
  mode = MODE.SHADOW,
  engineMode = MODE.SHADOW,
  includeNativeHistory = true,
} = {}) {
  const writes = [];
  const capabilityWrites = [];
  const stateWrites = [];
  const appStateData = {
    version: 1,
    updatedTs: 0,
    health: null,
    history: {
      lastProjectedEventId: appStateLastProjectedEventId,
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
      history: appStateEngineHistoryEntries,
      lastTickTs: 0,
    },
    events: [],
  };
  const devices = {
    [DEVICES.raw]: createDevice(DEVICES.raw, {
      'measure_generic.l1_litros__ltimo': capability(12.5),
    }, capabilityWrites),
  };
  const apiClient = {
    async getApi() {
      return {
        devices: {
          async getDevice({ id }) {
            if (!devices[id]) throw new Error(`Device ${id} unavailable`);
            return devices[id];
          },
        },
      };
    },
  };

  const service = new HistoryService({
    homey: {
      setInterval() {
        return 1;
      },
      clearInterval() {},
      app: {},
    },
    apiClient,
    appStateStore: {
      async getState() {
        return appStateData;
      },
      async setHistoryProjection({ lastProjectedEventId, lastProjection }) {
        appStateData.history.lastProjectedEventId = lastProjectedEventId;
        appStateData.history.lastProjection = lastProjection;
        stateWrites.push({ lastProjectedEventId, lastProjection });
        return appStateData;
      },
    },
    controlStore: {
      async getControl() {
        return {
          services: {
            [SERVICE.HISTORY]: mode,
            [SERVICE.ENGINE]: engineMode,
          },
        };
      },
    },
    now: () => NOW,
    logger: {
      log() {},
      error() {},
    },
  });

  if (includeNativeHistory) {
    const nativeValues = nativeHistoryValuesFromCapabilities(historyCapabilities);
    service.nativeDevices.add({
      getData() {
        return { id: NATIVE_HISTORY_DEVICE_DATA_ID };
      },
      hasCapability(capabilityId) {
        return Object.prototype.hasOwnProperty.call(nativeValues, capabilityId);
      },
      getCapabilityValue(capabilityId) {
        return nativeValues[capabilityId];
      },
      async setCapabilityValue(capabilityId, value) {
        capabilityWrites.push({ device: DEVICES.nativeHistory, capabilityId, value });
        nativeValues[capabilityId] = value;
      },
    });
  }

  return { service, writes, capabilityWrites, stateWrites, appStateData };
}

test('reports a matching already projected history event without writes', async () => {
  const { service, writes } = createService();

  const projection = await service.check();

  assert.equal(projection.mode, 'SHADOW');
  assert.equal(projection.status, 'READY');
  assert.equal(projection.alreadyProjected, true);
  assert.equal(projection.wouldProject, false);
  assert.equal(projection.comparison.matchesNativeHistoryDevice, true);
  assert.deepEqual(writes, []);
});

test('does not bootstrap app-state idempotency from appState in ACTIVE_COMPAT mode', async () => {
  const { service, writes, capabilityWrites, stateWrites } = createService({
    mode: MODE.ACTIVE_COMPAT,
  });

  const projection = await service.check();

  assert.equal(projection.mode, MODE.ACTIVE_COMPAT);
  assert.equal(projection.alreadyProjected, true);
  assert.equal(projection.wouldProject, false);
  assert.equal(projection.writesOperationalVariables, false);
  assert.equal(projection.writesInternalState, true);
  assert.equal(projection.idempotencySource, 'appStateV2');
  assert.equal(projection.needsAppStateBootstrap, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(capabilityWrites, []);
  assert.equal(stateWrites.length, 1);
  assert.equal(stateWrites[0].lastProjectedEventId, '1784323620295-1');
});

test('keeps an app-state projected event idempotent in ACTIVE_COMPAT mode', async () => {
  const { service, writes, capabilityWrites, stateWrites } = createService({
    mode: MODE.ACTIVE_COMPAT,
    appStateLastProjectedEventId: '1784323620295-1',
  });

  const projection = await service.check();

  assert.equal(projection.alreadyProjected, true);
  assert.equal(projection.wouldProject, false);
  assert.equal(projection.lastProjectedHistoryId, '1784323620295-1');
  assert.deepEqual(writes, []);
  assert.deepEqual(capabilityWrites, []);
  assert.deepEqual(stateWrites, []);
});

test('calculates what a pending history event would project', async () => {
  const { service, writes } = createService({
    historyEntries: [latestEntry({
      id: '1784325000000-1',
      endTs: 1784325000000,
      plannedDurationMin: 5,
      liters: 10,
    })],
  });

  const projection = await service.check();

  assert.equal(projection.alreadyProjected, false);
  assert.equal(projection.wouldProject, true);
  assert.equal(projection.expected[HISTORY_CAP.lastWatering], 'S1 · 10 L · 5 min · timeout');
  assert.equal(projection.expected[HISTORY_CAP.accumulatedLiters], 1517);
  assert.equal(projection.expected[HISTORY_CAP.wateringCount], 91);
  assert.equal(projection.expected[HISTORY_CAP.accumulatedDurationMin], 1512);
  assert.equal(projection.comparison.matchesNativeHistoryDevice, false);
  assert.deepEqual(writes, []);
});

test('projects a pending event and advances app-state history idempotency in ACTIVE_COMPAT mode', async () => {
  const { service, writes, capabilityWrites, stateWrites } = createService({
    mode: MODE.ACTIVE_COMPAT,
    historyEntries: [latestEntry({
      id: '1784325000000-1',
      endTs: 1784325000000,
      plannedDurationMin: 5,
      liters: 10,
    })],
  });

  const projection = await service.check();

  assert.equal(projection.mode, MODE.ACTIVE_COMPAT);
  assert.equal(projection.status, 'READY');
  assert.equal(projection.alreadyProjected, true);
  assert.equal(projection.wouldProject, false);
  assert.equal(projection.writesOperationalVariables, false);
  assert.equal(projection.writesInternalState, true);
  assert.deepEqual(writes, []);
  assert.equal(stateWrites.length, 1);
  assert.equal(stateWrites[0].lastProjectedEventId, '1784325000000-1');
  assert.equal(stateWrites[0].lastProjection.resolved.eventId, '1784325000000-1');
  assert(capabilityWrites.some(write => (
    write.device === DEVICES.nativeHistory
    && write.capabilityId === NATIVE_HISTORY_CAP.lastWatering
    && write.value === 'S1 · 10 L · 5 min · timeout'
  )));
  assert(capabilityWrites.some(write => (
    write.capabilityId === NATIVE_HISTORY_CAP.accumulatedLiters
    && write.value === 1517
  )));
});

test('reads native engine history only when engine migration is ACTIVE_COMPAT', async () => {
  const { service } = createService({
    mode: MODE.ACTIVE_COMPAT,
    engineMode: MODE.ACTIVE_COMPAT,
    historyEntries: [latestEntry({
      id: 'logic-event',
      endTs: 1784325000000,
      plannedDurationMin: 5,
      liters: 10,
    })],
    appStateEngineHistoryEntries: [latestEntry({
      id: 'appstate-event',
      endTs: 1784325100000,
      plannedDurationMin: 8,
      liters: 20,
    })],
  });

  const projection = await service.check();

  assert.equal(projection.latestEntry.id, 'appstate-event');
  assert.equal(projection.status, 'READY');
  assert.equal(projection.expected[HISTORY_CAP.lastWatering], 'S1 · 20 L · 8 min · timeout');
});

test('uses RAW liters fallback when the engine history entry has no liters', async () => {
  const { service } = createService({
    historyEntries: [latestEntry({
      id: '1784325000000-1',
      liters: null,
    })],
  });

  const projection = await service.check();

  assert.equal(projection.resolved.liters, 12.5);
  assert.equal(projection.expected[HISTORY_CAP.totalWaterLiters], 12.5);
});

test('does not project invalid sectors', async () => {
  const { service, writes } = createService({
    historyEntries: [latestEntry({ sector: 9 })],
  });

  const projection = await service.check();

  assert.equal(projection.status, 'INVALID_EVENT');
  assert.equal(projection.resolved.sector, 9);
  assert.deepEqual(writes, []);
});

test('projects history to a registered native history device', async () => {
  const nativeWrites = [];
  const nativeValues = Object.fromEntries(
    [
      NATIVE_HISTORY_CAP.lastWatering,
      NATIVE_HISTORY_CAP.timestamp,
      NATIVE_HISTORY_CAP.program,
      NATIVE_HISTORY_CAP.totalDurationMin,
      NATIVE_HISTORY_CAP.totalWaterLiters,
      NATIVE_HISTORY_CAP.accumulatedLiters,
      NATIVE_HISTORY_CAP.wateringCount,
      NATIVE_HISTORY_CAP.accumulatedDurationMin,
      ...Object.values(NATIVE_HISTORY_CAP.sectorLastWatering),
      ...Object.values(NATIVE_HISTORY_CAP.sectorDurationMin),
      ...Object.values(NATIVE_HISTORY_CAP.sectorLiters),
      ...Object.values(NATIVE_HISTORY_CAP.sectorAvgFlow),
    ].map(capabilityId => [capabilityId, null]),
  );
  const nativeDevice = {
    getData() {
      return { id: NATIVE_HISTORY_DEVICE_DATA_ID };
    },
    hasCapability(capabilityId) {
      return Object.prototype.hasOwnProperty.call(nativeValues, capabilityId);
    },
    getCapabilityValue(capabilityId) {
      return nativeValues[capabilityId];
    },
    async setCapabilityValue(capabilityId, value) {
      nativeWrites.push({ capabilityId, value });
      nativeValues[capabilityId] = value;
    },
  };
  const { service, writes } = createService({ includeNativeHistory: false });

  await service.registerNativeDevice(nativeDevice);

  assert.deepEqual(writes, []);
  assert(nativeWrites.some(write => (
    write.capabilityId === NATIVE_HISTORY_CAP.lastWatering
    && write.value === 'S1 · 0 L · 6 min · timeout'
  )));
  assert(nativeWrites.some(write => (
    write.capabilityId === NATIVE_HISTORY_CAP.totalWaterLiters
    && write.value === 0
  )));
  assert(nativeWrites.some(write => (
    write.capabilityId === NATIVE_HISTORY_CAP.sectorLiters[1]
    && write.value === 0
  )));
  assert(nativeWrites.some(write => (
    write.capabilityId === NATIVE_HISTORY_CAP.sectorLastWatering[1]
    && write.value === '17/07/2026, 23:27 · 0 L · 6 min'
  )));
});

test('projects to native history and advances app-state when native history devices are missing', async () => {
  const nativeWrites = [];
  const nativeValues = Object.fromEntries(
    [
      NATIVE_HISTORY_CAP.lastWatering,
      NATIVE_HISTORY_CAP.timestamp,
      NATIVE_HISTORY_CAP.program,
      NATIVE_HISTORY_CAP.totalDurationMin,
      NATIVE_HISTORY_CAP.totalWaterLiters,
      NATIVE_HISTORY_CAP.accumulatedLiters,
      NATIVE_HISTORY_CAP.wateringCount,
      NATIVE_HISTORY_CAP.accumulatedDurationMin,
      ...Object.values(NATIVE_HISTORY_CAP.sectorLastWatering),
      ...Object.values(NATIVE_HISTORY_CAP.sectorDurationMin),
      ...Object.values(NATIVE_HISTORY_CAP.sectorLiters),
      ...Object.values(NATIVE_HISTORY_CAP.sectorAvgFlow),
    ].map(capabilityId => [capabilityId, 0]),
  );
  nativeValues[NATIVE_HISTORY_CAP.accumulatedLiters] = 1507;
  nativeValues[NATIVE_HISTORY_CAP.wateringCount] = 90;
  nativeValues[NATIVE_HISTORY_CAP.accumulatedDurationMin] = 1507;
  const nativeDevice = {
    getData() {
      return { id: NATIVE_HISTORY_DEVICE_DATA_ID };
    },
    hasCapability(capabilityId) {
      return Object.prototype.hasOwnProperty.call(nativeValues, capabilityId);
    },
    getCapabilityValue(capabilityId) {
      return nativeValues[capabilityId];
    },
    async setCapabilityValue(capabilityId, value) {
      nativeWrites.push({ capabilityId, value });
      nativeValues[capabilityId] = value;
    },
  };
  const { service, capabilityWrites, stateWrites } = createService({
    mode: MODE.ACTIVE_COMPAT,
    historyEntries: [latestEntry({
      id: '1784325000000-1',
      endTs: 1784325000000,
      plannedDurationMin: 5,
      liters: 10,
    })],
    includeNativeHistory: false,
  });

  await service.registerNativeDevice(nativeDevice);
  const projection = await service.check();

  assert.equal(projection.targetDeviceAvailable, true);
  assert.equal(projection.status, 'READY');
  assert.equal(stateWrites.at(-1).lastProjectedEventId, '1784325000000-1');
  assert(!((projection.applied || []).some(write => write.reason === 'LEGACY_DEVICE_NOT_FOUND')));
  assert.deepEqual(capabilityWrites, []);
  assert(nativeWrites.some(write => (
    write.capabilityId === NATIVE_HISTORY_CAP.accumulatedLiters
    && write.value === 1517
  )));
});

test('ensureNativeDevice returns an existing native history device without duplicating it', async () => {
  const existingDevice = {
    id: 'native-history-device-id',
    name: 'Historico de Riego v2',
    driverId: NATIVE_HISTORY_DRIVER_ID,
    data: {
      id: NATIVE_HISTORY_DEVICE_DATA_ID,
    },
    available: true,
  };
  let createPairSessionCalls = 0;
  const { service } = createService();
  service.apiClient = {
    async getApi() {
      return {
        devices: {
          async getDevices() {
            return {
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
      };
    },
  };

  const result = await service.ensureNativeDevice();

  assert.equal(result.created, false);
  assert.equal(result.reason, 'ALREADY_EXISTS');
  assert.equal(result.device.id, existingDevice.id);
  assert.equal(createPairSessionCalls, 0);
});
