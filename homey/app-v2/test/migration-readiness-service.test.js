'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODE, SERVICE } = require('../lib/constants');
const { createDefaultMigrationControl } = require('../lib/migration-control-store');
const MigrationReadinessService = require('../lib/migration-readiness-service');

const NOW = 1721300300000;

function createReadinessService(overrides = {}) {
  const control = overrides.control || createDefaultMigrationControl();
  const service = new MigrationReadinessService({
    now: () => NOW,
    controlStore: {
      async getControl() {
        return control;
      },
    },
    configStore: {
      async getStatus() {
        return overrides.schedulerStatus || {
          mode: MODE.SHADOW,
          canEmitProgramRequests: false,
        };
      },
    },
    healthService: {
      async check() {
        return overrides.health || {
          mode: MODE.SHADOW,
          status: 'OK',
          comparison: {
            matchesPublicHealth: true,
          },
        };
      },
    },
    statusSyncService: {
      async check() {
        return overrides.statusSync || {
          mode: MODE.SHADOW,
          rawAvailable: true,
          comparison: {
            matchesSystemDevice: false,
            differences: [{ field: 'temperature', expected: 34, current: 27.5 }],
          },
        };
      },
    },
    historyService: {
      async check() {
        return overrides.history || {
          mode: MODE.SHADOW,
          status: 'READY',
          alreadyProjected: true,
          comparison: {
            matchesHistoryDevice: true,
          },
        };
      },
    },
    recoveryService: {
      async check() {
        return overrides.recovery || {
          mode: MODE.SHADOW,
          status: 'AVAILABLE',
          available: true,
        };
      },
    },
    irrigationEngineService: {
      async check() {
        return overrides.engine || {
          mode: MODE.SHADOW,
          controlsHardware: false,
          writesOperationalVariables: false,
          writesInternalState: false,
          activeCompatSupported: true,
          rawAvailable: true,
          readyForCutover: true,
          blocker: null,
          engine: {
            state: 'IDLE',
            activeSector: 0,
            queueLength: 0,
          },
          hardware: {
            activeRelays: [],
            anyRelayOn: false,
          },
          issues: [],
        };
      },
    },
  });

  return service;
}

test('reports migration control defaults as shadow-only', async () => {
  const service = createReadinessService();
  const status = await service.status();

  assert.equal(status.mode, MODE.SHADOW);
  assert.equal(status.safeToDisableTechnicalFlows, false);
  assert.deepEqual(status.control.services, {
    [SERVICE.SCHEDULER]: MODE.SHADOW,
    [SERVICE.HEALTH]: MODE.SHADOW,
    [SERVICE.STATUS_SYNC]: MODE.SHADOW,
    [SERVICE.HISTORY]: MODE.SHADOW,
    [SERVICE.RECOVERY]: MODE.SHADOW,
    [SERVICE.ENGINE]: MODE.SHADOW,
  });
});

test('blocks technical flow disablement while scheduler is not active', async () => {
  const service = createReadinessService();
  const readiness = await service.check();

  assert.equal(readiness.mode, MODE.SHADOW);
  assert.equal(readiness.safeToDisableTechnicalFlows, false);
  assert.equal(readiness.updatedTs, NOW);
  assert(readiness.blockers.some(blocker => blocker.code === 'SCHEDULER_PROGRAM_REQUESTS_DISABLED_IN_RAMA_2'));
  assert.equal(readiness.engineActivation.allowed, false);
  assert.equal(readiness.services.length, 6);
});

test('propagates shadow comparison blockers from individual services', async () => {
  const service = createReadinessService({
    health: {
      mode: MODE.SHADOW,
      status: 'WARNING',
      comparison: {
        matchesPublicHealth: false,
      },
    },
    statusSync: {
      mode: MODE.SHADOW,
      rawAvailable: false,
      comparison: {
        differences: [],
      },
    },
    history: {
      mode: MODE.SHADOW,
      status: 'DIFF',
      comparison: {
        matchesHistoryDevice: false,
      },
    },
    recovery: {
      mode: MODE.SHADOW,
      status: 'CONFIG_ERROR',
      available: false,
    },
  });

  const readiness = await service.check();
  const codes = readiness.blockers.map(blocker => blocker.code);

  assert(codes.includes('HEALTH_SHADOW_DIFFERS_FROM_PUBLIC_HEALTH'));
  assert(codes.includes('STATUS_SYNC_RAW_UNAVAILABLE'));
  assert(codes.includes('HISTORY_PENDING_OR_INVALID_EVENT'));
  assert(codes.includes('RECOVERY_NOT_READY'));
});

