'use strict';

const {
  STOP_REASON,
  TICK_DECISION,
  buildHistoryEntry,
  buildManualQueue,
  buildSchedulerQueue,
} = require('./engine-contract');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class EngineStateStore {
  constructor({ dryRun = true } = {}) {
    this.dryRun = dryRun;
  }

  planSetValues(values) {
    return {
      adapter: 'EngineStateStore',
      action: 'setValues',
      dryRun: this.dryRun,
      values: clone(values),
    };
  }

  planClearQueue() {
    return {
      adapter: 'EngineStateStore',
      action: 'clearQueue',
      dryRun: this.dryRun,
      value: [],
    };
  }

  planSetQueue(queue) {
    return {
      adapter: 'EngineStateStore',
      action: 'setQueue',
      dryRun: this.dryRun,
      value: clone(queue),
    };
  }

  planAppendHistory(entry) {
    return {
      adapter: 'EngineStateStore',
      action: 'appendHistory',
      dryRun: this.dryRun,
      entry: clone(entry),
    };
  }

  planEmitSectorEvent(type, message, tokens = {}) {
    return {
      adapter: 'EngineStateStore',
      action: 'emitSectorEvent',
      dryRun: this.dryRun,
      type,
      message,
      tokens: clone(tokens),
    };
  }

  planEmitHistoryTrigger(entryId) {
    return {
      adapter: 'EngineStateStore',
      action: 'emitHistoryTrigger',
      dryRun: this.dryRun,
      entryId,
    };
  }
}

class EspHomeIrrigationHardwareAdapter {
  constructor({ dryRun = true } = {}) {
    this.dryRun = dryRun;
  }

  planSetAllRelays(value) {
    return {
      adapter: 'EspHomeIrrigationHardwareAdapter',
      action: 'setAllRelays',
      dryRun: this.dryRun,
      value: Boolean(value),
    };
  }

  planSetRelay(sector, value) {
    return {
      adapter: 'EspHomeIrrigationHardwareAdapter',
      action: 'setRelay',
      dryRun: this.dryRun,
      sector,
      value: Boolean(value),
    };
  }

  planStartSector(sector) {
    return [
      this.planSetAllRelays(false),
      this.planSetRelay(sector, true),
    ];
  }

  planStopAllRelays() {
    return this.planSetAllRelays(false);
  }
}

function createAdapters(options = {}) {
  return {
    stateStore: new EngineStateStore(options),
    hardware: new EspHomeIrrigationHardwareAdapter(options),
  };
}

function buildRelayFailurePlan({ snapshot, stateStore }) {
  return [
    stateStore.planClearQueue(),
    stateStore.planSetValues({
      state: 'ERROR',
      activeSector: snapshot.activeSector,
      stopReason: STOP_REASON.ERROR,
    }),
  ];
}

function buildStopPlan({
  snapshot,
  reason,
  now,
  liters = 0,
  adapters = createAdapters(),
}) {
  const { stateStore, hardware } = adapters;
  const historyEntry = buildHistoryEntry({
    activeSector: snapshot.activeSector,
    source: snapshot.source,
    reason,
    startTs: snapshot.startTs,
    plannedEndTs: snapshot.endTs,
    endTs: now,
    liters,
  });
  const shouldClearQueue = reason !== STOP_REASON.TIMEOUT;
  const pendingQueueLength = reason === STOP_REASON.TIMEOUT
    ? Math.max(snapshot.queue.length, 0)
    : 0;
  const shouldTurnOffManual = reason !== STOP_REASON.TIMEOUT || pendingQueueLength === 0;
  const sectorEndMessage = reason === STOP_REASON.TIMEOUT
    ? `Finalizado sector ${snapshot.activeSector}: ${liters.toFixed(1)} L`
    : `Detenido sector ${snapshot.activeSector}: ${liters.toFixed(1)} L (${reason})`;
  const uiMessage = reason === STOP_REASON.TIMEOUT
    ? `Finalizado S${snapshot.activeSector}: ${liters.toFixed(1)} L`
    : `Detenido S${snapshot.activeSector}: ${liters.toFixed(1)} L (${reason})`;
  const manualUpdate = {
    remaining: 0,
    info: uiMessage,
  };

  if (shouldTurnOffManual) {
    manualUpdate.onoff = false;
  }

  return {
    type: 'stop',
    dryRun: stateStore.dryRun,
    reason,
    historyEntry,
    steps: [
      hardware.planStopAllRelays(),
      ...(shouldClearQueue ? [stateStore.planClearQueue()] : []),
      stateStore.planAppendHistory(historyEntry),
      stateStore.planEmitHistoryTrigger(historyEntry.id),
      stateStore.planSetValues({
        state: 'IDLE',
        activeSector: 0,
        endTs: 0,
        stopReason: reason,
      }),
      stateStore.planEmitSectorEvent('sectorEnd', sectorEndMessage, {
        sector: snapshot.activeSector,
        source: snapshot.source,
        reason,
        liters,
        duration: historyEntry.durationRealMin,
      }),
    ],
    failurePlan: buildRelayFailurePlan({ snapshot, stateStore }),
  };
}

