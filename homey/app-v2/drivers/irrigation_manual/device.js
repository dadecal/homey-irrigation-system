'use strict';

const Homey = require('homey');

module.exports = class IrrigationManualDevice extends Homey.Device {
  async onInit() {
    this.syncingFromNativeProjection = false;
    this.log('Irrigation Manual device initialized');

    this.registerCapabilityListener('irrigation_manual_sector', async value => {
      if (this.syncingFromNativeProjection) return;
      await this.homey.app.getManualDeviceService()?.setSector(value);
    });

    this.registerCapabilityListener('irrigation_manual_duration', async value => {
      if (this.syncingFromNativeProjection) return;
      await this.homey.app.getManualDeviceService()?.setDuration(value);
    });

    this.registerCapabilityListener('onoff', async value => {
      if (this.syncingFromNativeProjection) return;
      await this.homey.app.getManualDeviceService()?.setOnOff(value);
    });

    await this.homey.app.registerManualDevice?.(this);
  }

  async applyNativeProjection(values) {
    this.syncingFromNativeProjection = true;
    try {
      for (const [capability, value] of Object.entries(values)) {
        if (!this.hasCapability(capability)) continue;
        if (value === null || value === undefined) continue;
        if (this.getCapabilityValue(capability) === value) continue;
        await this.setCapabilityValue(capability, value);
      }
    } finally {
      this.syncingFromNativeProjection = false;
    }
  }

  async onDeleted() {
    this.homey.app.unregisterManualDevice?.(this);
  }
};
