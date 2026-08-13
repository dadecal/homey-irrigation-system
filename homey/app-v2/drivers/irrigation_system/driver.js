'use strict';

const Homey = require('homey');

module.exports = class IrrigationSystemDriver extends Homey.Driver {
  async onInit() {
    this.log('Irrigation System driver initialized');
  }

  async onPairListDevices() {
    return [
      {
        name: 'Sistema de Riego v2',
        data: {
          id: 'irrigation_system',
        },
      },
    ];
  }
};
