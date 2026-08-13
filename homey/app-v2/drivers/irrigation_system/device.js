'use strict';

const Homey = require('homey');

module.exports = class IrrigationSystemDevice extends Homey.Device {
  async onInit() {
    this.log('Irrigation System device initialized');
    await this.homey.app.registerSystemDevice?.(this);
  }

  async onDeleted() {
    this.homey.app.unregisterSystemDevice?.(this);
  }
};
