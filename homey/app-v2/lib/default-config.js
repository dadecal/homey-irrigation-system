'use strict';

function createDefaultConfig() {
  return {
    version: 1,
    enabled: false,
    notifySectorStart: false,
    notifySectorEnd: false,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: null,
    preflightBlock: null,
    updatedTs: 0,
  };
}

module.exports = {
  createDefaultConfig,
};
