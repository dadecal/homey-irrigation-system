'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODE, SERVICE } = require('../lib/constants');
const { AppStateStore } = require('../lib/app-state-store');
const { TICK_DECISION } = require('../lib/engine-contract');
const { IrrigationEngineService, RAW_DEVICE_ID, RAW_CAP } = require('../lib/irrigation-engine-service');
const { MigrationControlStore } = require('../lib/migration-control-store');

const NOW = 1784620000000;

function createRawDevice(activeRelays = [], available = true, { failWritesWith = null } = {}) {
  const capabilitiesObj = {};
  for (const [sector, capability] of Object.entries(RAW_CAP.relays)) {
    capabilitiesObj[capability] = {
      value: activeRelays.includes(Number(sector)),
    };
  }

  return {
    id: RAW_DEVICE_ID,
    available,
    capabilitiesObj,
    writes: [],
    async setCapabilityValue(capability, value) {
      if (failWritesWith) {
        throw new Error(failWritesWith);
      }
      this.writes.push({ capability, value });
      if (!this.capabilitiesObj[capability]) {
        this.capabilitiesObj[capability] = { value: null };
      }
      this.capabilitiesObj[capability].value = value;
    },
  };
}

function createService({
  engine = {},
  activeRelays = [],
  rawAvailable = true,
  mode = MODE.SHADOW,
  sectorStartedTrigger = null,
  sectorEndedTrigger = null,
  failWritesWith = null,
}) {
  const writes = [];
  const settings = new Map();
  const appStateStore = new AppStateStore({
    settings: {
      get(key) {
        return settings.get(key);
      },
      set(key, value) {
        settings.set(key, value);
      },
    },
  }, { now: () => NOW });
  const engineFromValues = {
    state: String(engine.state || 'IDLE'),
    activeSector: Number(engine.activeSector || 0),
    startTs: Number(engine.startTs || 0),
    endTs: Number(engine.endTs || 0),
    source: String(engine.source || 'none'),
    stopReason: String(engine.stopReason || 'none'),
    queue: Array.isArray(engine.queue) ? engine.queue : [],
    history: [],
    interruption: engine.interruption || null,
    lastTickTs: Number(engine.lastTickTs || 0),
  };
  settings.set('appStateV2', {
    version: 1,
    updatedTs: 0,
    health: null,
    recovery: null,
    history: {
      lastProjectedEventId: null,
      lastProjection: null,
    },
    engine: engineFromValues,
    events: [],
  });
  const rawDevice = createRawDevice(activeRelays, rawAvailable, { failWritesWith });
  const service = new IrrigationEngineService({
    homey: {
      app: {},
    },
    appStateStore,
    apiClient: {
      async getApi() {
        return {
          devices: {
            async getDevice({ id }) {
              if (id === RAW_DEVICE_ID) return rawDevice;
              return {
                id,
                capabilitiesObj: {},
                async setCapabilityValue(capability, value) {
                  this.capabilitiesObj[capability] = { value };
                },
              };
            },
          },
        };
      },
    },
    controlStore: {
      async getControl() {
        return {
          services: {
            [SERVICE.ENGINE]: mode,
          },
        };
      },
    },
    sectorStartedTrigger,
    sectorEndedTrigger,
    now: () => NOW,
    logger: {
      error(...args) {
        writes.push(args);
      },
    },
  });

  return { service, writes, appStateStore, rawDevice };
}

test('reports a clean idle native engine snapshot without writing anything', async () => {
  const { service, writes } = createService({
    engine: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'SCHEDULER',
      stopReason: 'none',
      queue: [],
      lastTickTs: NOW - 60_000,
    },
  });

  const result = await service.check();

  assert.equal(result.mode, MODE.SHADOW);
  assert.equal(result.controlsHardware, false);
  assert.equal(result.writesOperationalVariables, false);
  assert.equal(result.writesInternalState, false);
  assert.equal(result.updatesDevices, false);
  assert.equal(result.activeCompatSupported, true);
  assert.equal(result.rawAvailable, true);
  assert.equal(result.engine.state, 'IDLE');
  assert.equal(result.engine.queueLength, 0);
  assert.deepEqual(result.hardware.activeRelays, []);
  assert.equal(result.tickDecision.decision, TICK_DECISION.FORCE_IDLE_NONE);
  assert.equal(result.dryRunTransaction.type, 'forceIdle');
  assert.equal(result.dryRunTransaction.steps[0].action, 'clearQueue');
  assert.deepEqual(result.dryRunTransaction.failurePlan, []);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(writes, []);
});

