'use strict';

const SETTING = {
  config: 'schedulerConfig',
};

const STATUS = {
  DISABLED: 'DISABLED',
  READY: 'READY',
  RAIN_DELAY: 'RAIN_DELAY',
  INVALID_CONFIG: 'INVALID_CONFIG',
  ERROR: 'ERROR',
};

const RAIN_DELAY_HOURS = [24, 48, 72];

module.exports = {
  SETTING,
  STATUS,
  RAIN_DELAY_HOURS,
};
