'use strict';

const Homey = require('homey');

module.exports = class IrrigationSchedulerDriver extends Homey.Driver {
  async onInit() {
    this.log('Irrigation Scheduler driver initialized');
  }

  async onPairListDevices() {
    return [
      {
        name: this.homey.__('driver.scheduler.name'),
        data: {
          id: 'irrigation_scheduler',
        },
      },
    ];
  }
};