test('calculates the shadow timeout decision for a running sector', async () => {
  const { service } = createService({
    engine: {
      state: 'RUNNING',
      activeSector: 2,
      startTs: NOW - 5 * 60_000,
      endTs: NOW,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [{ sector: 3, duration: 4 }],
      lastTickTs: NOW - 60_000,
    },
    activeRelays: [2],
  });

  const result = await service.check();

  assert.equal(result.engine.state, 'RUNNING');
  assert.equal(result.engine.queueLength, 1);
  assert.deepEqual(result.hardware.activeRelays, [2]);
  assert.equal(result.tickDecision.decision, TICK_DECISION.STOP_TIMEOUT);
  assert.equal(result.dryRunTransaction.type, 'stop');
  assert.equal(result.dryRunTransaction.steps[0].action, 'setAllRelays');
  assert.equal(result.dryRunTransaction.steps[1].action, 'appendHistory');
  assert.deepEqual(result.issues, []);
});

test('reports engine invariants without taking corrective action in shadow mode', async () => {
  const { service } = createService({
    engine: {
      state: 'RUNNING',
      activeSector: 1,
      startTs: NOW - 60_000,
      endTs: NOW + 60_000,
      queue: [],
    },
    activeRelays: [1, 2],
  });

  const result = await service.check();

  assert.equal(result.controlsHardware, false);
  assert(result.issues.some(issue => issue.code === 'MULTIPLE_RELAYS_ACTIVE'));
});

test('keeps engine ACTIVE_COMPAT blocked in migration control', async () => {
  let stored = null;
  const store = new MigrationControlStore({
    settings: {
      get() {
        return stored;
      },
      set(key, value) {
        stored = value;
      },
    },
  });

  await assert.rejects(
    () => store.setServiceMode(SERVICE.ENGINE, MODE.ACTIVE_COMPAT, {
      acknowledgeDuplicateWriteRisk: true,
    }),
    /precheck limpio/,
  );

  const control = await store.getControl();
  assert.equal(control.services[SERVICE.ENGINE], MODE.SHADOW);
  assert.equal(control.activeCompatSupported[SERVICE.ENGINE], true);
});

test('previews a native manual start without changing the current bridge behavior', async () => {
  const { service } = createService({
    engine: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
    },
  });

  const result = await service.previewManualStart({ sector: 4, duration: 9 });

  assert.equal(result.action, 'manualStart');
  assert.equal(result.controlsHardware, false);
  assert.equal(result.writesOperationalVariables, false);
  assert.equal(result.dryRunTransaction.type, 'startQueuedItem');
  assert.equal(result.dryRunTransaction.item.sector, 4);
  assert(result.dryRunTransaction.steps.every(step => step.dryRun === true));
});

test('previews a native scheduler request using the program request contract', async () => {
  const { service } = createService({
    engine: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'SCHEDULER',
      stopReason: 'none',
      queue: [],
    },
  });

  const result = await service.previewProgramStart({
    version: 1,
    requestId: 'request-1',
    requestedAt: NOW - 1000,
    source: 'SCHEDULER',
    queue: [{ sector: 1, duration: 5 }, { sector: 2, duration: 6 }],
  });

  assert.equal(result.action, 'programStart');
  assert.equal(result.request.requestId, 'request-1');
  assert.equal(result.dryRunTransaction.type, 'startQueuedItem');
  assert.equal(result.dryRunTransaction.item.source, 'SCHEDULER');
  assert.equal(result.dryRunTransaction.remainingQueue.length, 1);
});

test('previews a manual stop without writing relays or state', async () => {
  const { service } = createService({
    engine: {
      state: 'RUNNING',
      activeSector: 5,
      startTs: NOW - 60_000,
      endTs: NOW + 60_000,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
    },
    activeRelays: [5],
  });

  const result = await service.previewManualStop();

  assert.equal(result.action, 'manualStop');
  assert.equal(result.controlsHardware, false);
  assert.equal(result.dryRunTransaction.type, 'stop');
  assert.equal(result.dryRunTransaction.reason, 'manual');
  assert.equal(result.dryRunTransaction.steps[0].action, 'setAllRelays');
});

