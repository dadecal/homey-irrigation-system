'use strict';

const Homey = require('homey');

module.exports = class IrrigationHistoryDriver extends Homey.Driver {
  async onInit() {
    this.log('Irrigation History driver initialized');
  }

  async onPairListDevices() {
    return [
      {
        name: 'Historico de Riego v2',
        data: {
          id: 'irrigation_history',
        },
      },
    ];
  }
};
