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

function runtimeLiters(sector, fallback = 0) {
  return {
    runtimeValue: 'liters',
    sector: Number(sector),
    fallback: Number(fallback) || 0,
  };
}

function sectorEndMessageTemplate({ sector, reason, timeout, fallbackLiters = 0 }) {
  return {
    runtimeTemplate: 'sectorEndMessage',
    sector: Number(sector),
    reason,
    timeout: Boolean(timeout),
    fallbackLiters: Number(fallbackLiters) || 0,
  };
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

  planReadLiters(sector, { settleMs = 2000, retryMs = 3000, retryIntervalMs = 500 } = {}) {
    return {
      adapter: 'EspHomeIrrigationHardwareAdapter',
      action: 'readLiters',
      dryRun: this.dryRun,
      sector: Number(sector),
      settleMs: Number(settleMs) || 0,
      retryMs: Number(retryMs) || 0,
      retryIntervalMs: Number(retryIntervalMs) || 0,
    };
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
    stateStore.planSetValues({
      state: 'ERROR',
      activeSector: snapshot.activeSector,
      stopReason: STOP_REASON.ERROR,
      interruption: snapshot.interruption || {
        version: 1,
        status: 'AWAITING_CONTROLLER',
        sector: snapshot.activeSector,
        source: snapshot.source,
        startTs: snapshot.startTs,
        plannedEndTs: snapshot.endTs,
        detectedTs: Date.now(),
        reason: 'relay_write_failed',
        message: `Riego interrumpido: no se ha confirmado el cierre de la electrovalvula del sector ${snapshot.activeSector}`,
        pendingQueue: clone(snapshot.queue || []),
        historyEntryId: null,
      },
    }),
  ];
}

function buildInterruptionPlan({
  snapshot,
  reason = 'raw_unavailable',
  now,
  message,
  adapters = createAdapters(),
}) {
  const { stateStore } = adapters;
  const sector = Number(snapshot.activeSector) || 0;

  return {
    type: 'interruptForRecovery',
    dryRun: stateStore.dryRun,
    reason,
    accepted: true,
    steps: [
      stateStore.planSetValues({
        state: 'ERROR',
        activeSector: sector,
        stopReason: STOP_REASON.WATCHDOG,
        interruption: {
          version: 1,
          status: 'AWAITING_CONTROLLER',
          sector,
          source: snapshot.source,
          startTs: snapshot.startTs,
          plannedEndTs: snapshot.endTs,
          detectedTs: now,
          reason,
          message: message || `Conexion perdida durante el riego: comprobar la electrovalvula del sector ${sector}`,
          pendingQueue: clone(snapshot.queue || []),
          historyEntryId: null,
        },
      }),
    ],
    failurePlan: [],
  };
}

function buildInterruptionRelayClosePlan({
  snapshot,
  now,
  adapters = createAdapters(),
}) {
  const { stateStore, hardware } = adapters;
  const interruption = snapshot.interruption || {};

  return {
    type: 'closeInterruptedRelays',
    dryRun: stateStore.dryRun,
    reason: STOP_REASON.WATCHDOG,
    accepted: true,
    steps: [
      hardware.planStopAllRelays(),
      stateStore.planSetValues({
        interruption: {
          ...interruption,
          status: 'CLOSING_RELAYS',
          lastCloseAttemptTs: now,
        },
      }),
    ],
    failurePlan: [
      stateStore.planSetValues({
        state: 'ERROR',
        activeSector: Number(interruption.sector || snapshot.activeSector) || 0,
        stopReason: STOP_REASON.ERROR,
        interruption: {
          ...interruption,
          status: 'AWAITING_CONTROLLER',
          lastCloseAttemptTs: now,
        },
      }),
    ],
  };
}

