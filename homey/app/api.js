'use strict';

const { RELEASE } = require('./lib/constants');

function getStore(homey) {
  return homey.app.getConfigStore();
}

module.exports = {
  async getConfig({ homey }) {
    const store = getStore(homey);
    return store.getConfig();
  },

  async putConfig({ homey, body }) {
    const store = getStore(homey);
    return store.saveConfig(body || {});
  },

  async getStatus({ homey }) {
    if (typeof homey.app.getSchedulerStatus === 'function') {
      return homey.app.getSchedulerStatus();
    }

    return getStore(homey).getStatus();
  },

  async getRelease() {
    return RELEASE;
  },

  async setRainDelay({ homey, body }) {
    const store = getStore(homey);
    const hours = Number(body?.hours);
    return store.setRainDelay(hours);
  },

  async clearRainDelay({ homey }) {
    const store = getStore(homey);
    return store.clearRainDelay();
  },

  async getRecoveryStatus({ homey }) {
    return homey.app.getRecoveryService().status();
  },

  async checkRecovery({ homey }) {
    return homey.app.getRecoveryService().check();
  },
};
