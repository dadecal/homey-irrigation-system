'use strict';

const Homey = require('homey');

module.exports = class IrrigationManualDriver extends Homey.Driver {
  async onInit() {
    this.log('Irrigation Manual driver initialized');
  }

  async onPairListDevices() {
    return [
      {
        name: 'Riego Manual v2',
        data: {
          id: 'irrigation_manual',
        },
      },
    ];
  }
};