test('blocks engine activation when Health has active ERROR issues', async () => {
  const control = createDefaultMigrationControl();
  control.services[SERVICE.SCHEDULER] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HEALTH] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.STATUS_SYNC] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HISTORY] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.RECOVERY] = MODE.ACTIVE_COMPAT;

  const service = createReadinessService({
    control,
    health: {
      mode: MODE.ACTIVE_COMPAT,
      status: 'ERROR',
      issues: [{ code: 'ESPHOME_ERROR_9', severity: 'ERROR' }],
      comparison: {
        matchesPublicHealth: true,
      },
    },
  });

  const precheck = await service.checkEngineActivation();
  const codes = precheck.blockers.map(blocker => blocker.code);

  assert.equal(precheck.allowed, false);
  assert(codes.includes('HEALTH_HAS_CRITICAL_STATUS'));
  assert(codes.includes('HEALTH_HAS_ACTIVE_ERROR_ISSUES'));
});

test('blocks engine activation when engine is not idle or relays are active', async () => {
  const control = createDefaultMigrationControl();
  control.services[SERVICE.SCHEDULER] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HEALTH] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.STATUS_SYNC] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HISTORY] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.RECOVERY] = MODE.ACTIVE_COMPAT;

  const service = createReadinessService({
    control,
    engine: {
      mode: MODE.SHADOW,
      activeCompatSupported: true,
      rawAvailable: true,
      readyForCutover: false,
      blocker: 'ENGINE_NOT_IDLE',
      engine: {
        state: 'RUNNING',
        activeSector: 2,
        queueLength: 1,
      },
      hardware: {
        activeRelays: [2],
        anyRelayOn: true,
      },
      issues: [],
    },
  });

  const precheck = await service.checkEngineActivation();
  const codes = precheck.blockers.map(blocker => blocker.code);

  assert.equal(precheck.allowed, false);
  assert(codes.includes('ENGINE_NOT_IDLE'));
  assert(codes.includes('ENGINE_ACTIVE_SECTOR_NOT_ZERO'));
  assert(codes.includes('ENGINE_QUEUE_NOT_EMPTY'));
  assert(codes.includes('ENGINE_RELAYS_ACTIVE'));
});

test('blocks engine activation while engine check declares appState backend unavailable', async () => {
  const control = createDefaultMigrationControl();
  control.services[SERVICE.SCHEDULER] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HEALTH] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.STATUS_SYNC] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HISTORY] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.RECOVERY] = MODE.ACTIVE_COMPAT;

  const service = createReadinessService({
    control,
    schedulerStatus: {
      mode: MODE.ACTIVE_COMPAT,
      canEmitProgramRequests: true,
    },
    engine: {
      mode: MODE.SHADOW,
      activeCompatSupported: false,
      rawAvailable: true,
      readyForCutover: false,
      blocker: 'ENGINE_APP_STATE_BACKEND_UNAVAILABLE',
      engine: {
        state: 'IDLE',
        activeSector: 0,
        queueLength: 0,
      },
      hardware: {
        activeRelays: [],
        anyRelayOn: false,
      },
      issues: [],
    },
  });

  const precheck = await service.checkEngineActivation();

  assert.equal(precheck.allowed, false);
  assert(precheck.blockers.some(blocker => blocker.code === 'ENGINE_ACTIVE_COMPAT_NOT_IMPLEMENTED'));

  const readiness = await service.check();
  assert.equal(readiness.readyToActivateEngine, false);
  assert.equal(readiness.safeToDisableTechnicalFlows, false);
});

test('allows engine activation precheck when all migrated services and hardware are clean', async () => {
  const control = createDefaultMigrationControl();
  control.services[SERVICE.SCHEDULER] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HEALTH] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.STATUS_SYNC] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.HISTORY] = MODE.ACTIVE_COMPAT;
  control.services[SERVICE.RECOVERY] = MODE.ACTIVE_COMPAT;

  const service = createReadinessService({
    control,
    schedulerStatus: {
      mode: MODE.ACTIVE_COMPAT,
      canEmitProgramRequests: true,
    },
  });

  const precheck = await service.checkEngineActivation();

  assert.equal(precheck.allowed, true);
  assert.deepEqual(precheck.blockers, []);
  assert.equal(precheck.readiness.readyToActivateEngine, true);
  assert.equal(precheck.readiness.safeToDisableTechnicalFlows, false);
});
