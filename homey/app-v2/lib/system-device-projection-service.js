'use strict';

const { readEngineSnapshot } = require('./engine-state-source');

const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';
const SYSTEM_DRIVER_ID = 'homey:app:com.dadecal.irrigation.v2:irrigation_system';
const SYSTEM_DEVICE_DATA_ID = 'irrigation_system';
const SYSTEM_DEVICE_NAME = 'Sistema de Riego v2';
const SYSTEM_DEVICE_DEFAULT_ZONE_ID = 'c00ba2c5-9d67-4e16-89c0-cc4ef82b5d1f';
const CHECK_INTERVAL_MS = 60 * 1000;
const FAST_REFRESH_DELAYS_MS = [1000, 3000, 7000, 15000, 30000];

const CAP = {
  state: 'irrigation_state',
  activeSector: 'irrigation_active_sector',
  remainingMinutes: 'irrigation_remaining_minutes',
  queueLength: 'irrigation_queue_length',
  source: 'irrigation_source',
  program: 'irrigation_program',
  message: 'irrigation_message',
  espConnected: 'irrigation_esp_connected',
  leakStatus: 'irrigation_leak_status',
  temperature: 'irrigation_temperature',
  humidity: 'irrigation_humidity',
  cpuTemperature: 'irrigation_cpu_temperature',
  healthStatus: 'irrigation_health_status',
};

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function descriptor(capabilityId, capability) {
  return normalize([
    capabilityId,
    capability?.title,
    capability?.name,
    capability?.opts?.title,
  ].filter(Boolean).join(' '));
}

function findCapabilitiesByText(device, requiredTerms) {
  return Object.entries(device?.capabilitiesObj || {})
    .filter(([capabilityId, capability]) => {
      const text = descriptor(capabilityId, capability);
      return requiredTerms.every(term => text.includes(normalize(term)));
    })
    .map(([id, capability]) => ({ id, ...capability }));
}

function isActive(value) {
  return value === true || value === 1 || ['true', 'on', 'yes', 'si'].includes(normalize(value));
}

function rawCapabilityValue(raw, capability) {
  return raw?.capabilitiesObj?.[capability]?.value ?? null;
}

