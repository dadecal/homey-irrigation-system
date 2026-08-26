'use strict';

const { MODE, SERVICE } = require('./constants');
const { readLatestEngineHistoryEntry } = require('./engine-state-source');

const DEVICES = {
  raw: '1120df26-8201-49de-b262-8fb98289d811',
};

const NATIVE_HISTORY_DRIVER_ID = 'homey:app:com.dadecal.irrigation.v2:irrigation_history';
const NATIVE_HISTORY_DEVICE_DATA_ID = 'irrigation_history';
const NATIVE_HISTORY_DEVICE_NAME = 'Historico de Riego v2';
const NATIVE_HISTORY_DEFAULT_ZONE_ID = 'c00ba2c5-9d67-4e16-89c0-cc4ef82b5d1f';

const RAW_CAP = {
  lastLiters: {
    1: 'measure_generic.l1_litros__ltimo',
    2: 'measure_generic.l2_litros__ltimo',
    3: 'measure_generic.l3_litros__ltimo',
    4: 'measure_generic.l4_litros__ltimo',
    5: 'measure_generic.l5_litros__ltimo',
    6: 'measure_generic.l6_litros__ltimo',
  },
};

function getRawValue(device, capability, fallback = null) {
  return device?.capabilitiesObj?.[capability]?.value ?? fallback;
}

const HISTORY_CAP = {
  lastWatering: 'devicecapabilities_text-custom_40.text2',
  totalDurationMin: 'measure_devicecapabilities_number.number4',
  totalWaterLiters: 'measure_devicecapabilities_number.number5',
  accumulatedLiters: 'measure_devicecapabilities_number.number21',

  timestamp: 'devicecapabilities_text-custom_61.text3',
  program: 'devicecapabilities_text-custom_20.text4',
  sectorLastWatering: {
    1: 'devicecapabilities_text-custom_40.text1',
    2: 'devicecapabilities_text-custom_40.text5',
    3: 'devicecapabilities_text-custom_40.text6',
    4: 'devicecapabilities_text-custom_40.text7',
    5: 'devicecapabilities_text-custom_40.text8',
    6: 'devicecapabilities_text-custom_40.text9',
  },

  sectorDurationMin: {
    1: 'measure_devicecapabilities_number.number1',
    2: 'measure_devicecapabilities_number.number6',
    3: 'measure_devicecapabilities_number.number9',
    4: 'measure_devicecapabilities_number.number12',
    5: 'measure_devicecapabilities_number.number15',
    6: 'measure_devicecapabilities_number.number18',
  },
  sectorLiters: {
    1: 'measure_devicecapabilities_number.number2',
    2: 'measure_devicecapabilities_number.number7',
    3: 'measure_devicecapabilities_number.number10',
    4: 'measure_devicecapabilities_number.number13',
    5: 'measure_devicecapabilities_number.number16',
    6: 'measure_devicecapabilities_number.number19',
  },
  sectorAvgFlow: {
    1: 'measure_devicecapabilities_number.number3',
    2: 'measure_devicecapabilities_number.number8',
    3: 'measure_devicecapabilities_number.number11',
    4: 'measure_devicecapabilities_number.number14',
    5: 'measure_devicecapabilities_number.number17',
    6: 'measure_devicecapabilities_number.number20',
  },

  wateringCount: 'measure_devicecapabilities_number.number22',
  accumulatedDurationMin: 'measure_devicecapabilities_number.number23',
};

