'use strict';

const Homey = require('homey');
const HomeyApiClient = require('./lib/homey-api-client');
const LogicVariableStore = require('./lib/logic-variable-store');
const MotorConfirmationStore = require('./lib/motor-confirmation-store');
const ProgramRequestTrigger = require('./lib/program-request-trigger');
const { RecoveryService } = require('./lib/recovery-service');
const { Scheduler } = require('./lib/scheduler');
const SchedulerConfigStore = require('./lib/scheduler-config-store');

module.exports = class IrrigationSchedulerApp extends Homey.App {
  async onInit() {
    this.apiClient = new HomeyApiClient(this.homey);
    this.logicStore = new LogicVariableStore({
      homey: this.homey,
      apiClient: this.apiClient,
    });
    this.configStore = new SchedulerConfigStore(this.homey);
    this.programRequestTrigger = new ProgramRequestTrigger(this.homey);
    this.motorConfirmationStore = new MotorConfirmationStore(this.homey, this.apiClient);
    this.scheduler = new Scheduler({
      homey: this.homey,
      configStore: this.configStore,
      programRequestTrigger: this.programRequestTrigger,
      motorConfirmationStore: this.motorConfirmationStore,
      timeZone: this.homey.clock.getTimezone(),
    });
    this.scheduler.start();
    this.recoveryService = new RecoveryService({
      homey: this.homey,
      apiClient: this.apiClient,
      logicStore: this.logicStore,
    });
    this.recoveryService.start();
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
    this.recoveryService?.stop();
  }

  getConfigStore() {
    return this.configStore;
  }

  async getSchedulerStatus() {
    const status = await this.configStore.getStatus();
    const diagnostic = this.scheduler?.getDiagnostic?.();

    if (!diagnostic?.lastError) {
      return status;
    }

    return {
      ...status,
      status: 'ERROR',
      message: diagnostic.lastError.message,
      error: diagnostic.lastError,
    };
  }

  requestProgramStart(queue) {
    return this.programRequestTrigger.trigger(queue);
  }

  getRecoveryService() {
    return this.recoveryService;
  }
};
