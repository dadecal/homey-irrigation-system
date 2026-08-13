'use strict';

const DEVICE_ID = {
  raw: '1120df26-8201-49de-b262-8fb98289d811',
};

const RAW_CAP = {
  relays: {
    1: 'onoff',
    2: 'onoff.rel__l_nea_2',
    3: 'onoff.rel__l_nea_3',
    4: 'onoff.rel__l_nea_4',
    5: 'onoff.rel__l_nea_5',
    6: 'onoff.rel__l_nea_6',
  },
  litersCycle: {
    1: 'measure_generic.l1_litros_ciclo',
    2: 'measure_generic.l2_litros_ciclo',
    3: 'measure_generic.l3_litros_ciclo',
    4: 'measure_generic.l4_litros_ciclo',
    5: 'measure_generic.l5_litros_ciclo',
    6: 'measure_generic.l6_litros_ciclo',
  },
};

function sameValue(left, right) {
  if (left === right) return true;
  if (left === null || left === undefined || right === null || right === undefined) return false;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber)
    && Number.isFinite(rightNumber)
    && Math.abs(leftNumber - rightNumber) < 0.000001;
}

class EnginePlanExecutor {
  constructor({
    apiClient,
    appStateStore = null,
    sectorStartedTrigger = null,
    sectorEndedTrigger = null,
    logger = null,
    now = () => Date.now(),
  }) {
    this.apiClient = apiClient;
    this.appStateStore = appStateStore;
    this.sectorStartedTrigger = sectorStartedTrigger;
    this.sectorEndedTrigger = sectorEndedTrigger;
    this.logger = logger;
    this.now = now;
  }

  async getApi() {
    return this.apiClient.getApi();
  }

  async getDevice(deviceId) {
    const api = await this.getApi();
    if (api.devices?.getDevice) {
      return api.devices.getDevice({ id: deviceId });
    }

    const devices = await api.devices.getDevices();
    return devices[deviceId] || null;
  }

  async setCapabilityIfNeeded(deviceId, capability, value) {
    let device = null;
    try {
      device = await this.getDevice(deviceId);
    } catch (error) {
      return {
        capability,
        skipped: true,
        reason: 'DEVICE_NOT_FOUND',
        deviceId,
        message: error.message,
      };
    }
    if (!device) {
      return {
        capability,
        skipped: true,
        reason: 'DEVICE_NOT_FOUND',
        deviceId,
      };
    }

    const current = device?.capabilitiesObj?.[capability]?.value;

    if (sameValue(current, value)) {
      return { capability, skipped: true, reason: 'UNCHANGED', current };
    }

    if (typeof device.setCapabilityValue !== 'function') {
      return {
        capability,
        skipped: true,
        reason: 'SET_CAPABILITY_NOT_AVAILABLE',
        deviceId,
      };
    }

    await device.setCapabilityValue(capability, value);
    if (device.capabilitiesObj?.[capability]) {
      device.capabilitiesObj[capability].value = value;
    }
    return { capability, skipped: false, previous: current, value };
  }

  async setCapabilities(deviceId, valuesByCapability) {
    const applied = [];

    for (const [capability, value] of Object.entries(valuesByCapability)) {
      if (value === undefined) continue;
      applied.push(await this.setCapabilityIfNeeded(deviceId, capability, value));
    }

    return applied;
  }

  requireAppStateStore() {
    if (!this.appStateStore) {
      throw new Error('EnginePlanExecutor requiere appStateStore');
    }
    return this.appStateStore;
  }

