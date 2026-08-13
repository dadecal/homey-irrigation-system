'use strict';

const { MODE, SERVICE } = require('./constants');

const CHECK_INTERVAL_MS = 60 * 1000;

class StatusSyncService {
  constructor({
    homey,
    apiClient,
    controlStore = null,
    now = () => Date.now(),
    logger = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.controlStore = controlStore;
    this.now = now;
    this.logger = logger || homey.app;
    this.timer = null;
    this.checking = false;
    this.lastProjection = null;
    this.lastError = null;
  }

  start() {
    this.logger.log('StatusSyncService retired: SystemDeviceProjectionService owns native system projection');
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

  async status() {
    const mode = await this.getMode();
    return {
      mode,
      shadow: mode === MODE.SHADOW,
      retired: true,
      updatesDevices: false,
      writesOperationalVariables: false,
      checkIntervalMs: CHECK_INTERVAL_MS,
      timerActive: Boolean(this.timer),
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
      projection.applied = [];
      this.lastProjection = projection;
      this.lastError = null;
      this.logger.log(`Status sync ${projection.mode} check: ${projection.summary}`);
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
    const now = this.now();
    const mode = await this.getMode();

    return {
      version: 1,
      mode,
      shadow: mode === MODE.SHADOW,
      retired: true,
      updatesDevices: false,
      writesOperationalVariables: false,
      updatedTs: now,
      summary: 'OK - StatusSync retirado; SystemDeviceProjectionService actualiza Sistema de Riego v2',
      rawAvailable: null,
      sources: {},
      expected: {},
    };
  }

  async getMode() {
    if (!this.controlStore) {
      return MODE.SHADOW;
    }

    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.STATUS_SYNC] || MODE.SHADOW;
  }

}

module.exports = StatusSyncService;
