'use strict';

function take(items, limit) {
  return Array.isArray(items) ? items.slice(0, limit) : [];
}

class DiagnosticsService {
  constructor({
    appStateStore,
    scheduler = null,
    configStore = null,
    healthService = null,
    recoveryService = null,
    irrigationEngineService = null,
  }) {
    this.appStateStore = appStateStore;
    this.scheduler = scheduler;
    this.configStore = configStore;
    this.healthService = healthService;
    this.recoveryService = recoveryService;
    this.irrigationEngineService = irrigationEngineService;
  }

  async status() {
    const appState = this.appStateStore ? await this.appStateStore.getState() : {};
    const engine = appState.engine || {};
    const schedulerStatus = this.scheduler?.status
      ? await this.scheduler.status().catch(error => ({ error: error.message }))
      : null;

    return {
      version: 1,
      updatedTs: Date.now(),
      scheduler: {
        status: schedulerStatus,
        diagnostic: this.scheduler?.getDiagnostic?.() || null,
        config: this.configStore?.getConfig ? await this.configStore.getConfig() : null,
      },
      health: {
        state: appState.health || null,
        service: this.healthService?.lastCheck || null,
        error: this.healthService?.lastError || null,
      },
      recovery: {
        state: appState.recovery || null,
        service: this.recoveryService?.lastCheck || null,
        error: this.recoveryService?.lastError || null,
      },
      engine: {
        state: {
          state: engine.state || 'IDLE',
          activeSector: Number(engine.activeSector || 0),
          source: engine.source || 'none',
          stopReason: engine.stopReason || 'none',
          queueLength: Array.isArray(engine.queue) ? engine.queue.length : 0,
          updatedTs: Number(engine.updatedTs || 0),
          lastTickTs: Number(engine.lastTickTs || 0),
          lastSectorEvent: engine.lastSectorEvent || null,
        },
        service: this.irrigationEngineService?.lastCheck || null,
        action: this.irrigationEngineService?.lastAction || null,
        error: this.irrigationEngineService?.lastError || null,
        tickDiagnostics: take(engine.tickDiagnostics, 25),
        actionDiagnostics: take(engine.actionDiagnostics, 25),
      },
      events: take(appState.events, 100),
    };
  }
}

module.exports = {
  DiagnosticsService,
};