  async setStateValues(values) {
    const nextEngine = await this.requireAppStateStore().setEngineValues(values);
    return Object.entries(values || {})
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => ({
        store: 'appStateV2.engine',
        field,
        value,
        state: nextEngine.state,
        activeSector: nextEngine.activeSector,
      }));
  }

  async readLiters(sector) {
    const capability = RAW_CAP.litersCycle[sector];
    if (!capability) return 0;

    const raw = await this.getDevice(DEVICE_ID.raw);
    return Number(raw?.capabilitiesObj?.[capability]?.value || 0);
  }

  async triggerSectorEvent(step) {
    const card = step.type === 'sectorStart'
      ? this.sectorStartedTrigger
      : this.sectorEndedTrigger;
    const id = step.type === 'sectorStart' ? 'sector_started' : 'sector_ended';

    if (!card) {
      return {
        id,
        skipped: true,
        reason: 'TRIGGER_NOT_AVAILABLE',
      };
    }

    const tokens = {
      message: step.message || '',
      sector: Number(step.tokens?.sector || 0),
      duration: Number(step.tokens?.duration || 0),
      source: String(step.tokens?.source || 'none'),
      reason: String(step.tokens?.reason || 'none'),
      liters: Number(step.tokens?.liters || 0),
    };

    try {
      await card.trigger(tokens);
      return { id, skipped: false, tokens };
    } catch (error) {
      this.logger?.log?.(`Sector event trigger ${id} skipped: ${error.message}`);
      return {
        id,
        skipped: true,
        reason: 'TRIGGER_FAILED',
        message: error.message,
      };
    }
  }

  async applyStep(step) {
    switch (`${step.adapter}:${step.action}`) {
      case 'EspHomeIrrigationHardwareAdapter:setAllRelays': {
        const values = Object.values(RAW_CAP.relays).reduce((acc, capability) => {
          acc[capability] = Boolean(step.value);
          return acc;
        }, {});
        return { step, applied: await this.setCapabilities(DEVICE_ID.raw, values) };
      }

      case 'EspHomeIrrigationHardwareAdapter:setRelay':
        return {
          step,
          applied: await this.setCapabilities(DEVICE_ID.raw, {
            [RAW_CAP.relays[step.sector]]: Boolean(step.value),
          }),
        };

      case 'EngineStateStore:setQueue':
        return {
          step,
          applied: [{
            store: 'appStateV2.engine',
            field: 'queue',
            value: (await this.requireAppStateStore().setEngineQueue(step.value || [])).queue,
          }],
        };

      case 'EngineStateStore:clearQueue':
        return {
          step,
          applied: [{
            store: 'appStateV2.engine',
            field: 'queue',
            value: (await this.requireAppStateStore().clearEngineQueue()).queue,
          }],
        };

      case 'EngineStateStore:setValues':
        return { step, applied: await this.setStateValues(step.values) };

      case 'EngineStateStore:appendHistory': {
        const nextEngine = await this.requireAppStateStore().appendEngineHistory(step.entry);
        return {
          step,
          applied: [{
            store: 'appStateV2.engine',
            field: 'history',
            entryId: step.entry?.id,
            count: nextEngine.history.length,
          }],
        };
      }

      case 'EngineStateStore:emitHistoryTrigger':
        return {
          step,
          applied: [{
            store: 'appStateV2.engine',
            field: 'lastHistoryTriggerTs',
            value: (await this.requireAppStateStore()
              .emitEngineHistoryTrigger(step.entryId, this.now())).lastHistoryTriggerTs,
            entryId: step.entryId,
          }],
        };

      case 'EngineStateStore:emitSectorEvent': {
        const nextEngine = await this.requireAppStateStore()
          .emitEngineSectorEvent(step.type, step.message || '', this.now());
        const trigger = await this.triggerSectorEvent(step);
        return {
          step,
          applied: [
            {
              store: 'appStateV2.engine',
              field: 'lastSectorEvent',
              value: nextEngine.lastSectorEvent,
            },
            {
              flowTrigger: trigger,
            },
          ],
        };
      }

      default:
        throw new Error(`Paso de motor no soportado: ${step.adapter}:${step.action}`);
    }
  }

  async execute(plan) {
    const applied = [];

    for (const step of plan.steps || []) {
      applied.push(await this.applyStep(step));
    }

    return {
      type: plan.type,
      dryRun: false,
      accepted: plan.accepted,
      applied,
    };
  }

  async executeFailurePlan(plan, error) {
    const applied = [];

    for (const step of plan.failurePlan || []) {
      applied.push(await this.applyStep(step));
    }

    return {
      type: 'failurePlan',
      dryRun: false,
      sourcePlanType: plan.type,
      error: error.message,
      applied,
    };
  }
}

module.exports = {
  EnginePlanExecutor,
  DEVICE_ID,
  RAW_CAP,
};
