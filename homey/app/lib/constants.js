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

const RELEASE = {
  component: 'homey-app',
  version: '0.1.0',
  provides: {
    schedulerApi: {
      name: 'irrigation-scheduler-api',
      version: '1.0.0',
    },
  },
  requires: {
    hardwareApi: {
      name: 'irrigation-hw-api',
      range: '>=1.0.0 <2.0.0',
    },
    scriptsApi: {
      name: 'irrigation-scripts-api',
      range: '>=1.0.0 <2.0.0',
    },
  },
};

module.exports = {
  SETTING,
  STATUS,
  RAIN_DELAY_HOURS,
  RELEASE,
};