test('rejects real engine actions while engine remains in SHADOW', async () => {
  const { service } = createService({
    engine: {
      state: 'IDLE',
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'MANUAL',
      stopReason: 'none',
      queue: [],
    },
  });

  await assert.rejects(
    () => service.startManual({ sector: 1, duration: 1 }),
    /engine=ACTIVE_COMPAT/,
  );
});

test('uses appStateV2.engine as snapshot source in ACTIVE_COMPAT mode', async () => {
  const { service, appStateStore } = createService({
    mode: MODE.ACTIVE_COMPAT,
    engine: {
      state: 'RUNNING',
      activeSector: 4,
      queue: [{ sector: 5, duration: 10 }],
    },
  });
  await appStateStore.setEngineValues({
    state: 'IDLE',
    activeSector: 0,
    startTs: 0,
    endTs: 0,
    source: 'MANUAL',
    stopReason: 'none',
  });
  await appStateStore.clearEngineQueue();

  const result = await service.check();

  assert.equal(result.mode, MODE.ACTIVE_COMPAT);
  assert.equal(result.stateSource, 'appStateV2.engine');
  assert.equal(result.activeCompatSupported, true);
  assert.equal(result.engine.state, 'IDLE');
  assert.equal(result.engine.activeSector, 0);
  assert.equal(result.engine.queueLength, 0);
});

test('active manual start persists native engine state', async () => {
  const sectorTriggers = [];
  const { service, appStateStore, rawDevice } = createService({
    mode: MODE.ACTIVE_COMPAT,
    engine: {
      state: 'IDLE',
      activeSector: 0,
      queue: [],
    },
    sectorStartedTrigger: {
      async trigger(tokens) {
        sectorTriggers.push({ id: 'sector_started', tokens });
      },
    },
  });
  await appStateStore.setEngineValues({
    state: 'IDLE',
    activeSector: 0,
    startTs: 0,
    endTs: 0,
    source: 'MANUAL',
    stopReason: 'none',
  });
  await appStateStore.clearEngineQueue();

  const result = await service.startManual({ sector: 3, duration: 2 });
  const engine = await appStateStore.getEngineState();

  assert.equal(result.mode, MODE.ACTIVE_COMPAT);
  assert.equal(result.action, 'manualStart');
  assert.equal(result.writesOperationalVariables, false);
  assert.equal(result.writesInternalState, true);
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 3);
  assert.equal(engine.endTs, NOW + 2 * 60_000);
  assert.equal(engine.lastSectorEvent.type, 'sectorStart');
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[3]].value, true);
  assert.equal(sectorTriggers.length, 1);
  assert.equal(sectorTriggers[0].id, 'sector_started');
  assert.equal(sectorTriggers[0].tokens.sector, 3);
});

test('active scheduler program continues with the next queued sector after timeout', async () => {
  const { service, appStateStore, rawDevice } = createService({
    mode: MODE.ACTIVE_COMPAT,
    engine: {
      state: 'IDLE',
      activeSector: 0,
      queue: [],
    },
  });
  await appStateStore.setEngineValues({
    state: 'IDLE',
    activeSector: 0,
    startTs: 0,
    endTs: 0,
    source: 'none',
    stopReason: 'none',
  });
  await appStateStore.clearEngineQueue();

  const request = {
    version: 1,
    requestId: 'request-queue',
    requestedAt: NOW - 1000,
    source: 'SCHEDULER',
    queue: [
      { sector: 1, duration: 5 },
      { sector: 2, duration: 6 },
    ],
  };

  await service.startProgram(request, NOW);
  let engine = await appStateStore.getEngineState();
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 1);
  assert.deepEqual(engine.queue.map(item => item.sector), [2]);

  const result = await service.tick(NOW + 5 * 60_000);
  engine = await appStateStore.getEngineState();

  assert.equal(result.tickDecision.decision, TICK_DECISION.STOP_TIMEOUT);
  assert.equal(result.nextExecution.type, 'startQueuedItem');
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 2);
  assert.deepEqual(engine.queue, []);
  assert.equal(engine.history[0].sector, 1);
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[1]].value, false);
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[2]].value, true);
});

