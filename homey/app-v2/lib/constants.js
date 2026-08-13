'use strict';

const SETTING = {
  config: 'schedulerConfigV2',
  appState: 'appStateV2',
  migrationControl: 'migrationControlV2',
  recoveryControllerToken: 'recoveryControllerTokenV2',
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
  generation: 'branch2',
  component: 'homey-app-v2',
  appId: 'com.dadecal.irrigation.v2',
  version: '2.0.9',
  status: 'active',
  provides: {
    appApi: {
      name: 'irrigation-app-api',
      version: '2.0.9',
    },
  },
  requires: {
    hardwareApi: {
      name: 'irrigation-hw-api',
      range: '>=1.0.0 <2.0.0',
    },
  },
};

const MODE = {
  SHADOW: 'SHADOW',
  ACTIVE_COMPAT: 'ACTIVE_COMPAT',
};

const SERVICE = {
  SCHEDULER: 'scheduler',
  HEALTH: 'health',
  STATUS_SYNC: 'statusSync',
  HISTORY: 'history',
  RECOVERY: 'recovery',
  ENGINE: 'engine',
};

module.exports = {
  SETTING,
  STATUS,
  RAIN_DELAY_HOURS,
  RELEASE,
  MODE,
  SERVICE,
};
