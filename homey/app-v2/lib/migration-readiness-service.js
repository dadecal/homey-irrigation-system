'use strict';

const { MODE, SERVICE } = require('./constants');

function serviceResult(name, mode, activeCompatSupported, check, evaluate) {
  const result = evaluate(check);
  return {
    name,
    mode,
    activeCompatSupported,
    ...result,
  };
}

function evaluateHealth(health) {
  if (!health || health.skipped) {
    return {
      observed: false,
      readyToCompare: false,
      readyForCutover: false,
      blocker: 'HEALTH_CHECK_NOT_AVAILABLE',
      check: health || null,
    };
  }

  const matchesPublicHealth = Boolean(health.comparison?.matchesPublicHealth);
  return {
    observed: true,
    readyToCompare: true,
    readyForCutover: matchesPublicHealth,
    blocker: matchesPublicHealth ? null : 'HEALTH_SHADOW_DIFFERS_FROM_PUBLIC_HEALTH',
    check: health,
  };
}

function evaluateStatusSync(projection) {
  if (!projection || projection.skipped) {
    return {
      observed: false,
      readyToCompare: false,
      readyForCutover: false,
      blocker: 'STATUS_SYNC_CHECK_NOT_AVAILABLE',
      check: projection || null,
    };
  }

  return {
    observed: true,
    readyToCompare: Boolean(projection.rawAvailable),
    readyForCutover: Boolean(projection.rawAvailable),
    blocker: projection.rawAvailable ? null : 'STATUS_SYNC_RAW_UNAVAILABLE',
    pendingProjectionDifferences: projection.comparison?.differences || [],
    check: projection,
  };
}

function evaluateHistory(projection) {
  if (!projection || projection.skipped) {
    return {
      observed: false,
      readyToCompare: false,
      readyForCutover: false,
      blocker: 'HISTORY_CHECK_NOT_AVAILABLE',
      check: projection || null,
    };
  }

  const ready = projection.status === 'READY' || projection.status === 'NO_HISTORY';
  return {
    observed: true,
    readyToCompare: true,
    readyForCutover: ready,
    blocker: ready ? null : 'HISTORY_PENDING_OR_INVALID_EVENT',
    check: projection,
  };
}

function evaluateRecovery(recovery) {
  if (!recovery || recovery.skipped) {
    return {
      observed: false,
      readyToCompare: false,
      readyForCutover: false,
      blocker: 'RECOVERY_CHECK_NOT_AVAILABLE',
      check: recovery || null,
    };
  }

  const ready = recovery.available === true
    && recovery.status !== 'CONFIG_ERROR'
    && recovery.status !== 'RESTART_FAILED';
  return {
    observed: true,
    readyToCompare: true,
    readyForCutover: ready,
    blocker: ready ? null : 'RECOVERY_NOT_READY',
    check: recovery,
  };
}

function evaluateEngine(engine) {
  if (!engine || engine.skipped) {
    return {
      observed: false,
      readyToCompare: false,
      readyForCutover: false,
      blocker: 'ENGINE_CHECK_NOT_AVAILABLE',
      check: engine || null,
    };
  }

  const supported = engine.activeCompatSupported === true;
  const readyForCutover = supported && engine.readyForCutover === true;
  return {
    observed: true,
    readyToCompare: true,
    readyForCutover,
    blocker: readyForCutover
      ? null
      : (supported ? (engine.blocker || 'ENGINE_NOT_READY_FOR_CUTOVER') : 'ENGINE_ACTIVE_COMPAT_NOT_IMPLEMENTED'),
    pendingEngineIssues: engine.issues || [],
    check: engine,
  };
}

function getService(services, name) {
  return services.find(service => service.name === name) || null;
}

function buildEngineActivationPrecheck(readiness) {
  const blockers = [];
  const services = readiness.services || [];
  const scheduler = getService(services, SERVICE.SCHEDULER);
  const health = getService(services, SERVICE.HEALTH);
  const statusSync = getService(services, SERVICE.STATUS_SYNC);
  const history = getService(services, SERVICE.HISTORY);
  const recovery = getService(services, SERVICE.RECOVERY);
  const engine = getService(services, SERVICE.ENGINE);
  const healthCheck = health?.check || {};
  const engineCheck = engine?.check || {};

  if (scheduler?.mode !== MODE.ACTIVE_COMPAT) {
    blockers.push({ service: SERVICE.SCHEDULER, code: 'SCHEDULER_NOT_ACTIVE_COMPAT' });
  }

  for (const service of [health, statusSync, history, recovery]) {
    if (!service?.readyForCutover) {
      blockers.push({
        service: service?.name || 'unknown',
        code: `${String(service?.name || 'SERVICE').toUpperCase()}_NOT_READY_FOR_ENGINE_CUTOVER`,
      });
    }
  }

  if (healthCheck.status === 'ERROR' || healthCheck.status === 'OFFLINE') {
    blockers.push({ service: SERVICE.HEALTH, code: 'HEALTH_HAS_CRITICAL_STATUS' });
  }

  if ((healthCheck.issues || []).some(issue => issue.severity === 'ERROR')) {
    blockers.push({ service: SERVICE.HEALTH, code: 'HEALTH_HAS_ACTIVE_ERROR_ISSUES' });
  }

  if (recovery?.check?.available !== true) {
    blockers.push({ service: SERVICE.RECOVERY, code: 'RECOVERY_RAW_DEVICE_NOT_AVAILABLE' });
  }

  if (!engineCheck.rawAvailable) {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_RAW_UNAVAILABLE' });
  }

  if (engineCheck.activeCompatSupported !== true) {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_ACTIVE_COMPAT_NOT_IMPLEMENTED' });
  }

  if (engineCheck.engine?.state !== 'IDLE') {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_NOT_IDLE' });
  }

  if (Number(engineCheck.engine?.activeSector || 0) !== 0) {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_ACTIVE_SECTOR_NOT_ZERO' });
  }

  if (Number(engineCheck.engine?.queueLength || 0) !== 0) {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_QUEUE_NOT_EMPTY' });
  }

  if (engineCheck.hardware?.anyRelayOn || (engineCheck.hardware?.activeRelays || []).length > 0) {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_RELAYS_ACTIVE' });
  }

  if ((engineCheck.issues || []).length > 0) {
    blockers.push({ service: SERVICE.ENGINE, code: 'ENGINE_HAS_INVARIANT_ISSUES' });
  }

  const uniqueBlockers = blockers.filter((blocker, index, list) =>
    index === list.findIndex(item => item.service === blocker.service && item.code === blocker.code));

  return {
    allowed: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    checkedTs: readiness.updatedTs,
  };
}

