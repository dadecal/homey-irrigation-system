'use strict';

function getStore(homey) {
  return homey.app.getConfigStore();
}

module.exports = {
  async getConfig({ homey }) {
    return getStore(homey).getConfig();
  },

  async putConfig({ homey, body }) {
    return getStore(homey).saveConfig(body || {});
  },

  async getStatus({ homey }) {
    return homey.app.getStatus();
  },

  async getRelease({ homey }) {
    return homey.app.getRelease();
  },

  async getHealthStatus({ homey }) {
    return homey.app.getHealthService().status();
  },

  async checkHealth({ homey }) {
    return homey.app.getHealthService().check();
  },

  async getStatusSyncStatus({ homey }) {
    return homey.app.getStatusSyncService().status();
  },

  async checkStatusSync({ homey }) {
    return homey.app.getStatusSyncService().check();
  },

  async getHistoryStatus({ homey }) {
    return homey.app.getHistoryService().status();
  },

  async checkHistory({ homey }) {
    return homey.app.getHistoryService().check();
  },

  async ensureHistoryDevice({ homey, body }) {
    return homey.app.getHistoryService().ensureNativeDevice({
      zoneId: body?.zoneId || null,
    });
  },

  async getRecoveryStatus({ homey }) {
    return homey.app.getRecoveryService().status();
  },

  async checkRecovery({ homey }) {
    return homey.app.getRecoveryService().check();
  },

  async restartControllerProbe({ homey, body }) {
    return homey.app.getRecoveryService().restartControllerProbe(body || {});
  },

  async getRecoveryTokenStatus({ homey }) {
    return homey.app.getRecoveryTokenStore().getStatus();
  },

  async putRecoveryToken({ homey, body }) {
    return homey.app.getRecoveryTokenStore().setToken(body?.token);
  },

  async clearRecoveryToken({ homey }) {
    return homey.app.getRecoveryTokenStore().clearToken();
  },

  async getEngineStatus({ homey }) {
    return homey.app.getIrrigationEngineService().status();
  },

  async checkEngine({ homey }) {
    return homey.app.getIrrigationEngineService().check();
  },

  async previewEngineManualStart({ homey, body }) {
    return homey.app.getIrrigationEngineService().previewManualStart(body || {});
  },

  async previewEngineProgramStart({ homey, body }) {
    return homey.app.getIrrigationEngineService().previewProgramStart(body || {});
  },

  async previewEngineManualStop({ homey }) {
    return homey.app.getIrrigationEngineService().previewManualStop();
  },

  async startEngineManual({ homey, body }) {
    return homey.app.getIrrigationEngineService().startManual(body || {});
  },

  async startEngineProgram({ homey, body }) {
    return homey.app.getIrrigationEngineService().startProgram(body || {});
  },

  async stopEngineManual({ homey }) {
    return homey.app.getIrrigationEngineService().stopManual();
  },

  async tickEngine({ homey }) {
    return homey.app.getIrrigationEngineService().tick();
  },

  async recoverEngine({ homey }) {
    return homey.app.getIrrigationEngineService().recover();
  },

  async getSystemDeviceStatus({ homey }) {
    return homey.app.getSystemDeviceProjectionService().status();
  },

  async checkSystemDevice({ homey }) {
    return homey.app.getSystemDeviceProjectionService().check();
  },

  async ensureSystemDevice({ homey, body }) {
    return homey.app.getSystemDeviceProjectionService().ensureDevice({
      zoneId: body?.zoneId || null,
    });
  },

  async getManualDeviceStatus({ homey }) {
    return homey.app.getManualDeviceService().status();
  },

  async checkManualDevice({ homey }) {
    return homey.app.getManualDeviceService().check();
  },

  async ensureManualDevice({ homey, body }) {
    return homey.app.getManualDeviceService().ensureDevice({
      zoneId: body?.zoneId || null,
    });
  },

  async getMigrationReadiness({ homey }) {
    return homey.app.getMigrationReadinessService().status();
  },

  async getDiagnosticsStatus({ homey }) {
    return homey.app.getDiagnosticsService().status();
  },

  async checkMigrationReadiness({ homey }) {
    return homey.app.getMigrationReadinessService().check();
  },

  async putMigrationControl({ homey, body }) {
    const engineActivationPrecheck = body?.service === 'engine' && body?.mode === 'ACTIVE_COMPAT'
      ? await homey.app.getMigrationReadinessService().checkEngineActivation()
      : null;

    return homey.app.getMigrationControlStore().setServiceMode(
      body?.service,
      body?.mode,
      {
        acknowledgeDuplicateWriteRisk: body?.acknowledgeDuplicateWriteRisk,
        engineActivationPrecheck,
      },
    );
  },

  async setRainDelay({ homey, body }) {
    const hours = Number(body?.hours);
    return getStore(homey).setRainDelay(hours);
  },

  async clearRainDelay({ homey }) {
    return getStore(homey).clearRainDelay();
  },
};
