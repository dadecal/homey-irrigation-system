'use strict';

const Homey = require('homey');

module.exports = class IrrigationHistoryDevice extends Homey.Device {
  async onInit() {
    this.log('Irrigation History device initialized');
    await this.homey.app.registerHistoryDevice?.(this);
  }

  async onDeleted() {
    this.homey.app.unregisterHistoryDevice?.(this);
  }
};
