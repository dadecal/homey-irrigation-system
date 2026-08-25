'use strict';

const { MODE, SERVICE } = require('./constants');
const {
  buildManualStartPreview,
  buildProgramStartPreview,
  buildStartQueuedItemPlan,
  buildStopPlan,
  buildTickDryRunTransaction,
  createAdapters,
} = require('./engine-dry-run-adapters');
const { EnginePlanExecutor } = require('./engine-plan-executor');
const {
  STATE,
  STOP_REASON,
  TICK_DECISION,
  decideTick,
  remainingMinutes,
  normalizeProgramRequest,
} = require('./engine-contract');

const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';
const ACTIVE_TICK_INTERVAL_MS = 30 * 1000;

const RAW_CAP = {
  relays: {
    1: 'onoff',
    2: 'onoff.rel__l_nea_2',
    3: 'onoff.rel__l_nea_3',
    4: 'onoff.rel__l_nea_4',
    5: 'onoff.rel__l_nea_5',
    6: 'onoff.rel__l_nea_6',
  },
};

function readRelayStates(rawDevice) {
  const relayStates = {};

  for (const [sector, capability] of Object.entries(RAW_CAP.relays)) {
    relayStates[Number(sector)] = Boolean(rawDevice?.capabilitiesObj?.[capability]?.value);
  }

  const activeRelays = Object.entries(relayStates)
    .filter(([, active]) => active)
    .map(([sector]) => Number(sector));

  return {
    relayStates,
    activeRelays,
    anyRelayOn: activeRelays.length > 0,
  };
}

function validateEngineSnapshot(snapshot) {
  const issues = [];

  if (!Object.values(STATE).includes(snapshot.state)) {
    issues.push({
      code: 'INVALID_STATE',
      message: `Estado de motor no valido: ${snapshot.state}`,
    });
  }

  if (snapshot.activeSector < 0 || snapshot.activeSector > 6) {
    issues.push({
      code: 'INVALID_ACTIVE_SECTOR',
      message: `Sector activo fuera de rango: ${snapshot.activeSector}`,
    });
  }

  if (snapshot.state === STATE.RUNNING) {
    if (snapshot.activeSector < 1 || snapshot.activeSector > 6) {
      issues.push({
        code: 'RUNNING_WITHOUT_ACTIVE_SECTOR',
        message: 'Motor RUNNING sin sector activo valido',
      });
    }

    if (!(snapshot.startTs > 0 && snapshot.endTs > snapshot.startTs)) {
      issues.push({
        code: 'RUNNING_WITH_INVALID_TIMESTAMPS',
        message: 'Motor RUNNING sin timestamps validos',
      });
    }
  }

  if (snapshot.state === STATE.IDLE && snapshot.activeSector !== 0) {
    issues.push({
      code: 'IDLE_WITH_ACTIVE_SECTOR',
      message: `Motor IDLE con sector activo ${snapshot.activeSector}`,
    });
  }

  if (snapshot.activeRelays.length > 1) {
    issues.push({
      code: 'MULTIPLE_RELAYS_ACTIVE',
      message: `Hay ${snapshot.activeRelays.length} reles activos`,
      activeRelays: snapshot.activeRelays,
    });
  }

  if (snapshot.state === STATE.RUNNING
    && snapshot.activeSector >= 1
    && snapshot.activeSector <= 6
    && snapshot.activeRelays.length === 1
    && snapshot.activeRelays[0] !== snapshot.activeSector) {
    issues.push({
      code: 'ACTIVE_RELAY_DOES_NOT_MATCH_SECTOR',
      message: `Rele activo ${snapshot.activeRelays[0]} no coincide con sector ${snapshot.activeSector}`,
      activeRelays: snapshot.activeRelays,
    });
  }

  return issues;
}

function engineActiveCompatSupported(appStateStore) {
  return Boolean(appStateStore);
}

