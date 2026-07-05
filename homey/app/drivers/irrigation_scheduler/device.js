'use strict';

const Homey = require('homey');

module.exports = class IrrigationSchedulerDevice extends Homey.Device {
  async onInit() {
    this.log('Irrigation Scheduler device initialized');
    await this.syncOnOffCapability();

    this.registerCapabilityListener('onoff', async value => {
      const store = this.homey.app.getConfigStore();
      const { config } = await store.saveConfig({
        ...(await store.getConfig()),
        enabled: value,
      });

      return config.enabled;
    });
  }

  async syncOnOffCapability() {
    const store = this.homey.app.getConfigStore();
    const config = await store.getConfig();

    if (this.hasCapability('onoff')) {
      await this.setCapabilityValue('onoff', Boolean(config.enabled)).catch(this.error);
    }
  }
};
