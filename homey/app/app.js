'use strict';

const Homey = require('homey');
const ProgramRequestTrigger = require('./lib/program-request-trigger');
const { Scheduler } = require('./lib/scheduler');
const SchedulerConfigStore = require('./lib/scheduler-config-store');

module.exports = class IrrigationSchedulerApp extends Homey.App {
  async onInit() {
    this.configStore = new SchedulerConfigStore(this.homey);
    this.programRequestTrigger = new ProgramRequestTrigger(this.homey);
    this.scheduler = new Scheduler({
      homey: this.homey,
      configStore: this.configStore,
      programRequestTrigger: this.programRequestTrigger,
      timeZone: this.homey.clock.getTimezone(),
    });
    this.scheduler.start();
    this.homey.flow.getConditionCard('notify_sector_start_enabled')
      .registerRunListener(async () => {
        const config = await this.configStore.getConfig();
        return Boolean(config.notifySectorStart);
      });
    this.homey.flow.getConditionCard('notify_sector_end_enabled')
      .registerRunListener(async () => {
        const config = await this.configStore.getConfig();
        return Boolean(config.notifySectorEnd);
      });
    this.log('Irrigation Scheduler app initialized');
  }

  async onUninit() {
    this.scheduler?.stop();
  }

  getConfigStore() {
    return this.configStore;
  }

  requestProgramStart(queue) {
    return this.programRequestTrigger.trigger(queue);
  }
};
