'use strict';

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
    const store = getStore(homey);
    return store.getStatus();
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
};
