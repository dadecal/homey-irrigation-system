'use strict';

const MANUAL_DRIVER_ID = 'homey:app:com.dadecal.irrigation.v2:irrigation_manual';
const MANUAL_DEVICE_DATA_ID = 'irrigation_manual';
const MANUAL_DEVICE_NAME = 'Riego Manual v2';
const MANUAL_DEVICE_DEFAULT_ZONE_ID = 'c00ba2c5-9d67-4e16-89c0-cc4ef82b5d1f';
const CHECK_INTERVAL_MS = 30 * 1000;

const CAP = {
  sector: 'irrigation_manual_sector',
  duration: 'irrigation_manual_duration',
  onoff: 'onoff',
  remaining: 'irrigation_manual_remaining',
  message: 'irrigation_manual_message',
};

function clampInteger(value, min, max, label) {
  const number = Math.round(Number(value));
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} debe estar entre ${min} y ${max}`);
  }
  return number;
}

function isManualDevice(device) {
  const dataId = device?.data?.id;
  const driverId = String(device?.driverId || '');
  const driverUri = String(device?.driverUri || '');

  return dataId === MANUAL_DEVICE_DATA_ID
    && (
      driverId === MANUAL_DRIVER_ID
      || driverId === 'irrigation_manual'
      || driverId.endsWith(':irrigation_manual')
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

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber)
    && Number.isFinite(rightNumber)
    && Math.abs(leftNumber - rightNumber) < 0.000001;
}

class ManualDeviceService {
  constructor({
    homey,
    apiClient,
    controlStore = null,
    engineService = null,
    appStateStore = null,
    now = () => Date.now(),
    logger = null,
    onCommand = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.controlStore = controlStore;
    this.engineService = engineService;
    this.appStateStore = appStateStore;
    this.now = now;
    this.logger = logger || homey.app;
    this.onCommand = onCommand;
    this.timer = null;
    this.checking = false;
    this.devices = new Set();
    this.lastProjection = null;
    this.lastCommand = null;
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
        this.logger.error('Manual device projection failed', error);
      });
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) return;

    this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  async registerDevice(device) {
    this.devices.add(device);
    await this.ensureDeviceDefaults(device);
    return this.check().catch(error => {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      this.logger.error('Initial manual device projection failed', error);
    });
  }

  unregisterDevice(device) {
    this.devices.delete(device);
  }

  async ensureDeviceDefaults(device) {
    const defaults = {
      [CAP.sector]: 1,
      [CAP.duration]: 1,
      [CAP.remaining]: 0,
      [CAP.message]: 'Sin riego activo',
    };

    for (const [capability, value] of Object.entries(defaults)) {
      if (!device.hasCapability?.(capability)) continue;
      const current = device.getCapabilityValue(capability);
      if (current === null || current === undefined) {
        await device.applyNativeProjection?.({ [capability]: value });
      }
    }
  }

  async getApi() {
    return this.apiClient.getApi();
  }

  async getEngineMode() {
    if (!this.controlStore) return 'SHADOW';
    const control = await this.controlStore.getControl();
    return control.services?.engine || 'SHADOW';
  }

  async findPairedManualDevices() {
    const api = await this.getApi();
    if (!api.devices?.getDevices) {
      throw new Error('Homey API devices.getDevices is not available');
    }

    const devices = await api.devices.getDevices();
    return Object.values(devices || {})
      .filter(isManualDevice)
      .map(summarizeDevice);
  }

  async ensureDevice({ zoneId = MANUAL_DEVICE_DEFAULT_ZONE_ID } = {}) {
    const existing = await this.findPairedManualDevices();
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
          driverId: MANUAL_DRIVER_ID,
          ...(zoneId ? { zoneId } : {}),
        },
      });

      if (!pairSession?.id) {
        throw new Error('Homey API did not return a pair session id');
      }

      const createdDevice = await api.drivers.createPairSessionDevice({
        id: pairSession.id,
        device: {
          name: MANUAL_DEVICE_NAME,
          data: {
            id: MANUAL_DEVICE_DATA_ID,
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
          this.logger.error('Could not close manual device pair session', error);
        });
      }
    }
  }

  async status() {
    let pairedHomeyDevices = null;
    let pairingError = null;

    try {
      pairedHomeyDevices = await this.findPairedManualDevices();
    } catch (error) {
      pairingError = error.message;
    }

    return {
      mode: 'ACTIVE_COMPAT',
      bridge: 'native-manual-device',
      checkIntervalMs: CHECK_INTERVAL_MS,
      timerActive: Boolean(this.timer),
      pairedDevices: this.devices.size,
      registeredDevices: this.devices.size,
      pairedHomeyDevices,
      updatesNativeDevices: true,
      writesOperationalVariables: false,
      controlsHardwareDirectly: false,
      expectedDevice: {
        name: MANUAL_DEVICE_NAME,
        driverId: MANUAL_DRIVER_ID,
        data: {
          id: MANUAL_DEVICE_DATA_ID,
        },
      },
      pairingError,
      lastProjection: this.lastProjection,
      lastCommand: this.lastCommand,
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
      projection.applied = await this.applyProjection(projection);
      this.lastProjection = projection;
      this.lastError = null;
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

  async buildProjection() {
    const nativeDevice = [...this.devices][0] || null;
    const appState = this.appStateStore ? await this.appStateStore.getState() : null;
    const engine = appState?.engine || {};
    const engineRunning = engine.state === 'RUNNING';
    const manualRunning = engineRunning && String(engine.source || '').toUpperCase() === 'MANUAL';
    const remainingMinutes = manualRunning
      ? Math.max(0, Math.ceil((Number(engine.endTs || 0) - this.now()) / 60000))
      : 0;
    const values = {
      [CAP.sector]: clampInteger(
        manualRunning
          ? Number(engine.activeSector || nativeDevice?.getCapabilityValue?.(CAP.sector) || 1)
          : nativeDevice?.getCapabilityValue?.(CAP.sector) ?? 1,
        1,
        6,
        'Sector',
      ),
      [CAP.duration]: clampInteger(
        nativeDevice?.getCapabilityValue?.(CAP.duration) ?? 1,
        1,
        30,
        'Duracion',
      ),
      [CAP.onoff]: Boolean(
        manualRunning,
      ),
      [CAP.remaining]: remainingMinutes,
      [CAP.message]: manualRunning
        ? `Regando sector ${Number(engine.activeSector || 0)} (${remainingMinutes} min restantes)`
        : 'Sin riego activo',
    };

    return {
      version: 1,
      updatedTs: this.now(),
      target: 'native-manual-device',
      bridge: 'native-manual-device',
      pairedDevices: this.devices.size,
      writesOperationalVariables: false,
      controlsHardwareDirectly: false,
      values,
      summary: this.devices.size > 0
        ? `OK - ${this.devices.size} device(s) manual(es) actualizados`
        : 'OK - proyeccion manual calculada, sin devices nativos emparejados',
    };
  }

  async applyProjection(projection) {
    const applied = [];

    for (const device of this.devices) {
      await device.applyNativeProjection?.(projection.values);
      applied.push({
        deviceId: device.getData?.()?.id || 'unknown',
        capabilities: Object.keys(projection.values),
      });
    }

    return applied;
  }

  async setSector(value) {
    const sector = clampInteger(value, 1, 6, 'Sector');
    const command = {
      action: 'SET_SECTOR',
      ts: this.now(),
      route: 'native-device',
      writesOperationalVariables: false,
      controlsHardwareDirectly: false,
      value: sector,
    };
    this.lastCommand = command;
    await this.check().catch(error => {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      this.logger.error('Manual projection after sector update failed', error);
    });
    return command;
  }

  async setDuration(value) {
    const duration = clampInteger(value, 1, 30, 'Duracion');
    const command = {
      action: 'SET_DURATION',
      ts: this.now(),
      route: 'native-device',
      writesOperationalVariables: false,
      controlsHardwareDirectly: false,
      value: duration,
    };
    this.lastCommand = command;
    await this.check().catch(error => {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      this.logger.error('Manual projection after duration update failed', error);
    });
    return command;
  }

  async setOnOff(value) {
    const enabled = Boolean(value);
    const nativeDevice = [...this.devices][0] || null;
    const engineMode = await this.getEngineMode();
    if (engineMode === 'ACTIVE_COMPAT' && this.engineService) {
      const result = enabled
        ? await this.engineService.startManual({
          sector: clampInteger(nativeDevice?.getCapabilityValue(CAP.sector) ?? 1, 1, 6, 'Sector'),
          duration: clampInteger(nativeDevice?.getCapabilityValue(CAP.duration) ?? 1, 1, 30, 'Duracion'),
        })
        : await this.engineService.stopManual();
      const command = {
        action: enabled ? 'START' : 'STOP',
        ts: this.now(),
        route: 'native-engine',
        result,
        writesOperationalVariables: Boolean(result.writesOperationalVariables),
        controlsHardwareDirectly: Boolean(result.controlsHardware),
      };
      this.lastCommand = command;
      if (typeof this.onCommand === 'function') {
        await this.onCommand(command);
      }
      await this.check().catch(error => {
        this.lastError = {
          ts: this.now(),
          message: error.message,
        };
        this.logger.error('Manual projection after native command failed', error);
      });
      return command;
    }

    const command = {
      action: enabled ? 'START' : 'STOP',
      ts: this.now(),
      route: 'native-device',
      skipped: true,
      reason: 'ENGINE_ACTIVE_COMPAT_NOT_AVAILABLE',
      writesOperationalVariables: false,
      controlsHardwareDirectly: false,
    };
    this.lastCommand = command;
    return command;
  }
}

module.exports = {
  ManualDeviceService,
  constants: {
    MANUAL_DRIVER_ID,
    MANUAL_DEVICE_DATA_ID,
    MANUAL_DEVICE_NAME,
    CHECK_INTERVAL_MS,
    CAP,
  },
};
