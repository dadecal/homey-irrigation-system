'use strict';

const { STATUS } = require('./constants');
const { addDays, getDateKey, toTimestamp } = require('./calendar');

function hasActiveSector(config) {
  return Object.values(config.sectorDurations || {}).some(duration => Number(duration) > 0);
}

function getFirstCandidateDate(config, nowTs, timeZone) {
  if (config.lastRunDate) {
    return addDays(config.lastRunDate, config.intervalDays);
  }

  const anchorTs = config.updatedTs || nowTs;
  const anchorDate = getDateKey(anchorTs, timeZone);
  const anchorStartTs = toTimestamp(anchorDate, config.startTime, timeZone);
  return anchorStartTs > anchorTs
    ? anchorDate
    : addDays(anchorDate, config.intervalDays);
}

function calculateNextRun(config, now = Date.now(), timeZone = 'Europe/Madrid') {
  const nowTs = now instanceof Date ? now.getTime() : now;

  if (!config.enabled) {
    return {
      status: STATUS.DISABLED,
      nextRunTs: 0,
      message: 'Programador desactivado',
    };
  }

  if (!hasActiveSector(config)) {
    return {
      status: STATUS.INVALID_CONFIG,
      nextRunTs: 0,
      message: 'No hay sectores activos',
    };
  }

  const today = getDateKey(nowTs, timeZone);
  let runDate = getFirstCandidateDate(config, nowTs, timeZone);
  let nextRunTs = toTimestamp(runDate, config.startTime, timeZone);

  while (runDate < today || (config.rainDelayUntil && nextRunTs < config.rainDelayUntil)) {
    runDate = addDays(runDate, config.intervalDays);
    nextRunTs = toTimestamp(runDate, config.startTime, timeZone);
  }

  const rainDelayActive = config.rainDelayUntil && config.rainDelayUntil > nowTs;
  const due = !rainDelayActive && runDate === today && nextRunTs <= nowTs;

  return {
    status: rainDelayActive ? STATUS.RAIN_DELAY : STATUS.READY,
    nextRunTs,
    runDate,
    due,
    message: rainDelayActive ? 'Rain Delay activo' : 'Programador listo',
  };
}

module.exports = {
  calculateNextRun,
};
