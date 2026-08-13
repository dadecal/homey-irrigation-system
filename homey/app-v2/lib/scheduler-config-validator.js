'use strict';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }

  return Math.round(number);
}

function normalizePendingRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const requestId = typeof value.requestId === 'string' ? value.requestId.trim() : '';
  const runDate = typeof value.runDate === 'string' ? value.runDate.trim() : '';
  const requestedAt = normalizeInteger(value.requestedAt);
  const createdTs = normalizeInteger(value.createdTs);

  if (!requestId || !runDate || !requestedAt || !createdTs) {
    return null;
  }

  return {
    requestId,
    runDate,
    requestedAt: Math.max(requestedAt, 0),
    createdTs: Math.max(createdTs, 0),
  };
}

function normalizePreflightBlock(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const runDate = typeof value.runDate === 'string' ? value.runDate.trim() : '';
  const firstBlockedTs = normalizeInteger(value.firstBlockedTs);
  const lastBlockedTs = normalizeInteger(value.lastBlockedTs);
  const attempts = normalizeInteger(value.attempts);
  const code = typeof value.code === 'string' ? value.code.trim() : '';
  const message = typeof value.message === 'string' ? value.message.trim() : '';

  if (!runDate || !firstBlockedTs || !lastBlockedTs || !code || !message) {
    return null;
  }

  return {
    runDate,
    firstBlockedTs: Math.max(firstBlockedTs, 0),
    lastBlockedTs: Math.max(lastBlockedTs, 0),
    attempts: Math.max(attempts || 0, 0),
    code,
    message,
  };
}

function validateSchedulerConfig(input, baseConfig) {
  const errors = [];
  const config = {
    ...baseConfig,
    ...input,
    sectorDurations: {
      ...baseConfig.sectorDurations,
      ...(input?.sectorDurations || {}),
    },
  };

  config.version = 1;
  config.enabled = normalizeBoolean(config.enabled);
  config.notifySectorStart = normalizeBoolean(config.notifySectorStart);
  config.notifySectorEnd = normalizeBoolean(config.notifySectorEnd);

  if (typeof config.startTime !== 'string' || !TIME_PATTERN.test(config.startTime)) {
    errors.push('startTime debe tener formato HH:mm');
  }

  config.intervalDays = normalizeInteger(config.intervalDays);
  if (!Number.isInteger(config.intervalDays) || config.intervalDays < 1 || config.intervalDays > 30) {
    errors.push('intervalDays debe estar entre 1 y 30');
  }

  const normalizedDurations = {};
  for (let sector = 1; sector <= 6; sector += 1) {
    const duration = normalizeInteger(config.sectorDurations[String(sector)] ?? config.sectorDurations[sector]);
    if (!Number.isInteger(duration) || duration < 0 || duration > 30) {
      errors.push(`sectorDurations.${sector} debe estar entre 0 y 30`);
      normalizedDurations[String(sector)] = 0;
      continue;
    }

    normalizedDurations[String(sector)] = duration;
  }

  config.sectorDurations = normalizedDurations;
  config.rainDelayUntil = Math.max(normalizeInteger(config.rainDelayUntil) || 0, 0);

  if (config.lastRunDate !== null && typeof config.lastRunDate !== 'string') {
    errors.push('lastRunDate debe ser string o null');
    config.lastRunDate = null;
  }

  config.pendingRequest = normalizePendingRequest(config.pendingRequest);
  config.preflightBlock = normalizePreflightBlock(config.preflightBlock);
  config.updatedTs = Math.max(normalizeInteger(config.updatedTs) || 0, 0);

  return {
    valid: errors.length === 0,
    errors,
    config,
  };
}

module.exports = {
  normalizePreflightBlock,
  validateSchedulerConfig,
};
