'use strict';

const STATE = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
};

const STOP_REASON = {
  NONE: 'none',
  MANUAL: 'manual',
  TIMEOUT: 'timeout',
  WATCHDOG: 'watchdog',
  ERROR: 'error',
};

const SOURCE = {
  MANUAL: 'MANUAL',
  SCHEDULER: 'SCHEDULER',
};

const TICK_DECISION = {
  FORCE_IDLE_NONE: 'FORCE_IDLE_NONE',
  FORCE_IDLE_WATCHDOG: 'FORCE_IDLE_WATCHDOG',
  STALE_RUN_ABORT: 'STALE_RUN_ABORT',
  WATCHDOG_GRACE: 'WATCHDOG_GRACE',
  STOP_WATCHDOG: 'STOP_WATCHDOG',
  STOP_TIMEOUT: 'STOP_TIMEOUT',
  UPDATE_RUNNING: 'UPDATE_RUNNING',
  START_PENDING_QUEUE: 'START_PENDING_QUEUE',
};

const MAX_DURATION_MIN = 30;
const START_WATCHDOG_GRACE_MS = 15 * 1000;
const STALE_RUN_ABORT_MS = 2 * 60 * 1000;
const MAX_QUEUE_LENGTH = 6;

function validateStart(sector, duration) {
  if (!Number.isInteger(sector) || sector < 1 || sector > 6) {
    return `Sector no valido: ${sector}`;
  }

  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_MIN) {
    return `Duracion no valida: ${duration} min`;
  }

  return null;
}

function normalizeQueueItem(item, index = 0, sectors = null) {
  if (!item || typeof item !== 'object') {
    throw new Error(`queue.${index} no valido`);
  }

  const sector = Number(item.sector);
  const duration = Number(item.duration);
  const validationError = validateStart(sector, duration);
  if (validationError) {
    throw new Error(validationError);
  }

  if (sectors) {
    if (sectors.has(sector)) {
      throw new Error(`El sector ${sector} aparece mas de una vez`);
    }
    sectors.add(sector);
  }

  return { sector, duration };
}

function normalizeProgramRequest(value) {
  const request = typeof value === 'string' ? JSON.parse(value) : value;

  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Solicitud de programa no valida');
  }

  if (request.version !== 1) {
    throw new Error(`Version de solicitud no soportada: ${request.version}`);
  }

  if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
    throw new Error('requestId no valido');
  }

  if (!Number.isInteger(request.requestedAt) || request.requestedAt <= 0) {
    throw new Error('requestedAt no valido');
  }

  if (request.source !== SOURCE.SCHEDULER) {
    throw new Error(`Origen de solicitud no soportado: ${request.source}`);
  }

  if (!Array.isArray(request.queue) || request.queue.length < 1 || request.queue.length > MAX_QUEUE_LENGTH) {
    throw new Error('La solicitud debe contener entre 1 y 6 sectores');
  }

  const sectors = new Set();
  const queue = request.queue.map((item, index) => normalizeQueueItem(item, index, sectors));

  return {
    version: request.version,
    requestId: request.requestId.trim(),
    requestedAt: request.requestedAt,
    source: request.source,
    queue,
  };
}

function createQueueItem({
  sector,
  duration,
  source = SOURCE.MANUAL,
  description = 'Riego manual',
}, {
  now = Date.now(),
  idSuffix = 'contract',
} = {}) {
  const normalized = normalizeQueueItem({ sector, duration });

  return {
    id: `${now}-${idSuffix}`,
    createdTs: now,
    sector: normalized.sector,
    duration: normalized.duration,
    source,
    description,
  };
}

function buildManualQueue(input, options = {}) {
  return [createQueueItem({
    sector: input?.sector,
    duration: input?.duration,
    source: SOURCE.MANUAL,
    description: 'Riego manual',
  }, options)];
}

function buildSchedulerQueue(request, options = {}) {
  const normalized = normalizeProgramRequest(request);
  return normalized.queue.map((item, index) => createQueueItem({
    sector: item.sector,
    duration: item.duration,
    source: normalized.source,
    description: `Programa automatico ${normalized.requestId}`,
  }, {
    ...options,
    idSuffix: `${options.idSuffix || normalized.requestId}-${index + 1}`,
  }));
}

function remainingMinutes(endTs, now = Date.now()) {
  const remainingMs = Math.max(Number(endTs) - now, 0);
  return Math.ceil(remainingMs / 60000);
}

function decideTick({
  state,
  endTs,
  activeSector,
  anyRelayOn,
  startTs,
  now = Date.now(),
}) {
  const normalizedEndTs = Number(endTs) || 0;
  const normalizedStartTs = Number(startTs) || 0;
  const normalizedActiveSector = Number(activeSector) || 0;

  if (state === STATE.RUNNING && normalizedEndTs > 0 && now - normalizedEndTs > STALE_RUN_ABORT_MS) {
    return {
      decision: TICK_DECISION.STALE_RUN_ABORT,
      reason: STOP_REASON.WATCHDOG,
      activeSector: normalizedActiveSector,
      overdueMs: now - normalizedEndTs,
    };
  }

  if (state !== STATE.RUNNING) {
    return anyRelayOn
      ? { decision: TICK_DECISION.FORCE_IDLE_WATCHDOG, reason: STOP_REASON.WATCHDOG }
      : { decision: TICK_DECISION.FORCE_IDLE_NONE, reason: STOP_REASON.NONE };
  }

  if (!anyRelayOn) {
    const ageMs = now - normalizedStartTs;
    if (ageMs < START_WATCHDOG_GRACE_MS) {
      return {
        decision: TICK_DECISION.WATCHDOG_GRACE,
        activeSector: normalizedActiveSector,
        ageMs,
      };
    }

    return {
      decision: TICK_DECISION.STOP_WATCHDOG,
      reason: STOP_REASON.WATCHDOG,
      activeSector: normalizedActiveSector,
    };
  }

  const remaining = remainingMinutes(normalizedEndTs, now);
  if (remaining <= 0) {
    return {
      decision: TICK_DECISION.STOP_TIMEOUT,
      reason: STOP_REASON.TIMEOUT,
      activeSector: normalizedActiveSector,
    };
  }

  return {
    decision: TICK_DECISION.UPDATE_RUNNING,
    activeSector: normalizedActiveSector,
    remaining,
  };
}

function buildHistoryEntry({
  activeSector,
  source,
  reason,
  startTs,
  plannedEndTs,
  endTs,
  liters = 0,
}) {
  const plannedDurationMin = startTs > 0 && plannedEndTs > startTs
    ? Math.round((plannedEndTs - startTs) / 60000)
    : 0;

  const durationRealMin = startTs > 0
    ? Math.round((endTs - startTs) / 60000)
    : 0;

  return {
    id: `${endTs}-${activeSector}`,
    sector: activeSector,
    source,
    reason,
    startTs,
    plannedEndTs,
    endTs,
    plannedDurationMin,
    durationRealMin,
    liters,
  };
}

module.exports = {
  STATE,
  STOP_REASON,
  SOURCE,
  TICK_DECISION,
  MAX_DURATION_MIN,
  START_WATCHDOG_GRACE_MS,
  STALE_RUN_ABORT_MS,
  validateStart,
  normalizeProgramRequest,
  createQueueItem,
  buildManualQueue,
  buildSchedulerQueue,
  remainingMinutes,
  decideTick,
  buildHistoryEntry,
};