function buildInterruptionReadyPlan({
  snapshot,
  now,
  liters = 0,
  adapters = createAdapters(),
}) {
  const { stateStore } = adapters;
  const interruption = snapshot.interruption || {};
  const sector = Number(interruption.sector || snapshot.activeSector) || 0;
  const shouldAppendHistory = sector >= 1
    && sector <= 6
    && !interruption.historyEntryId;
  const historyEntry = shouldAppendHistory
    ? buildHistoryEntry({
      activeSector: sector,
      source: interruption.source || snapshot.source,
      reason: STOP_REASON.WATCHDOG,
      startTs: Number(interruption.startTs || snapshot.startTs) || 0,
      plannedEndTs: Number(interruption.plannedEndTs || snapshot.endTs) || 0,
      endTs: now,
      liters,
    })
    : null;
  const nextInterruption = {
    ...interruption,
    status: 'READY_TO_RESUME',
    confirmedRelaysOffTs: now,
    historyEntryId: interruption.historyEntryId || historyEntry?.id || null,
  };

  return {
    type: 'markInterruptionReady',
    dryRun: stateStore.dryRun,
    reason: STOP_REASON.WATCHDOG,
    accepted: true,
    historyEntry,
    steps: [
      ...(historyEntry ? [
        stateStore.planAppendHistory(historyEntry),
        stateStore.planEmitHistoryTrigger(historyEntry.id),
      ] : []),
      stateStore.planSetValues({
        state: 'ERROR',
        activeSector: sector,
        stopReason: STOP_REASON.WATCHDOG,
        interruption: nextInterruption,
      }),
    ],
    failurePlan: [],
  };
}

function buildStopPlan({
  snapshot,
  reason,
  now,
  liters = 0,
  readLitersAfterStop,
  adapters = createAdapters(),
}) {
  const { stateStore, hardware } = adapters;
  const shouldReadLitersAfterStop = readLitersAfterStop ?? !stateStore.dryRun;
  const resolvedLiters = shouldReadLitersAfterStop
    ? runtimeLiters(snapshot.activeSector, liters)
    : liters;
  const historyEntry = buildHistoryEntry({
    activeSector: snapshot.activeSector,
    source: snapshot.source,
    reason,
    startTs: snapshot.startTs,
    plannedEndTs: snapshot.endTs,
    endTs: now,
    liters: resolvedLiters,
  });
  const shouldClearQueue = reason !== STOP_REASON.TIMEOUT;
  const pendingQueueLength = reason === STOP_REASON.TIMEOUT
    ? Math.max(snapshot.queue.length, 0)
    : 0;
  const shouldTurnOffManual = reason !== STOP_REASON.TIMEOUT || pendingQueueLength === 0;
  const sectorEndMessage = shouldReadLitersAfterStop
    ? sectorEndMessageTemplate({
      sector: snapshot.activeSector,
      reason,
      timeout: reason === STOP_REASON.TIMEOUT,
      fallbackLiters: liters,
    })
    : reason === STOP_REASON.TIMEOUT
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
      ...(shouldReadLitersAfterStop ? [hardware.planReadLiters(snapshot.activeSector)] : []),
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
        liters: resolvedLiters,
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
        interruption: null,
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
        state: 'IDLE',
        activeSector: 0,
        startTs: 0,
        endTs: 0,
        stopReason: STOP_REASON.NONE,
        interruption: null,
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
  if (snapshot.interruption || snapshot.state === 'RUNNING' || snapshot.anyRelayOn) {
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
  if (snapshot.interruption || snapshot.state === 'RUNNING' || snapshot.anyRelayOn) {
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

    case TICK_DECISION.RAW_UNAVAILABLE_DURING_RUN:
      return buildInterruptionPlan({
        snapshot,
        reason: 'raw_unavailable',
        now,
        adapters,
      });

    case TICK_DECISION.RECOVERY_READY:
      if (snapshot.anyRelayOn) {
        return buildInterruptionRelayClosePlan({
          snapshot,
          now,
          adapters,
        });
      }
      return buildInterruptionReadyPlan({
        snapshot,
        now,
        liters,
        adapters,
      });

    case TICK_DECISION.RECOVERY_PENDING:
      return {
        type: 'recoveryPending',
        dryRun: adapters.stateStore.dryRun,
        reason: tickDecision.reason,
        steps: [],
        failurePlan: [],
      };

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
  buildInterruptionPlan,
  buildInterruptionRelayClosePlan,
  buildInterruptionReadyPlan,
  buildManualStartPreview,
  buildProgramStartPreview,
  buildTickDryRunTransaction,
};