class MigrationReadinessService {
  constructor({
    configStore,
    controlStore,
    scheduler = null,
    healthService,
    statusSyncService,
    historyService,
    recoveryService = null,
    irrigationEngineService = null,
    now = () => Date.now(),
  }) {
    this.configStore = configStore;
    this.controlStore = controlStore;
    this.scheduler = scheduler;
    this.healthService = healthService;
    this.statusSyncService = statusSyncService;
    this.historyService = historyService;
    this.recoveryService = recoveryService;
    this.irrigationEngineService = irrigationEngineService;
    this.now = now;
  }

  async check() {
    const [
      control,
      schedulerStatus,
      health,
      statusSync,
      history,
      recovery,
      engine,
    ] = await Promise.all([
      this.controlStore.getControl(),
      this.scheduler ? this.scheduler.status() : this.configStore.getStatus(),
      this.healthService.check(),
      this.statusSyncService.check(),
      this.historyService.check(),
      this.recoveryService ? this.recoveryService.check() : null,
      this.irrigationEngineService ? this.irrigationEngineService.check() : null,
    ]);

    const services = [
      {
        name: SERVICE.SCHEDULER,
        mode: control.services[SERVICE.SCHEDULER],
        activeCompatSupported: control.activeCompatSupported[SERVICE.SCHEDULER],
        observed: true,
        readyToCompare: true,
        readyForCutover: Boolean(schedulerStatus.canEmitProgramRequests),
        blocker: schedulerStatus.canEmitProgramRequests ? null : 'SCHEDULER_PROGRAM_REQUESTS_DISABLED_IN_RAMA_2',
        check: schedulerStatus,
      },
      serviceResult(
        SERVICE.HEALTH,
        control.services[SERVICE.HEALTH],
        control.activeCompatSupported[SERVICE.HEALTH],
        health,
        evaluateHealth,
      ),
      serviceResult(
        SERVICE.STATUS_SYNC,
        control.services[SERVICE.STATUS_SYNC],
        control.activeCompatSupported[SERVICE.STATUS_SYNC],
        statusSync,
        evaluateStatusSync,
      ),
      serviceResult(
        SERVICE.HISTORY,
        control.services[SERVICE.HISTORY],
        control.activeCompatSupported[SERVICE.HISTORY],
        history,
        evaluateHistory,
      ),
      serviceResult(
        SERVICE.RECOVERY,
        control.services[SERVICE.RECOVERY],
        control.activeCompatSupported[SERVICE.RECOVERY],
        recovery,
        evaluateRecovery,
      ),
      serviceResult(
        SERVICE.ENGINE,
        control.services[SERVICE.ENGINE],
        control.activeCompatSupported[SERVICE.ENGINE],
        engine,
        evaluateEngine,
      ),
    ];

    const blockers = services
      .flatMap(service => {
        const items = [];
        if (service.blocker) {
          items.push({ service: service.name, code: service.blocker });
        }
        if (service.mode !== MODE.SHADOW) {
          const supportedActive = service.mode === MODE.ACTIVE_COMPAT && service.activeCompatSupported;
          if (!supportedActive) {
            items.push({ service: service.name, code: 'UNSUPPORTED_SERVICE_MODE' });
          }
        }
        if (!service.activeCompatSupported) {
          items.push({ service: service.name, code: 'ACTIVE_COMPAT_NOT_IMPLEMENTED' });
        }
        return items;
      });

    const readiness = {
      version: 1,
      mode: MODE.SHADOW,
      shadow: true,
      updatedTs: this.now(),
      safeToDisableTechnicalFlows: false,
      reason: 'Rama 2 aun no puede retirar todos los Flows tecnicos: Scheduler no emite solicitudes y pueden quedar cutovers pendientes.',
      blockers,
      services,
    };
    const engineActivation = buildEngineActivationPrecheck(readiness);
    return {
      ...readiness,
      engineActivation,
      readyToActivateEngine: engineActivation.allowed,
      safeToDisableTechnicalFlows: false,
      reason: engineActivation.allowed
        ? 'Rama 2 cumple precheck para activar engine=ACTIVE_COMPAT. Los Flows tecnicos no deben deshabilitarse hasta ejecutar el runbook de cutover.'
        : readiness.reason,
    };
  }

  async checkEngineActivation() {
    const readiness = await this.check();
    return {
      ...readiness.engineActivation,
      readiness,
    };
  }

  async status() {
    const control = await this.controlStore.getControl();
    return {
      version: 1,
      mode: MODE.SHADOW,
      shadow: true,
      safeToDisableTechnicalFlows: false,
      control,
      message: 'Ejecuta /migration/readiness/check para comparar servicios y confirmar que no quedan blockers antes de cualquier cutover.',
    };
  }
}

module.exports = MigrationReadinessService;
module.exports.buildEngineActivationPrecheck = buildEngineActivationPrecheck;