test('active scheduler start failure from disconnected controller returns to idle for retry', async () => {
  const { service, appStateStore, rawDevice } = createService({
    mode: MODE.ACTIVE_COMPAT,
    failWritesWith: 'Cannot send command: client not connected',
    engine: {
      state: 'IDLE',
      activeSector: 0,
      queue: [],
    },
  });
  await appStateStore.setEngineValues({
    state: 'IDLE',
    activeSector: 0,
    startTs: 0,
    endTs: 0,
    source: 'none',
    stopReason: 'none',
  });
  await appStateStore.clearEngineQueue();

  const request = {
    version: 1,
    requestId: 'request-retryable-start',
    requestedAt: NOW - 1000,
    source: 'SCHEDULER',
    queue: [
      { sector: 1, duration: 5 },
      { sector: 3, duration: 15 },
    ],
  };

  const result = await service.startProgram(request, NOW);
  const engine = await appStateStore.getEngineState();

  assert.equal(result.execution.failed, true);
  assert.equal(result.execution.retryable, true);
  assert.equal(result.execution.errorCode, 'CONTROLLER_COMMAND_UNAVAILABLE');
  assert.equal(engine.state, 'IDLE');
  assert.equal(engine.activeSector, 0);
  assert.equal(engine.stopReason, 'none');
  assert.deepEqual(engine.queue, []);
  assert.equal(engine.interruption, null);
  assert.deepEqual(rawDevice.writes, []);
});

test('active tick does not clear a scheduler queue while program start is in progress', async () => {
  const { service, appStateStore, rawDevice } = createService({
    mode: MODE.ACTIVE_COMPAT,
    engine: {
      state: 'IDLE',
      activeSector: 0,
      queue: [],
    },
  });
  await appStateStore.setEngineValues({
    state: 'IDLE',
    activeSector: 0,
    startTs: 0,
    endTs: 0,
    source: 'none',
    stopReason: 'none',
  });
  await appStateStore.clearEngineQueue();

  const request = {
    version: 1,
    requestId: 'request-race',
    requestedAt: NOW - 1000,
    source: 'SCHEDULER',
    queue: [
      { sector: 1, duration: 5 },
      { sector: 2, duration: 6 },
    ],
  };

  const programStart = service.startProgram(request, NOW);
  const tick = await service.tick(NOW);
  const result = await programStart;
  const engine = await appStateStore.getEngineState();

  assert.equal(tick.skipped, true);
  assert.equal(tick.reason, 'OPERATION_RUNNING');
  assert.equal(result.execution.failed, undefined);
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 1);
  assert.deepEqual(engine.queue.map(item => item.sector), [2]);
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[1]].value, true);
});

test('active tick resumes a pending queue left in an idle engine state', async () => {
  const { service, appStateStore, rawDevice } = createService({
    mode: MODE.ACTIVE_COMPAT,
    engine: {
      state: 'IDLE',
      activeSector: 0,
      queue: [],
    },
  });
  await appStateStore.setEngineValues({
    state: 'IDLE',
    activeSector: 0,
    startTs: NOW - 60_000,
    endTs: 0,
    source: 'SCHEDULER',
    stopReason: 'timeout',
  });
  await appStateStore.setEngineQueue([
    {
      id: 'pending-2',
      createdTs: NOW - 60_000,
      sector: 2,
      duration: 6,
      source: 'SCHEDULER',
      description: 'Programa automatico request-queue',
    },
  ]);

  const result = await service.tick(NOW);
  const engine = await appStateStore.getEngineState();

  assert.equal(result.tickDecision.decision, TICK_DECISION.START_PENDING_QUEUE);
  assert.equal(result.nextExecution.type, 'startQueuedItem');
  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 2);
  assert.deepEqual(engine.queue, []);
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[2]].value, true);
  assert.equal(engine.tickDiagnostics[0].tickDecision.decision, TICK_DECISION.START_PENDING_QUEUE);
});

test('active tick preserves queue when RAW becomes unavailable during irrigation', async () => {
  const { service, appStateStore } = createService({
    mode: MODE.ACTIVE_COMPAT,
    rawAvailable: false,
    engine: {
      state: 'RUNNING',
      activeSector: 3,
      startTs: NOW - 120_000,
      endTs: NOW + 600_000,
      source: 'SCHEDULER',
      stopReason: 'none',
      queue: [
        {
          id: 'pending-4',
          createdTs: NOW - 120_000,
          sector: 4,
          duration: 15,
          source: 'SCHEDULER',
          description: 'Programa automatico request-recovery',
        },
      ],
    },
  });

  const result = await service.tick(NOW);
  const engine = await appStateStore.getEngineState();

  assert.equal(result.tickDecision.decision, TICK_DECISION.RAW_UNAVAILABLE_DURING_RUN);
  assert.equal(result.transaction.type, 'interruptForRecovery');
  assert.equal(engine.state, 'ERROR');
  assert.equal(engine.activeSector, 3);
  assert.deepEqual(engine.queue.map(item => item.sector), [4]);
  assert.equal(engine.interruption.status, 'AWAITING_CONTROLLER');
  assert.equal(engine.interruption.sector, 3);
  assert.deepEqual(engine.interruption.pendingQueue.map(item => item.sector), [4]);
});