function buildForceIdlePlan({
  snapshot,
  reason,
  stopRelays = true,
  adapters = createAdapters(),
}) {
  const { stateStore, hardware } = adapters;
  const hardwareSteps = stopRelays ? [hardware.planStopAllRelays()] : [];

  return {
    type: 'forceIdle',
    dryRun: stateStore.dryRun,
    reason,
    steps: [
      ...hardwareSteps,
      stateStore.planClearQueue(),
      stateStore.planSetValues({
        state: 'IDLE',
        activeSector: 0,
        endTs: 0,
        stopReason: reason,
      }),
    ],
    failurePlan: stopRelays ? buildRelayFailurePlan({ snapshot, stateStore }) : [],
  };
}

function buildBusyPlan({
  snapshot,
  source,
  message = 'Ya hay un riego en curso',
  adapters = createAdapters(),
}) {
  return {
    type: 'busy',
    dryRun: adapters.stateStore.dryRun,
    accepted: false,
    reason: 'BUSY',
    message,
    source,
    steps: [],
    failurePlan: [],
  };
}

function buildStartQueuedItemPlan({
  snapshot,
  queue,
  now,
  adapters = createAdapters(),
}) {
  const { stateStore, hardware } = adapters;
  const [item, ...remainingQueue] = queue;
  const endTs = now + item.duration * 60 * 1000;

  return {
    type: 'startQueuedItem',
    dryRun: stateStore.dryRun,
    accepted: true,
    item: clone(item),
    remainingQueue: clone(remainingQueue),
    steps: [
      stateStore.planSetQueue(queue),
      stateStore.planSetQueue(remainingQueue),
      ...hardware.planStartSector(item.sector),
      stateStore.planSetValues({
        state: 'RUNNING',
        activeSector: item.sector,
        startTs: now,
        endTs,
        source: item.source || 'MANUAL',
        stopReason: STOP_REASON.NONE,
      }),
      stateStore.planEmitSectorEvent(
        'sectorStart',
        `Iniciado sector ${item.sector}: ${item.duration} min (${item.source || 'MANUAL'})`,
        {
          sector: item.sector,
          duration: item.duration,
          source: item.source || 'MANUAL',
        },
      ),
    ],
    failurePlan: [
      stateStore.planClearQueue(),
      stateStore.planSetValues({
        state: 'ERROR',
        activeSector: 0,
        endTs: 0,
        stopReason: STOP_REASON.ERROR,
      }),
    ],
  };
}

function buildManualStartPreview({
  snapshot,
  input,
  now,
  adapters = createAdapters(),
}) {
  if (snapshot.state === 'RUNNING' || snapshot.anyRelayOn) {
    return buildBusyPlan({
      snapshot,
      source: 'MANUAL',
      adapters,
    });
  }

  const queue = buildManualQueue(input, {
    now,
    idSuffix: 'manual-preview',
  });

  return buildStartQueuedItemPlan({
    snapshot,
    queue,
    now,
    adapters,
  });
}

function buildProgramStartPreview({
  snapshot,
  request,
  now,
  adapters = createAdapters(),
}) {
  if (snapshot.state === 'RUNNING' || snapshot.anyRelayOn) {
    return buildBusyPlan({
      snapshot,
      source: snapshot.source,
      message: `Solicitud ${request?.requestId || 'desconocida'} ignorada: ya hay un riego en curso`,
      adapters,
    });
  }

  const queue = buildSchedulerQueue(request, {
    now,
  });

  return buildStartQueuedItemPlan({
    snapshot,
    queue,
    now,
    adapters,
  });
}

function buildTickDryRunTransaction({
  snapshot,
  tickDecision,
  now,
  liters = 0,
  adapters = createAdapters(),
}) {
  switch (tickDecision.decision) {
    case TICK_DECISION.STOP_TIMEOUT:
    case TICK_DECISION.STOP_WATCHDOG:
    case TICK_DECISION.STALE_RUN_ABORT:
      return buildStopPlan({
        snapshot,
        reason: tickDecision.reason,
        now,
        liters,
        adapters,
      });

    case TICK_DECISION.FORCE_IDLE_NONE:
      return buildForceIdlePlan({
        snapshot,
        reason: tickDecision.reason,
        stopRelays: false,
        adapters,
      });

    case TICK_DECISION.FORCE_IDLE_WATCHDOG:
      return buildForceIdlePlan({
        snapshot,
        reason: tickDecision.reason,
        stopRelays: true,
        adapters,
      });

    case TICK_DECISION.UPDATE_RUNNING:
      return {
        type: 'updateRunning',
        dryRun: adapters.stateStore.dryRun,
        reason: null,
        steps: [],
        failurePlan: [],
      };

    default:
      return {
        type: 'noop',
        dryRun: adapters.stateStore.dryRun,
        reason: null,
        steps: [],
        failurePlan: [],
      };
  }
}

module.exports = {
  EngineStateStore,
  EspHomeIrrigationHardwareAdapter,
  createAdapters,
  buildStopPlan,
  buildForceIdlePlan,
  buildBusyPlan,
  buildStartQueuedItemPlan,
  buildManualStartPreview,
  buildProgramStartPreview,
  buildTickDryRunTransaction,
};
