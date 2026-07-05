'use strict';

const { SETTING, STATUS, RAIN_DELAY_HOURS } = require('./constants');
const { createDefaultConfig } = require('./default-config');
const { calculateNextRun } = require('./next-run-calculator');
const { validateSchedulerConfig } = require('./scheduler-config-validator');

class SchedulerConfigStore {
  constructor(homey) {
    this.settings = homey.settings;
  }

  async getConfig() {
    const stored = this.settings.get(SETTING.config);

    if (!stored) {
      return createDefaultConfig();
    }

    try {
      const result = validateSchedulerConfig(stored, createDefaultConfig());
      return result.config;
    } catch (error) {
      return createDefaultConfig();
    }
  }

  async saveConfig(input) {
    const current = await this.getConfig();
    const result = validateSchedulerConfig(input, current);

    if (!result.valid) {
      const error = new Error(result.errors.join('; '));
      error.statusCode = 400;
      throw error;
    }

    result.config.updatedTs = Date.now();
    this.settings.set(SETTING.config, result.config);
    return this.updateProjection(result.config);
  }

  async getStatus() {
    const config = await this.getConfig();
    return this.updateProjection(config);
  }

  async setRainDelay(hours) {
    if (!RAIN_DELAY_HOURS.includes(hours)) {
      const error = new Error('Rain Delay debe ser 24, 48 o 72 horas');
      error.statusCode = 400;
      throw error;
    }

    const config = await this.getConfig();
    return this.saveConfig({
      ...config,
      rainDelayUntil: Date.now() + hours * 60 * 60 * 1000,
    });
  }

  async clearRainDelay() {
    const config = await this.getConfig();
    return this.saveConfig({
      ...config,
      rainDelayUntil: 0,
    });
  }

  async markRunDate(runDate) {
    const config = await this.getConfig();
    const updated = {
      ...config,
      lastRunDate: runDate,
    };
    this.settings.set(SETTING.config, updated);
    return updated;
  }

  async updateProjection(config) {
    const projection = calculateNextRun(config);

    return {
      config,
      ...projection,
    };
  }
}

module.exports = SchedulerConfigStore;