test('active tick marks an interrupted run ready without auto-resuming the preserved queue', async () => {
  const { service, appStateStore, rawDevice } = createService({
    mode: MODE.ACTIVE_COMPAT,
    rawAvailable: true,
    activeRelays: [],
    engine: {
      state: 'ERROR',
      activeSector: 3,
      startTs: NOW - 120_000,
      endTs: NOW + 600_000,
      source: 'SCHEDULER',
      stopReason: 'watchdog',
      queue: [
        {
          id: 'pending-4',
          createdTs: NOW - 120_000,
          sector: 4,
          duration: 15,
          source: 'SCHEDULER',
          description: 'Programa automatico request-recovery',
        },
      ],
      interruption: {
        version: 1,
        status: 'AWAITING_CONTROLLER',
        sector: 3,
        source: 'SCHEDULER',
        startTs: NOW - 120_000,
        plannedEndTs: NOW + 600_000,
        detectedTs: NOW - 60_000,
        reason: 'raw_unavailable',
        message: 'Conexion perdida durante el riego',
        pendingQueue: [],
        historyEntryId: null,
      },
    },
  });

  const tick = await service.tick(NOW);
  const readyEngine = await appStateStore.getEngineState();

  assert.equal(tick.tickDecision.decision, TICK_DECISION.RECOVERY_READY);
  assert.equal(tick.transaction.type, 'markInterruptionReady');
  assert.equal(readyEngine.state, 'ERROR');
  assert.equal(readyEngine.interruption.status, 'READY_TO_RESUME');
  assert.equal(readyEngine.history.length, 1);
  assert.deepEqual(readyEngine.queue.map(item => item.sector), [4]);
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[4]].value, false);

  const resumed = await service.resumePending(NOW + 1000);
  const runningEngine = await appStateStore.getEngineState();

  assert.equal(resumed.action, 'resumePending');
  assert.equal(runningEngine.state, 'RUNNING');
  assert.equal(runningEngine.activeSector, 4);
  assert.equal(runningEngine.interruption, null);
  assert.deepEqual(runningEngine.queue, []);
  assert.equal(rawDevice.capabilitiesObj[RAW_CAP.relays[4]].value, true);
});

test('active tick persists compact diagnostics for later incident analysis', async () => {
  const { service, appStateStore } = createService({
    mode: MODE.ACTIVE_COMPAT,
    activeRelays: [2],
    engine: {
      state: 'IDLE',
      activeSector: 0,
      queue: [],
    },
  });
  await appStateStore.setEngineValues({
    state: 'RUNNING',
    activeSector: 2,
    startTs: NOW - 30_000,
    endTs: NOW + 60_000,
    source: 'SCHEDULER',
    stopReason: 'none',
  });
  await appStateStore.clearEngineQueue();

  const result = await service.tick();
  const status = await service.status();
  const engine = await appStateStore.getEngineState();
  const diagnostic = engine.tickDiagnostics[0];

  assert.equal(result.tickDecision.decision, TICK_DECISION.UPDATE_RUNNING);
  assert.equal(diagnostic.tickDecision.decision, TICK_DECISION.UPDATE_RUNNING);
  assert.equal(diagnostic.stateSource, 'appStateV2.engine');
  assert.equal(diagnostic.state, 'RUNNING');
  assert.equal(diagnostic.activeSector, 2);
  assert.deepEqual(diagnostic.activeRelays, [2]);
  assert.equal(diagnostic.rawAvailable, true);
  assert.equal(diagnostic.execution.failed, false);
  assert.equal(status.diagnostics.tickCount, 1);
  assert.equal(status.diagnostics.lastTicks[0].tickDecision.decision, TICK_DECISION.UPDATE_RUNNING);
});