function isSystemDevice(device) {
  const dataId = device?.data?.id;
  const driverId = String(device?.driverId || '');
  const driverUri = String(device?.driverUri || '');

  return dataId === SYSTEM_DEVICE_DATA_ID
    && (
      driverId === SYSTEM_DRIVER_ID
      || driverId === 'irrigation_system'
      || driverId.endsWith(':irrigation_system')
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

function parseQueue(value) {
  try {
    const queue = JSON.parse(value || '[]');
    return Array.isArray(queue) ? queue : [];
  } catch (error) {
    return [];
  }
}

function remainingMinutes(state, endTs, now) {
  if (state !== 'RUNNING') return 0;
  const end = Number(endTs) || 0;
  if (end <= now) return 0;
  return Math.ceil((end - now) / 60000);
}

function getLeakStatus(raw) {
  const leakCapabilities = findCapabilitiesByText(raw, ['fuga']);
  if (leakCapabilities.length === 0) return 'Sin datos';

  const activeLeaks = leakCapabilities.filter(capability => isActive(capability.value));
  if (activeLeaks.length === 0) return 'No detectada';

  const sectors = activeLeaks
    .map(capability => descriptor(capability.id, capability).match(/(?:linea|l)[ _-]*(\d)/)?.[1])
    .filter(Boolean);

  return sectors.length > 0
    ? `Detectada: linea ${[...new Set(sectors)].join(', ')}`
    : 'Detectada';
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

async function setCapabilityIfNeeded(device, capability, value) {
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

function messageFor({ state, activeSector, source, stopReason, health }) {
  if (health?.status && health.status !== 'OK') {
    return health.summary || `${health.status} - revisar sistema`;
  }

  if (state === 'RUNNING') {
    return activeSector > 0
      ? `Regando sector ${activeSector}`
      : 'Riego en curso';
  }

  if (state === 'ERROR') {
    return activeSector > 0
      ? `ERROR - comprobar sector ${activeSector}`
      : 'ERROR - comprobar sistema de riego';
  }

  if (stopReason && stopReason !== 'none') {
    return `Sin riego activo. Ultima parada: ${stopReason}`;
  }

  if (source && source !== 'none') {
    return 'Sin riego activo';
  }

  return 'Sin riego activo';
}

class SystemDeviceProjectionService {
  constructor({
    homey,
    apiClient,
    appStateStore,
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
    this.devices = new Set();
    this.fastRefreshTimers = new Set();
    this.lastProjection = null;
    this.lastError = null;
  }

  start() {
    if (this.timer) return;

    this.timer = this.homey.setInterval(() => {
      this.check().catch(error => {
        this.lastError = {
          ts: this.now(),
          message: error.message,
        };
        this.logger.error('System device projection failed', error);
      });
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) return;

    this.homey.clearInterval(this.timer);
    this.timer = null;
    this.clearFastRefreshTimers();
  }

  async registerDevice(device) {
    this.devices.add(device);
    return this.check().catch(error => {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      this.logger.error('Initial system device projection failed', error);
    });
  }

  unregisterDevice(device) {
    this.devices.delete(device);
  }

  clearFastRefreshTimers() {
    for (const timer of this.fastRefreshTimers) {
      this.homey.clearTimeout?.(timer);
    }
    this.fastRefreshTimers.clear();
  }

  scheduleFastRefresh(reason = 'manual-command', delaysMs = FAST_REFRESH_DELAYS_MS) {
    this.clearFastRefreshTimers();

    for (const delayMs of delaysMs) {
      const timer = this.homey.setTimeout(async () => {
        this.fastRefreshTimers.delete(timer);
        try {
          await this.check();
        } catch (error) {
          this.lastError = {
            ts: this.now(),
            message: error.message,
            reason,
          };
          this.logger.error(`System device fast refresh failed (${reason})`, error);
        }
      }, delayMs);
      this.fastRefreshTimers.add(timer);
    }

    return {
      reason,
      delaysMs,
      scheduled: delaysMs.length,
    };
  }

  async status() {
    let pairedHomeyDevices = null;
    let pairingError = null;

    try {
      pairedHomeyDevices = await this.findPairedSystemDevices();
    } catch (error) {
      pairingError = error.message;
    }

    return {
      mode: 'ACTIVE_COMPAT',
      checkIntervalMs: CHECK_INTERVAL_MS,
      timerActive: Boolean(this.timer),
      pairedDevices: this.devices.size,
      registeredDevices: this.devices.size,
      pairedHomeyDevices,
      updatesNativeDevices: true,
      writesOperationalVariables: false,
      expectedDevice: {
        name: SYSTEM_DEVICE_NAME,
        driverId: SYSTEM_DRIVER_ID,
        data: {
          id: SYSTEM_DEVICE_DATA_ID,
        },
      },
      pairingError,
      lastProjection: this.lastProjection,
      lastError: this.lastError,
    };
  }

  async check() {
    if (this.checking) {
      return { skipped: true, reason: 'ALREADY_RUNNING' };
    }

    this.checking = true;

    try {
      const projection = await this.buildProjection();
      const applied = await this.applyProjection(projection);
      projection.applied = applied;
      this.lastProjection = projection;
      this.lastError = null;
      this.logger.log(`System device projection: ${projection.summary}`);
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

  async getApi() {
    return this.apiClient.getApi();
  }

  async getRawDevice() {
    const api = await this.getApi();

    if (api.devices?.getDevice) {
      return api.devices.getDevice({ id: RAW_DEVICE_ID });
    }

    const devices = await api.devices.getDevices();
    return devices[RAW_DEVICE_ID] || null;
  }

  async findPairedSystemDevices() {
    const api = await this.getApi();
    if (!api.devices?.getDevices) {
      throw new Error('Homey API devices.getDevices is not available');
    }

    const devices = await api.devices.getDevices();
    return Object.values(devices || {})
      .filter(isSystemDevice)
      .map(summarizeDevice);
  }

  async ensureDevice({ zoneId = SYSTEM_DEVICE_DEFAULT_ZONE_ID } = {}) {
    const existing = await this.findPairedSystemDevices();
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
          driverId: SYSTEM_DRIVER_ID,
          ...(zoneId ? { zoneId } : {}),
        },
      });

      if (!pairSession?.id) {
        throw new Error('Homey API did not return a pair session id');
      }

      const createdDevice = await api.drivers.createPairSessionDevice({
        id: pairSession.id,
        device: {
          name: SYSTEM_DEVICE_NAME,
          data: {
            id: SYSTEM_DEVICE_DATA_ID,
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
          this.logger.error('Could not close system device pair session', error);
        });
      }
    }
  }

  async buildProjection() {
    const now = this.now();
    const [engine, appState] = await Promise.all([
      readEngineSnapshot({
        appStateStore: this.appStateStore,
      }),
      this.appStateStore.getState(),
    ]);

    let raw = null;
    let rawAvailable = false;
    try {
      raw = await this.getRawDevice();
      rawAvailable = raw?.available !== false;
    } catch (error) {
      this.logger.log(`RAW unavailable for native system projection: ${error.message}`);
    }

    const activeSector = engine.activeSector;
    const endTs = engine.endTs;
    const queue = engine.queue;
    const health = appState.health || null;
    const normalizedState = engine.state;
    const normalizedSource = engine.source;
    const normalizedStopReason = engine.stopReason;

    const values = {
      [CAP.state]: normalizedState,
      [CAP.activeSector]: activeSector,
      [CAP.remainingMinutes]: remainingMinutes(normalizedState, endTs, now),
      [CAP.queueLength]: queue.length,
      [CAP.source]: normalizedSource,
      [CAP.program]: normalizedSource === 'SCHEDULER' || normalizedSource === 'PROGRAM'
        ? normalizedSource
        : 'none',
      [CAP.message]: messageFor({
        state: normalizedState,
        activeSector,
        source: normalizedSource,
        stopReason: normalizedStopReason,
        health,
      }),
      [CAP.espConnected]: rawAvailable ? 'Conectado' : 'Desconectado',
      [CAP.leakStatus]: rawAvailable ? getLeakStatus(raw) : 'Sin conexion',
      [CAP.temperature]: rawAvailable ? rawCapabilityValue(raw, 'measure_temperature.temperatura') : null,
      [CAP.humidity]: rawAvailable ? rawCapabilityValue(raw, 'measure_humidity.humedad_riego') : null,
      [CAP.cpuTemperature]: rawAvailable ? rawCapabilityValue(raw, 'measure_temperature.esp_internal') : null,
      [CAP.healthStatus]: health?.status || 'OK',
    };

    return {
      version: 1,
      updatedTs: now,
      target: 'native-system-device',
      pairedDevices: this.devices.size,
      writesOperationalVariables: false,
      rawAvailable,
      engine: {
        state: normalizedState,
        activeSector,
        startTs: engine.startTs,
        endTs,
        source: normalizedSource,
        stopReason: normalizedStopReason,
        queueLength: queue.length,
        sourceStore: engine.sourceStore,
      },
      health: health
        ? {
            status: health.status,
            summary: health.summary || null,
            updatedTs: health.updatedTs || 0,
          }
        : null,
      values,
      summary: this.devices.size > 0
        ? `OK - ${this.devices.size} device(s) nativo(s) actualizados`
        : 'OK - proyeccion calculada, sin devices nativos emparejados',
    };
  }

  async applyProjection(projection) {
    const applied = [];

    for (const device of this.devices) {
      const deviceResult = [];
      for (const [capability, value] of Object.entries(projection.values)) {
        deviceResult.push(await setCapabilityIfNeeded(device, capability, value));
      }
      applied.push({
        deviceId: device.getData?.()?.id || 'unknown',
        capabilities: deviceResult,
      });
    }

    return applied;
  }
}

module.exports = {
  SystemDeviceProjectionService,
  constants: {
    RAW_DEVICE_ID,
    SYSTEM_DRIVER_ID,
    SYSTEM_DEVICE_DATA_ID,
    SYSTEM_DEVICE_NAME,
    CHECK_INTERVAL_MS,
    FAST_REFRESH_DELAYS_MS,
    CAP,
  },
};