function evaluateCutoverReadiness({ activeCompatSupported, rawAvailable, snapshot, issues }) {
  if (!activeCompatSupported) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_APP_STATE_BACKEND_UNAVAILABLE',
    };
  }

  if (!rawAvailable) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_RAW_UNAVAILABLE',
    };
  }

  if (snapshot.state !== STATE.IDLE) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_NOT_IDLE',
    };
  }

  if (Number(snapshot.activeSector || 0) !== 0) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_ACTIVE_SECTOR_NOT_ZERO',
    };
  }

  if ((snapshot.queue || []).length > 0) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_QUEUE_NOT_EMPTY',
    };
  }

  if (snapshot.anyRelayOn || (snapshot.activeRelays || []).length > 0) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_RELAYS_ACTIVE',
    };
  }

  if ((issues || []).length > 0) {
    return {
      readyForCutover: false,
      blocker: 'ENGINE_HAS_INVARIANT_ISSUES',
    };
  }

  return {
    readyForCutover: true,
    blocker: null,
  };
}

function buildTickDiagnostic({
  ts,
  stateSource,
  snapshot,
  rawAvailable,
  rawError,
  tickDecision,
  execution,
  nextExecution,
}) {
  return {
    version: 1,
    ts,
    stateSource,
    rawAvailable,
    rawError,
    state: snapshot.state,
    activeSector: snapshot.activeSector,
    startTs: snapshot.startTs,
    endTs: snapshot.endTs,
    source: snapshot.source,
    stopReason: snapshot.stopReason,
    queueLength: Array.isArray(snapshot.queue) ? snapshot.queue.length : 0,
    queue: Array.isArray(snapshot.queue)
      ? snapshot.queue.map(item => ({
        sector: item.sector,
        duration: item.duration,
        source: item.source,
        id: item.id,
      }))
      : [],
    relayStates: snapshot.relayStates || {},
    activeRelays: snapshot.activeRelays || [],
    anyRelayOn: Boolean(snapshot.anyRelayOn),
    tickDecision,
    execution: execution
      ? {
        type: execution.type,
        accepted: execution.accepted,
        failed: Boolean(execution.failed),
        error: execution.error || null,
      }
      : null,
    nextExecution: nextExecution
      ? {
        type: nextExecution.type,
        accepted: nextExecution.accepted,
        failed: Boolean(nextExecution.failed),
        error: nextExecution.error || null,
      }
      : null,
  };
}

function compactPlanForDiagnostics(plan) {
  if (!plan) return null;

  return {
    type: plan.type,
    accepted: plan.accepted,
    reason: plan.reason || null,
    item: plan.item
      ? {
        sector: plan.item.sector,
        duration: plan.item.duration,
        source: plan.item.source,
        id: plan.item.id,
      }
      : null,
    remainingQueue: Array.isArray(plan.remainingQueue)
      ? plan.remainingQueue.map(item => ({
        sector: item.sector,
        duration: item.duration,
        source: item.source,
        id: item.id,
      }))
      : [],
    stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
    steps: Array.isArray(plan.steps)
      ? plan.steps.map(step => `${step.adapter}:${step.action}`)
      : [],
  };
}

function compactExecutionForDiagnostics(execution) {
  if (!execution) return null;

  return {
    type: execution.type,
    accepted: execution.accepted,
    failed: Boolean(execution.failed),
    error: execution.error || null,
  };
}

function shouldRecordActionDiagnostic(action, plan, execution) {
  if (execution?.failed) return true;
  if (action !== 'tick') return true;
  return !['forceIdle', 'updateRunning', 'noop'].includes(plan?.type);
}