const NATIVE_HISTORY_CAP = {
  lastWatering: 'irrigation_history_last_watering',
  timestamp: 'irrigation_history_timestamp',
  program: 'irrigation_history_program',
  totalDurationMin: 'irrigation_history_last_duration',
  totalWaterLiters: 'irrigation_history_last_liters',
  accumulatedLiters: 'irrigation_history_accumulated_liters',
  wateringCount: 'irrigation_history_watering_count',
  accumulatedDurationMin: 'irrigation_history_accumulated_duration',
  sectorLastWatering: {
    1: 'irrigation_history_sector_1_last',
    2: 'irrigation_history_sector_2_last',
    3: 'irrigation_history_sector_3_last',
    4: 'irrigation_history_sector_4_last',
    5: 'irrigation_history_sector_5_last',
    6: 'irrigation_history_sector_6_last',
  },
  sectorDurationMin: {
    1: 'irrigation_history_sector_1_duration',
    2: 'irrigation_history_sector_2_duration',
    3: 'irrigation_history_sector_3_duration',
    4: 'irrigation_history_sector_4_duration',
    5: 'irrigation_history_sector_5_duration',
    6: 'irrigation_history_sector_6_duration',
  },
  sectorLiters: {
    1: 'irrigation_history_sector_1_liters',
    2: 'irrigation_history_sector_2_liters',
    3: 'irrigation_history_sector_3_liters',
    4: 'irrigation_history_sector_4_liters',
    5: 'irrigation_history_sector_5_liters',
    6: 'irrigation_history_sector_6_liters',
  },
  sectorAvgFlow: {
    1: 'irrigation_history_sector_1_avg_flow',
    2: 'irrigation_history_sector_2_avg_flow',
    3: 'irrigation_history_sector_3_avg_flow',
    4: 'irrigation_history_sector_4_avg_flow',
    5: 'irrigation_history_sector_5_avg_flow',
    6: 'irrigation_history_sector_6_avg_flow',
  },
};

const CHECK_INTERVAL_MS = 60 * 1000;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseHistory(value) {
  try {
    const entries = value ? JSON.parse(value) : [];
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    return [];
  }
}

function getNativeValue(device, capability, fallback = null) {
  if (!device?.hasCapability?.(capability)) return fallback;
  const value = device.getCapabilityValue?.(capability);
  return value ?? fallback;
}

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber)
    && Number.isFinite(rightNumber)
    && Math.abs(leftNumber - rightNumber) < 0.000001;
}

function toCapabilityMap(entries) {
  return Object.fromEntries(entries.map(entry => [entry.capability, entry.value]));
}

function isNativeHistoryDevice(device) {
  const dataId = device?.data?.id;
  const driverId = String(device?.driverId || '');
  const driverUri = String(device?.driverUri || '');

  return dataId === NATIVE_HISTORY_DEVICE_DATA_ID
    && (
      driverId === NATIVE_HISTORY_DRIVER_ID
      || driverId === 'irrigation_history'
      || driverId.endsWith(':irrigation_history')
      || driverUri === 'homey:app:com.dadecal.irrigation.v2'
    );
}

function summarizeDevice(device) {
  return {
    id: device?.id || null,
    name: device?.name || null,
    driverId: device?.driverId || null,
    data: device?.data || null,
    available: device?.available ?? null,
  };
}

async function setNativeCapabilityIfNeeded(device, capability, value) {
  if (!device?.hasCapability?.(capability)) {
    return { capability, skipped: true, reason: 'CAPABILITY_NOT_FOUND' };
  }

  if (value === null || value === undefined) {
    return { capability, skipped: true, reason: 'VALUE_UNAVAILABLE' };
  }

  const current = device.getCapabilityValue(capability);
  if (sameValue(current, value)) {
    return { capability, skipped: true, reason: 'UNCHANGED', current };
  }

  await device.setCapabilityValue(capability, value);
  return { capability, skipped: false, previous: current, value };
}

