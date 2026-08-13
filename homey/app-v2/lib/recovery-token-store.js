'use strict';

const { SETTING } = require('./constants');

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function maskToken(token) {
  const normalized = normalizeToken(token);
  if (!normalized) {
    return null;
  }

  const visible = normalized.slice(-4);
  return `***${visible}`;
}

class RecoveryTokenStore {
  constructor(homey) {
    this.settings = homey.settings;
  }

  async getToken() {
    return normalizeToken(this.settings.get(SETTING.recoveryControllerToken));
  }

  async getStatus() {
    const token = await this.getToken();
    return {
      configured: Boolean(token),
      masked: maskToken(token),
    };
  }

  async setToken(token) {
    const normalized = normalizeToken(token);
    if (!normalized) {
      const error = new Error('Token vacio');
      error.statusCode = 400;
      throw error;
    }

    this.settings.set(SETTING.recoveryControllerToken, normalized);
    return this.getStatus();
  }

  async clearToken() {
    this.settings.unset(SETTING.recoveryControllerToken);
    return this.getStatus();
  }
}

module.exports = {
  RecoveryTokenStore,
  maskToken,
  normalizeToken,
};