class IrrigationEngineService {
  constructor({
    homey,
    apiClient,
    appStateStore = null,
    controlStore,
    sectorStartedTrigger = null,
    sectorEndedTrigger = null,
    now = () => Date.now(),
    logger = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.appStateStore = appStateStore;
    this.controlStore = controlStore;
    this.now = now;
    this.logger = logger || homey.app;
    this.planExecutor = new EnginePlanExecutor({
      apiClient,
      appStateStore,
      sectorStartedTrigger,
      sectorEndedTrigger,
      logger: this.logger,
      now,
    });
    this.lastCheck = null;
    this.lastAction = null;
    this.lastError = null;
    this.tickTimer = null;
    this.ticking = false;
    this.operationLock = null;
  }

  async runExclusive(action, operation, { skipIfBusy = false } = {}) {
    while (this.operationLock) {
      if (skipIfBusy) {
        return { skipped: true, reason: 'OPERATION_RUNNING', action };
      }
      await this.operationLock;
    }

    let release;
    this.operationLock = new Promise(resolve => {
      release = resolve;
    });

    try {
      return await operation();
    } finally {
      this.operationLock = null;
      release();
    }
  }

  start() {
    if (this.tickTimer) return;

    this.tickTimer = this.homey.setInterval(() => {
      this.tick().catch(error => {
        if (error.statusCode === 409) return;
        this.lastError = {
          ts: this.now(),
          message: error.message,
        };
        this.logger.error('Native irrigation engine tick failed', error);
      });
    }, ACTIVE_TICK_INTERVAL_MS);
  }

  stop() {
    if (!this.tickTimer) return;

    this.homey.clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  async getMode() {
    if (!this.controlStore) return MODE.SHADOW;

    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.ENGINE] || MODE.SHADOW;
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

  async requireActiveMode() {
    const mode = await this.getMode();
    if (mode !== MODE.ACTIVE_COMPAT) {
      const error = new Error('IrrigationEngineService requiere engine=ACTIVE_COMPAT para ejecutar acciones reales');
      error.statusCode = 409;
      throw error;
    }
    return mode;
  }

  async readAppStateSnapshot() {
    const engine = this.appStateStore
      ? await this.appStateStore.getEngineState()
      : {};
    return {
      state: String(engine.state || STATE.IDLE),
      activeSector: Number(engine.activeSector) || 0,
      startTs: Number(engine.startTs) || 0,
      endTs: Number(engine.endTs) || 0,
      source: String(engine.source || 'none'),
      stopReason: String(engine.stopReason || 'none'),
      queue: Array.isArray(engine.queue) ? engine.queue : [],
      interruption: engine.interruption && typeof engine.interruption === 'object'
        ? engine.interruption
        : null,
      lastTickTs: Number(engine.lastTickTs) || 0,
    };
  }

  async readEngineSnapshotForMode(mode = MODE.SHADOW) {
    return this.readAppStateSnapshot();
  }

  async check(nowTs = this.now()) {
    try {
      const mode = await this.getMode();
      const engineState = await this.readEngineSnapshotForMode(mode);

      let rawAvailable = false;
      let relaySnapshot = {
        relayStates: {},
        activeRelays: [],
        anyRelayOn: false,
      };
      let rawError = null;

      try {
        const raw = await this.getRawDevice();
        rawAvailable = Boolean(raw?.available ?? raw);
        relaySnapshot = readRelayStates(raw);
      } catch (error) {
        rawError = error.message;
      }

      const snapshot = {
        ...engineState,
        ...relaySnapshot,
      };
      const tickDecision = decideTick({
        state: snapshot.state,
        endTs: snapshot.endTs,
        activeSector: snapshot.activeSector,
        anyRelayOn: snapshot.anyRelayOn,
        rawAvailable,
        interruption: snapshot.interruption,
        startTs: snapshot.startTs,
        now: nowTs,
      });
      const issues = validateEngineSnapshot(snapshot);
      const dryRunTransaction = buildTickDryRunTransaction({
        snapshot,
        tickDecision,
        now: nowTs,
      });
      const activeCompatSupported = engineActiveCompatSupported(this.appStateStore);
      const cutover = evaluateCutoverReadiness({
        activeCompatSupported,
        rawAvailable,
        snapshot,
        issues,
      });

      const result = {
        version: 1,
        mode,
        shadow: mode === MODE.SHADOW,
        controlsHardware: false,
        writesOperationalVariables: false,
        writesInternalState: false,
        updatesDevices: false,
        activeCompatSupported,
        updatedTs: nowTs,
        rawAvailable,
        rawError,
        engine: {
          state: snapshot.state,
          activeSector: snapshot.activeSector,
          startTs: snapshot.startTs,
          endTs: snapshot.endTs,
          source: snapshot.source,
          stopReason: snapshot.stopReason,
          queueLength: snapshot.queue.length,
          queue: snapshot.queue,
          interruption: snapshot.interruption || null,
          lastTickTs: snapshot.lastTickTs,
          remainingMinutes: remainingMinutes(snapshot.endTs, nowTs),
        },
        stateSource: 'appStateV2.engine',
        hardware: relaySnapshot,
        tickDecision,
        dryRunTransaction,
        issues,
        readyToCompare: true,
        readyForCutover: cutover.readyForCutover,
        blocker: cutover.blocker,
      };

      this.lastCheck = result;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      throw error;
    }
  }

  async createSnapshot() {
    const mode = await this.getMode();
    const engineState = await this.readEngineSnapshotForMode(mode);
    let relaySnapshot = {
      relayStates: {},
      activeRelays: [],
      anyRelayOn: false,
    };
    let rawAvailable = false;
    let rawError = null;

    try {
      const raw = await this.getRawDevice();
      rawAvailable = Boolean(raw?.available ?? raw);
      relaySnapshot = readRelayStates(raw);
    } catch (error) {
      rawError = error.message;
    }

    return {
      snapshot: {
        ...engineState,
        ...relaySnapshot,
      },
      stateSource: 'appStateV2.engine',
      rawAvailable,
      rawError,
    };
  }

  createActiveAdapters() {
    return createAdapters({ dryRun: false });
  }

  getActivePlanExecutor() {
    return this.planExecutor;
  }

  async executePlan(plan, action) {
    const executor = this.getActivePlanExecutor();
    try {
      const execution = plan.accepted === false
        ? await executor.execute(plan)
        : await executor.execute(plan);
      this.lastAction = {
        ts: this.now(),
        action,
        plan,
        execution,
      };
      if (this.appStateStore && shouldRecordActionDiagnostic(action, plan, execution)) {
        await this.appStateStore.appendEngineActionDiagnostic({
          version: 1,
          ts: this.now(),
          action,
          plan: compactPlanForDiagnostics(plan),
          execution: compactExecutionForDiagnostics(execution),
        });
      }
      this.lastError = null;
      return execution;
    } catch (error) {
      let failureExecution = null;
      if (plan.failurePlan?.length) {
        failureExecution = await executor.executeFailurePlan(plan, error).catch(failureError => ({
          type: 'failurePlan',
          dryRun: false,
          sourcePlanType: plan.type,
          error: failureError.message,
          failed: true,
        }));
      }
      this.lastError = {
        ts: this.now(),
        action,
        message: error.message,
        failureExecution,
      };
      const execution = {
        type: plan.type,
        dryRun: false,
        accepted: plan.accepted,
        failed: true,
        error: error.message,
        failureExecution,
      };
      if (this.appStateStore) {
        await this.appStateStore.appendEngineActionDiagnostic({
          version: 1,
          ts: this.now(),
          action,
          plan: compactPlanForDiagnostics(plan),
          execution: compactExecutionForDiagnostics(execution),
        });
      }
      return execution;
    }
  }

  async startManual(input = {}, nowTs = this.now()) {
    return this.runExclusive('manualStart', () => this.startManualLocked(input, nowTs));
  }

  async startManualLocked(input = {}, nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const sector = Math.round(Number(input.sector));
    const duration = Math.round(Number(input.duration));
    const plan = buildManualStartPreview({
      snapshot,
      input: { sector, duration },
      now: nowTs,
      adapters: this.createActiveAdapters(),
    });
    const execution = await this.executePlan(plan, 'manualStart');

    return {
      version: 1,
      mode,
      shadow: false,
      action: 'manualStart',
      controlsHardware: true,
      writesOperationalVariables: false,
      writesInternalState: true,
      updatesDevices: true,
      rawAvailable,
      rawError,
      input: { sector, duration },
      transaction: plan,
      execution,
    };
  }

  async startProgram(requestInput = {}, nowTs = this.now()) {
    return this.runExclusive('programStart', () => this.startProgramLocked(requestInput, nowTs));
  }

  async startProgramLocked(requestInput = {}, nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const request = normalizeProgramRequest(requestInput);
    const plan = buildProgramStartPreview({
      snapshot,
      request,
      now: nowTs,
      adapters: this.createActiveAdapters(),
    });
    const execution = await this.executePlan(plan, 'programStart');

    return {
      version: 1,
      mode,
      shadow: false,
      action: 'programStart',
      controlsHardware: true,
      writesOperationalVariables: false,
      writesInternalState: true,
      updatesDevices: true,
      rawAvailable,
      rawError,
      request,
      transaction: plan,
      execution,
    };
  }

  async stopManual(nowTs = this.now()) {
    return this.runExclusive('manualStop', () => this.stopManualLocked(nowTs));
  }

  async stopManualLocked(nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();

    if (snapshot.state === STATE.IDLE) {
      const result = {
        version: 1,
        mode,
        shadow: false,
        action: 'manualStop',
        controlsHardware: true,
        writesOperationalVariables: false,
        writesInternalState: false,
        updatesDevices: false,
        rawAvailable,
        rawError,
        transaction: {
          type: 'noop',
          dryRun: false,
          reason: 'ALREADY_IDLE',
          steps: [],
          failurePlan: [],
        },
      };
      this.lastAction = { ts: nowTs, action: 'manualStop', result };
      return result;
    }

    const liters = snapshot.activeSector >= 1 && snapshot.activeSector <= 6
      ? await this.getActivePlanExecutor().readLiters(snapshot.activeSector).catch(() => 0)
      : 0;
    const plan = buildStopPlan({
      snapshot,
      reason: STOP_REASON.MANUAL,
      now: nowTs,
      liters,
      adapters: this.createActiveAdapters(),
    });
    const execution = await this.executePlan(plan, 'manualStop');

    return {
      version: 1,
      mode,
      shadow: false,
      action: 'manualStop',
      controlsHardware: true,
      writesOperationalVariables: false,
      writesInternalState: true,
      updatesDevices: true,
      rawAvailable,
      rawError,
      transaction: plan,
      execution,
    };
  }

  async startNextQueuedItem(nowTs = this.now()) {
    const { snapshot } = await this.createSnapshot();
    if (!snapshot.queue.length) return null;

    const plan = buildStartQueuedItemPlan({
      snapshot,
      queue: snapshot.queue,
      now: nowTs,
      adapters: this.createActiveAdapters(),
    });
    return this.executePlan(plan, 'startNextQueuedItem');
  }

  async tick(nowTs = this.now()) {
    return this.runExclusive('tick', () => this.tickLocked(nowTs), { skipIfBusy: true });
  }

  async tickLocked(nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    if (this.ticking) return { skipped: true, reason: 'ALREADY_RUNNING' };
    this.ticking = true;

    try {
      await this.appStateStore.setEngineLastTick(nowTs);
      const {
        snapshot,
        stateSource,
        rawAvailable,
        rawError,
      } = await this.createSnapshot();

      if (snapshot.state === STATE.IDLE
        && !snapshot.interruption
        && !snapshot.anyRelayOn
        && snapshot.queue.length > 0) {
        const tickDecision = {
          decision: TICK_DECISION.START_PENDING_QUEUE,
          reason: 'pendingQueue',
          queueLength: snapshot.queue.length,
        };
        const nextExecution = await this.startNextQueuedItem(nowTs);

        if (this.appStateStore) {
          await this.appStateStore.appendEngineTickDiagnostic(buildTickDiagnostic({
            ts: nowTs,
            stateSource,
            snapshot,
            rawAvailable,
            rawError,
            tickDecision,
            execution: null,
            nextExecution,
          }));
        }

        return {
          version: 1,
          mode,
          shadow: false,
          action: 'tick',
          controlsHardware: true,
          writesOperationalVariables: false,
          writesInternalState: true,
          updatesDevices: true,
          rawAvailable,
          rawError,
          tickDecision,
          transaction: {
            type: 'resumePendingQueue',
            dryRun: false,
            steps: [],
            failurePlan: [],
          },
          execution: null,
          nextExecution,
        };
      }

      const tickDecision = decideTick({
        state: snapshot.state,
        endTs: snapshot.endTs,
        activeSector: snapshot.activeSector,
        anyRelayOn: snapshot.anyRelayOn,
        rawAvailable,
        interruption: snapshot.interruption,
        startTs: snapshot.startTs,
        now: nowTs,
      });
      const liters = [
        TICK_DECISION.STOP_TIMEOUT,
        TICK_DECISION.STOP_WATCHDOG,
        TICK_DECISION.STALE_RUN_ABORT,
        TICK_DECISION.RECOVERY_READY,
      ].includes(tickDecision.decision) && snapshot.activeSector >= 1 && snapshot.activeSector <= 6
        ? await this.getActivePlanExecutor().readLiters(snapshot.activeSector).catch(() => 0)
        : 0;
      const plan = buildTickDryRunTransaction({
        snapshot,
        tickDecision,
        now: nowTs,
        liters,
        adapters: this.createActiveAdapters(),
      });
      const execution = await this.executePlan(plan, 'tick');
      let nextExecution = null;

      if (tickDecision.decision === TICK_DECISION.STOP_TIMEOUT
        && snapshot.queue.length > 0
        && !execution.failed) {
        nextExecution = await this.startNextQueuedItem(nowTs);
      }

      if (this.appStateStore) {
        await this.appStateStore.appendEngineTickDiagnostic(buildTickDiagnostic({
          ts: nowTs,
          stateSource,
          snapshot,
          rawAvailable,
          rawError,
          tickDecision,
          execution,
          nextExecution,
        }));
      }

      return {
        version: 1,
        mode,
        shadow: false,
        action: 'tick',
        controlsHardware: true,
        writesOperationalVariables: false,
        writesInternalState: true,
        updatesDevices: true,
        rawAvailable,
        rawError,
        tickDecision,
        transaction: plan,
        execution,
        nextExecution,
      };
    } finally {
      this.ticking = false;
    }
  }

  async resumePending(nowTs = this.now()) {
    return this.runExclusive('resumePending', () => this.resumePendingLocked(nowTs));
  }

  async resumePendingLocked(nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const interruption = snapshot.interruption || null;

    if (!interruption) {
      const error = new Error('No hay recuperacion pendiente que reanudar');
      error.statusCode = 409;
      throw error;
    }

    if (!rawAvailable) {
      const error = new Error('No se puede reanudar: ESPHome Controller no esta disponible');
      error.statusCode = 409;
      throw error;
    }

    if (snapshot.anyRelayOn) {
      const error = new Error('No se puede reanudar: aun hay electrovalvulas activas');
      error.statusCode = 409;
      throw error;
    }

    if (!snapshot.queue.length) {
      const error = new Error('No hay sectores pendientes que reanudar');
      error.statusCode = 409;
      throw error;
    }

    await this.appStateStore.setEngineValues({
      state: STATE.IDLE,
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      stopReason: STOP_REASON.WATCHDOG,
      interruption: null,
    });
    const nextExecution = await this.startNextQueuedItem(nowTs);

    return {
      version: 1,
      mode,
      shadow: false,
      action: 'resumePending',
      controlsHardware: true,
      writesOperationalVariables: false,
      writesInternalState: true,
      updatesDevices: true,
      rawAvailable,
      rawError,
      resumedQueueLength: snapshot.queue.length,
      nextExecution,
    };
  }

  async cancelPending(nowTs = this.now()) {
    return this.runExclusive('cancelPending', () => this.cancelPendingLocked(nowTs));
  }

  async cancelPendingLocked(nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const interruption = snapshot.interruption || null;

    if (!interruption && snapshot.queue.length === 0) {
      return {
        version: 1,
        mode,
        shadow: false,
        action: 'cancelPending',
        controlsHardware: false,
        writesOperationalVariables: false,
        writesInternalState: false,
        updatesDevices: false,
        rawAvailable,
        rawError,
        message: 'No habia recuperacion pendiente',
      };
    }

    await this.appStateStore.updateEngine(engine => ({
      ...engine,
      state: STATE.IDLE,
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      stopReason: STOP_REASON.WATCHDOG,
      queue: [],
      interruption: null,
      actionDiagnostics: [
        {
          version: 1,
          ts: nowTs,
          action: 'cancelPending',
          interruption,
          queueLength: snapshot.queue.length,
        },
        ...(engine.actionDiagnostics || []),
      ].slice(0, 80),
    }));

    return {
      version: 1,
      mode,
      shadow: false,
      action: 'cancelPending',
      controlsHardware: false,
      writesOperationalVariables: false,
      writesInternalState: true,
      updatesDevices: true,
      rawAvailable,
      rawError,
      cancelledQueueLength: snapshot.queue.length,
    };
  }

  async recover(nowTs = this.now()) {
    return this.runExclusive('recover', () => this.recoverLocked(nowTs));
  }

  async recoverLocked(nowTs = this.now()) {
    const mode = await this.requireActiveMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const plan = buildTickDryRunTransaction({
      snapshot: {
        ...snapshot,
        state: STATE.IDLE,
        activeSector: 0,
        anyRelayOn: false,
      },
      tickDecision: {
        decision: TICK_DECISION.FORCE_IDLE_WATCHDOG,
        reason: STOP_REASON.WATCHDOG,
      },
      now: nowTs,
      adapters: this.createActiveAdapters(),
    });
    const setValues = plan.steps.find(step => step.adapter === 'EngineStateStore' && step.action === 'setValues');
    if (setValues) setValues.values.startTs = 0;
    const execution = await this.executePlan(plan, 'recover');

    return {
      version: 1,
      mode,
      shadow: false,
      action: 'recover',
      controlsHardware: true,
      writesOperationalVariables: false,
      writesInternalState: true,
      updatesDevices: true,
      rawAvailable,
      rawError,
      transaction: plan,
      execution,
    };
  }

  async previewManualStart(input = {}, nowTs = this.now()) {
    const mode = await this.getMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const sector = Math.round(Number(input.sector));
    const duration = Math.round(Number(input.duration));
    const dryRunTransaction = buildManualStartPreview({
      snapshot,
      input: { sector, duration },
      now: nowTs,
    });

    return {
      version: 1,
      mode,
      shadow: true,
      action: 'manualStart',
      controlsHardware: false,
      writesOperationalVariables: false,
      updatesDevices: false,
      rawAvailable,
      rawError,
      input: { sector, duration },
      dryRunTransaction,
    };
  }

  async previewProgramStart(requestInput = {}, nowTs = this.now()) {
    const mode = await this.getMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const request = normalizeProgramRequest(requestInput);
    const dryRunTransaction = buildProgramStartPreview({
      snapshot,
      request,
      now: nowTs,
    });

    return {
      version: 1,
      mode,
      shadow: true,
      action: 'programStart',
      controlsHardware: false,
      writesOperationalVariables: false,
      updatesDevices: false,
      rawAvailable,
      rawError,
      request,
      dryRunTransaction,
    };
  }

  async previewManualStop(nowTs = this.now()) {
    const mode = await this.getMode();
    const { snapshot, rawAvailable, rawError } = await this.createSnapshot();
    const dryRunTransaction = buildStopPlan({
      snapshot,
      reason: STOP_REASON.MANUAL,
      now: nowTs,
    });

    return {
      version: 1,
      mode,
      shadow: true,
      action: 'manualStop',
      controlsHardware: false,
      writesOperationalVariables: false,
      updatesDevices: false,
      rawAvailable,
      rawError,
      dryRunTransaction,
    };
  }

  async status() {
    const mode = await this.getMode();
    const engine = this.appStateStore ? await this.appStateStore.getEngineState() : null;
    return {
      version: 1,
      mode,
      shadow: mode === MODE.SHADOW,
      controlsHardware: mode === MODE.ACTIVE_COMPAT,
      writesOperationalVariables: false,
      writesInternalState: mode === MODE.ACTIVE_COMPAT,
      updatesDevices: mode === MODE.ACTIVE_COMPAT,
      activeCompatSupported: engineActiveCompatSupported(this.appStateStore),
      activeTickIntervalMs: ACTIVE_TICK_INTERVAL_MS,
      activeTickTimerInstalled: Boolean(this.tickTimer),
      activeTickEnabled: mode === MODE.ACTIVE_COMPAT,
      lastCheck: this.lastCheck,
      lastAction: this.lastAction,
      lastError: this.lastError,
      diagnostics: {
        tickCount: engine?.tickDiagnostics?.length || 0,
        lastTicks: engine?.tickDiagnostics || [],
        actionCount: engine?.actionDiagnostics?.length || 0,
        lastActions: engine?.actionDiagnostics || [],
      },
      engine: engine
        ? {
          state: engine.state,
          activeSector: engine.activeSector,
          startTs: engine.startTs,
          endTs: engine.endTs,
          source: engine.source,
          stopReason: engine.stopReason,
          queueLength: Array.isArray(engine.queue) ? engine.queue.length : 0,
          queue: Array.isArray(engine.queue) ? engine.queue : [],
          interruption: engine.interruption || null,
        }
        : null,
      message: mode === MODE.ACTIVE_COMPAT
        ? 'IrrigationEngineService en ACTIVE_COMPAT: controla reles y persiste estado interno en appStateV2.engine sin escribir Variables Logic operativas.'
        : 'IrrigationEngineService esta en SHADOW: calcula diagnostico con estado interno appStateV2.engine; no controla reles.',
    };
  }
}

module.exports = {
  IrrigationEngineService,
  RAW_DEVICE_ID,
  RAW_CAP,
  ACTIVE_TICK_INTERVAL_MS,
  readRelayStates,
  validateEngineSnapshot,
  engineActiveCompatSupported,
  evaluateCutoverReadiness,
};