class HistoryService {
  constructor({
    homey,
    apiClient,
    appStateStore = null,
    controlStore = null,
    now = () => Date.now(),
    logger = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.appStateStore = appStateStore;
    this.controlStore = controlStore;
    this.now = now;
    this.logger = logger || homey.app;
    this.timer = null;
    this.checking = false;
    this.lastProjection = null;
    this.lastError = null;
    this.nativeDevices = new Set();
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = this.homey.setInterval(() => {
      this.check().catch(error => {
        this.lastError = {
          ts: this.now(),
          message: error.message,
        };
        this.logger.error('History shadow check failed', error);
      });
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  async getApi() {
    return this.apiClient.getApi();
  }

  async getDevice(id) {
    const api = await this.getApi();

    if (api.devices?.getDevice) {
      return api.devices.getDevice({ id });
    }

    const devices = await api.devices.getDevices();
    return devices[id] || null;
  }

  async getOptionalDevice(id) {
    try {
      return await this.getDevice(id);
    } catch (error) {
      return null;
    }
  }

  async findPairedNativeHistoryDevices() {
    const api = await this.getApi();
    if (!api.devices?.getDevices) {
      throw new Error('Homey API devices.getDevices is not available');
    }

    const devices = await api.devices.getDevices();
    return Object.values(devices || {})
      .filter(isNativeHistoryDevice)
      .map(summarizeDevice);
  }

  async ensureNativeDevice({ zoneId = NATIVE_HISTORY_DEFAULT_ZONE_ID } = {}) {
    const existing = await this.findPairedNativeHistoryDevices();
    if (existing.length > 0) {
      return {
        created: false,
        reason: 'ALREADY_EXISTS',
        device: existing[0],
        devices: existing,
      };
    }

    const api = await this.getApi();
    if (!api.drivers?.createPairSession || !api.drivers?.createPairSessionDevice) {
      throw new Error('Homey API drivers pairing methods are not available');
    }

    let pairSession = null;
    try {
      pairSession = await api.drivers.createPairSession({
        pairsession: {
          type: 'pair',
          driverId: NATIVE_HISTORY_DRIVER_ID,
          ...(zoneId ? { zoneId } : {}),
        },
      });

      if (!pairSession?.id) {
        throw new Error('Homey API did not return a pair session id');
      }

      const createdDevice = await api.drivers.createPairSessionDevice({
        id: pairSession.id,
        device: {
          name: NATIVE_HISTORY_DEVICE_NAME,
          data: {
            id: NATIVE_HISTORY_DEVICE_DATA_ID,
          },
        },
      });

      return {
        created: true,
        reason: 'CREATED',
        pairSessionId: pairSession.id,
        device: summarizeDevice(createdDevice),
      };
    } finally {
      if (pairSession?.id && api.drivers?.deletePairSession) {
        await api.drivers.deletePairSession({ id: pairSession.id }).catch(error => {
          this.logger.error('Could not close native history pair session', error);
        });
      }
    }
  }

  async status() {
    const mode = await this.getMode();
    let pairedHomeyDevices = null;
    let pairingError = null;

    try {
      pairedHomeyDevices = await this.findPairedNativeHistoryDevices();
    } catch (error) {
      pairingError = error.message;
    }

    return {
      mode,
      shadow: mode === MODE.SHADOW,
      updatesDevices: mode === MODE.ACTIVE_COMPAT,
      updatesNativeDevices: true,
      writesOperationalVariables: false,
      writesInternalState: mode === MODE.ACTIVE_COMPAT,
      checkIntervalMs: CHECK_INTERVAL_MS,
      timerActive: Boolean(this.timer),
      pairedNativeDevices: this.nativeDevices.size,
      pairedHomeyDevices,
      expectedNativeDevice: {
        name: NATIVE_HISTORY_DEVICE_NAME,
        driverId: NATIVE_HISTORY_DRIVER_ID,
        data: {
          id: NATIVE_HISTORY_DEVICE_DATA_ID,
        },
      },
      pairingError,
      lastProjection: this.lastProjection,
      lastError: this.lastError,
    };
  }

  async registerNativeDevice(device) {
    this.nativeDevices.add(device);
    return this.check().catch(error => {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      this.logger.error('Initial native history projection failed', error);
    });
  }

  unregisterNativeDevice(device) {
    this.nativeDevices.delete(device);
  }

  async check() {
    if (this.checking) {
      return { skipped: true, reason: 'ALREADY_RUNNING' };
    }

    this.checking = true;

    try {
      const projection = await this.buildProjection();
      const applied = projection.mode === MODE.ACTIVE_COMPAT
        ? await this.applyProjection(projection)
        : [];
      if (applied.length > 0) {
        projection.applied = applied;
        projection.current = {
          ...projection.current,
          ...projection.expected,
        };
        projection.comparison = {
          matchesNativeHistoryDevice: true,
          differences: [],
        };
        projection.status = 'READY';
        projection.summary = projection.alreadyProjected
          ? 'OK - historico ya estaba proyectado'
          : 'OK - historico proyectado';
      }
      const nativeApplied = await this.applyNativeProjection(projection);
      if (nativeApplied.length > 0) {
        projection.nativeApplied = nativeApplied;
      }
      this.lastProjection = projection;
      this.lastError = null;
      this.logger.log(`History ${projection.mode} check: ${projection.summary}`);
      return projection;
    } catch (error) {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      throw error;
    } finally {
      this.checking = false;
    }
  }

  async getLatestEngineHistoryEntry() {
    const mode = await this.getMode();
    const { entry } = await readLatestEngineHistoryEntry({
      appStateStore: this.appStateStore,
    });
    return entry;
  }

  async buildProjection() {
    const now = this.now();
    const mode = await this.getMode();
    const latestEntry = await this.getLatestEngineHistoryEntry();
    const appState = this.appStateStore ? await this.appStateStore.getState() : null;
    const appStateLastProjectedEventId = String(appState?.history?.lastProjectedEventId || '');
    const lastProjectedHistoryId = appStateLastProjectedEventId;

    if (!latestEntry) {
      return {
        version: 1,
        mode,
        shadow: mode === MODE.SHADOW,
        updatesDevices: mode === MODE.ACTIVE_COMPAT,
        writesOperationalVariables: false,
        updatedTs: now,
        status: 'NO_HISTORY',
        summary: 'OK - sin historico persistido que proyectar',
        latestEntry: null,
        lastProjectedHistoryId,
        appStateLastProjectedEventId,
      };
    }

    const nativeHistory = [...this.nativeDevices][0] || null;
    const raw = latestEntry.liters === undefined || latestEntry.liters === null
      ? await this.getOptionalDevice(DEVICES.raw)
      : null;

    const input = {
      id: latestEntry.id,
      sector: latestEntry.sector,
      source: latestEntry.source,
      origin: latestEntry.source,
      reason: latestEntry.reason,
      endTs: latestEntry.endTs,
      durationMin: latestEntry.reason === 'timeout'
        ? latestEntry.plannedDurationMin
        : latestEntry.durationRealMin,
      liters: latestEntry.liters,
      program: 'manual',
    };

    const sector = Number(input.sector ?? 0);
    const durationMin = round(Number(input.durationMin ?? 0), 2);
    const program = String(input.program ?? 'manual');
    const origin = String(input.origin ?? 'MANUAL');
    const reason = String(input.reason ?? 'completed');
    const eventEndTs = Number(input.endTs ?? now);
    const eventId = String(input.id ?? `${eventEndTs}-${sector}`);
    const storedProjection = appState?.history?.lastProjection?.eventId === eventId
      ? appState.history.lastProjection
      : null;
    const storedExpected = storedProjection?.expected && typeof storedProjection.expected === 'object'
      ? storedProjection.expected
      : {};

    if (!Number.isInteger(sector) || sector < 1 || sector > 6) {
      return {
        version: 1,
        mode,
        shadow: mode === MODE.SHADOW,
        updatesDevices: mode === MODE.ACTIVE_COMPAT,
        writesOperationalVariables: false,
        updatedTs: now,
        status: 'INVALID_EVENT',
        summary: `ERROR - sector historico invalido: ${sector}`,
        latestEntry,
        resolved: { eventId, sector, durationMin, origin, program, reason },
        lastProjectedHistoryId,
        appStateLastProjectedEventId,
      };
    }

    const liters = round(input.liters ?? getRawValue(raw, RAW_CAP.lastLiters[sector], 0), 2);
    const avgFlow = durationMin > 0 ? round(liters / durationMin, 2) : 0;
    const timestamp = formatTimestamp(new Date(eventEndTs));
    const lastWateringText = `S${sector} · ${liters} L · ${durationMin} min · ${reason}`;
    const sectorText = `${timestamp} · ${liters} L · ${durationMin} min`;

    const current = {
      [HISTORY_CAP.lastWatering]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.lastWatering),
      [HISTORY_CAP.timestamp]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.timestamp),
      [HISTORY_CAP.program]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.program),
      [HISTORY_CAP.totalDurationMin]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.totalDurationMin),
      [HISTORY_CAP.totalWaterLiters]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.totalWaterLiters),
      [HISTORY_CAP.sectorLastWatering[sector]]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.sectorLastWatering[sector]),
      [HISTORY_CAP.sectorDurationMin[sector]]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.sectorDurationMin[sector]),
      [HISTORY_CAP.sectorLiters[sector]]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.sectorLiters[sector]),
      [HISTORY_CAP.sectorAvgFlow[sector]]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.sectorAvgFlow[sector]),
      [HISTORY_CAP.accumulatedLiters]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.accumulatedLiters, 0),
      [HISTORY_CAP.wateringCount]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.wateringCount, 0),
      [HISTORY_CAP.accumulatedDurationMin]: getNativeValue(nativeHistory, NATIVE_HISTORY_CAP.accumulatedDurationMin, 0),
    };

    for (let itemSector = 1; itemSector <= 6; itemSector += 1) {
      current[HISTORY_CAP.sectorLastWatering[itemSector]] = getNativeValue(
        nativeHistory,
        NATIVE_HISTORY_CAP.sectorLastWatering[itemSector],
      );
      current[HISTORY_CAP.sectorDurationMin[itemSector]] = getNativeValue(
        nativeHistory,
        NATIVE_HISTORY_CAP.sectorDurationMin[itemSector],
        0,
      );
      current[HISTORY_CAP.sectorLiters[itemSector]] = getNativeValue(
        nativeHistory,
        NATIVE_HISTORY_CAP.sectorLiters[itemSector],
        0,
      );
      current[HISTORY_CAP.sectorAvgFlow[itemSector]] = getNativeValue(
        nativeHistory,
        NATIVE_HISTORY_CAP.sectorAvgFlow[itemSector],
        0,
      );
    }

    const alreadyProjectedById = Boolean(eventId) && lastProjectedHistoryId === eventId;
    const alreadyProjectedByNativeState = Boolean(nativeHistory)
      && sameValue(current[HISTORY_CAP.lastWatering], lastWateringText)
      && sameValue(current[HISTORY_CAP.timestamp], timestamp)
      && sameValue(current[HISTORY_CAP.program], `${origin}/${program}`)
      && sameValue(current[HISTORY_CAP.totalDurationMin], durationMin)
      && sameValue(current[HISTORY_CAP.totalWaterLiters], liters);
    const alreadyProjected = alreadyProjectedById || alreadyProjectedByNativeState;
    const needsAppStateBootstrap = mode === MODE.ACTIVE_COMPAT
      && Boolean(eventId)
      && !appStateLastProjectedEventId
      && alreadyProjectedByNativeState;

    const expectedEntries = [
      { field: 'lastWatering', capability: HISTORY_CAP.lastWatering, value: lastWateringText },
      { field: 'timestamp', capability: HISTORY_CAP.timestamp, value: timestamp },
      { field: 'program', capability: HISTORY_CAP.program, value: `${origin}/${program}` },
      { field: 'totalDurationMin', capability: HISTORY_CAP.totalDurationMin, value: durationMin },
      { field: 'totalWaterLiters', capability: HISTORY_CAP.totalWaterLiters, value: liters },
      { field: `sector${sector}LastWatering`, capability: HISTORY_CAP.sectorLastWatering[sector], value: sectorText },
      { field: `sector${sector}DurationMin`, capability: HISTORY_CAP.sectorDurationMin[sector], value: durationMin },
      { field: `sector${sector}Liters`, capability: HISTORY_CAP.sectorLiters[sector], value: liters },
      { field: `sector${sector}AvgFlow`, capability: HISTORY_CAP.sectorAvgFlow[sector], value: avgFlow },
    ];

    if (!alreadyProjected) {
      expectedEntries.push(
        {
          field: 'accumulatedLiters',
          capability: HISTORY_CAP.accumulatedLiters,
          value: round((Number(current[HISTORY_CAP.accumulatedLiters]) || 0) + liters, 2),
        },
        {
          field: 'wateringCount',
          capability: HISTORY_CAP.wateringCount,
          value: (Number(current[HISTORY_CAP.wateringCount]) || 0) + 1,
        },
        {
          field: 'accumulatedDurationMin',
          capability: HISTORY_CAP.accumulatedDurationMin,
          value: round((Number(current[HISTORY_CAP.accumulatedDurationMin]) || 0) + durationMin, 2),
        },
      );
    }

    const expected = toCapabilityMap(expectedEntries);
    const nativeExpectedEntries = [
      {
        field: 'lastWatering',
        capability: NATIVE_HISTORY_CAP.lastWatering,
        value: expected[HISTORY_CAP.lastWatering],
      },
      {
        field: 'timestamp',
        capability: NATIVE_HISTORY_CAP.timestamp,
        value: expected[HISTORY_CAP.timestamp],
      },
      {
        field: 'program',
        capability: NATIVE_HISTORY_CAP.program,
        value: expected[HISTORY_CAP.program],
      },
      {
        field: 'totalDurationMin',
        capability: NATIVE_HISTORY_CAP.totalDurationMin,
        value: expected[HISTORY_CAP.totalDurationMin],
      },
      {
        field: 'totalWaterLiters',
        capability: NATIVE_HISTORY_CAP.totalWaterLiters,
        value: expected[HISTORY_CAP.totalWaterLiters],
      },
      {
        field: 'accumulatedLiters',
        capability: NATIVE_HISTORY_CAP.accumulatedLiters,
        value: expected[HISTORY_CAP.accumulatedLiters]
          ?? storedExpected[HISTORY_CAP.accumulatedLiters]
          ?? current[HISTORY_CAP.accumulatedLiters],
      },
      {
        field: 'wateringCount',
        capability: NATIVE_HISTORY_CAP.wateringCount,
        value: expected[HISTORY_CAP.wateringCount]
          ?? storedExpected[HISTORY_CAP.wateringCount]
          ?? current[HISTORY_CAP.wateringCount],
      },
      {
        field: 'accumulatedDurationMin',
        capability: NATIVE_HISTORY_CAP.accumulatedDurationMin,
        value: expected[HISTORY_CAP.accumulatedDurationMin]
          ?? storedExpected[HISTORY_CAP.accumulatedDurationMin]
          ?? current[HISTORY_CAP.accumulatedDurationMin],
      },
    ];

    for (let itemSector = 1; itemSector <= 6; itemSector += 1) {
      nativeExpectedEntries.push(
        {
          field: `sector${itemSector}LastWatering`,
          capability: NATIVE_HISTORY_CAP.sectorLastWatering[itemSector],
          value: itemSector === sector
            ? expected[HISTORY_CAP.sectorLastWatering[itemSector]]
            : current[HISTORY_CAP.sectorLastWatering[itemSector]],
        },
        {
          field: `sector${itemSector}DurationMin`,
          capability: NATIVE_HISTORY_CAP.sectorDurationMin[itemSector],
          value: itemSector === sector
            ? expected[HISTORY_CAP.sectorDurationMin[itemSector]]
            : current[HISTORY_CAP.sectorDurationMin[itemSector]],
        },
        {
          field: `sector${itemSector}Liters`,
          capability: NATIVE_HISTORY_CAP.sectorLiters[itemSector],
          value: itemSector === sector
            ? expected[HISTORY_CAP.sectorLiters[itemSector]]
            : current[HISTORY_CAP.sectorLiters[itemSector]],
        },
        {
          field: `sector${itemSector}AvgFlow`,
          capability: NATIVE_HISTORY_CAP.sectorAvgFlow[itemSector],
          value: itemSector === sector
            ? expected[HISTORY_CAP.sectorAvgFlow[itemSector]]
            : current[HISTORY_CAP.sectorAvgFlow[itemSector]],
        },
      );
    }

    const differences = expectedEntries
      .filter(entry => !sameValue(entry.value, current[entry.capability]))
      .map(entry => ({
        field: entry.field,
        capability: entry.capability,
        expected: entry.value,
        current: current[entry.capability],
      }));

    return {
      version: 1,
      mode,
      shadow: mode === MODE.SHADOW,
      updatesDevices: mode === MODE.ACTIVE_COMPAT,
      writesOperationalVariables: false,
      writesInternalState: mode === MODE.ACTIVE_COMPAT,
      updatedTs: now,
      status: differences.length === 0 ? 'READY' : 'DIFF',
      summary: differences.length === 0
        ? 'OK - historico proyectado coincide'
        : `WARNING - ${differences.length} diferencias con Historico de Riego v2`,
      latestEntry,
      resolved: {
        eventId,
        sector,
        durationMin,
        liters,
        avgFlow,
        origin,
        program,
        reason,
        timestamp,
      },
      lastProjectedHistoryId,
      appStateLastProjectedEventId,
      idempotencySource: 'appStateV2',
      needsAppStateBootstrap,
      alreadyProjectedByNativeState,
      alreadyProjected,
      wouldProject: !alreadyProjected,
      expected,
      expectedEntries,
      nativeExpected: toCapabilityMap(nativeExpectedEntries),
      nativeExpectedEntries,
      current,
      comparison: {
        matchesNativeHistoryDevice: Boolean(nativeHistory) && differences.length === 0,
        differences: nativeHistory ? differences : [],
      },
      targetDevice: 'native-history-device',
      targetDeviceAvailable: Boolean(nativeHistory),
    };
  }

  async getMode() {
    if (!this.controlStore) {
      return MODE.SHADOW;
    }

    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.HISTORY] || MODE.SHADOW;
  }

  async applyProjection(projection) {
    if (!projection.latestEntry || projection.status === 'INVALID_EVENT') {
      return [];
    }

    const applied = [];

    if (projection.resolved?.eventId && (!projection.alreadyProjected || projection.needsAppStateBootstrap)) {
      const lastProjection = {
        version: projection.version,
        updatedTs: projection.updatedTs,
        eventId: projection.resolved.eventId,
        resolved: projection.resolved,
        expected: projection.expected,
      };

      if (this.appStateStore) {
        await this.appStateStore.setHistoryProjection({
          lastProjectedEventId: projection.resolved.eventId,
          lastProjection,
        });
      }

      applied.push({
        field: 'lastProjectedEventId',
        key: 'appStateV2.history.lastProjectedEventId',
        skipped: !this.appStateStore,
        reason: this.appStateStore ? undefined : 'APP_STATE_STORE_NOT_AVAILABLE',
        value: projection.resolved.eventId,
      });
      projection.lastProjectedHistoryId = projection.resolved.eventId;
      projection.appStateLastProjectedEventId = projection.resolved.eventId;
      projection.alreadyProjected = true;
      projection.wouldProject = false;
      projection.needsAppStateBootstrap = false;
      projection.writesOperationalVariables = false;
      projection.writesInternalState = Boolean(this.appStateStore);
    }

    return applied;
  }

  async applyNativeProjection(projection) {
    if (!projection.latestEntry || projection.status === 'INVALID_EVENT') {
      return [];
    }

    const applied = [];
    for (const device of this.nativeDevices) {
      const deviceResult = [];
      for (const entry of projection.nativeExpectedEntries || []) {
        const result = await setNativeCapabilityIfNeeded(device, entry.capability, entry.value);
        deviceResult.push({ field: entry.field, ...result });
      }
      applied.push({
        deviceId: device.getData?.()?.id || 'unknown',
        capabilities: deviceResult,
      });
    }

    return applied;
  }
}

module.exports = HistoryService;
module.exports.constants = {
  DEVICES,
  HISTORY_CAP,
  NATIVE_HISTORY_CAP,
  NATIVE_HISTORY_DRIVER_ID,
  NATIVE_HISTORY_DEVICE_DATA_ID,
  NATIVE_HISTORY_DEVICE_NAME,
  CHECK_INTERVAL_MS,
};
