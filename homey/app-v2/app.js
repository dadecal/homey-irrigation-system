'use strict';

const Homey = require('homey');
const { AppStateStore } = require('./lib/app-state-store');
const { DiagnosticsService } = require('./lib/diagnostics-service');
const HistoryService = require('./lib/history-service');
const HomeyApiClient = require('./lib/homey-api-client');
const HealthService = require('./lib/health-service');
const { IrrigationEngineService } = require('./lib/irrigation-engine-service');
const { ManualDeviceService } = require('./lib/manual-device-service');
const { MigrationControlStore } = require('./lib/migration-control-store');
const MigrationReadinessService = require('./lib/migration-readiness-service');
const MotorConfirmationStore = require('./lib/motor-confirmation-store');
const ProgramRequestTrigger = require('./lib/program-request-trigger');
const { RecoveryService } = require('./lib/recovery-service');
const { RecoveryTokenStore } = require('./lib/recovery-token-store');
const { getReleaseInfo } = require('./lib/release-info');
const { Scheduler } = require('./lib/scheduler');
const { SchedulerPreflightService } = require('./lib/scheduler-preflight-service');
const SchedulerConfigStore = require('./lib/scheduler-config-store');
const StatusSyncService = require('./lib/status-sync-service');
const { SystemDeviceProjectionService } = require('./lib/system-device-projection-service');

module.exports = class IrrigationAppV2 extends Homey.App {
  async onInit() {
    this.startedAt = Date.now();
    this.appStateStore = new AppStateStore(this.homey);
    this.configStore = new SchedulerConfigStore(this.homey);
    this.recoveryTokenStore = new RecoveryTokenStore(this.homey);
    this.migrationControlStore = new MigrationControlStore(this.homey);
    this.apiClient = new HomeyApiClient(this.homey);
    this.programRequestTrigger = new ProgramRequestTrigger(this.homey);
    this.motorConfirmationStore = new MotorConfirmationStore({
      homey: this.homey,
      appStateStore: this.appStateStore,
    });
    this.healthTransitionTrigger = this.homey.flow.getTriggerCard('health_transition');
    this.recoveryEventTrigger = this.homey.flow.getTriggerCard('recovery_event');
    this.sectorStartedTrigger = this.homey.flow.getTriggerCard('sector_started');
    this.sectorEndedTrigger = this.homey.flow.getTriggerCard('sector_ended');
    this.healthService = new HealthService({
      homey: this.homey,
      apiClient: this.apiClient,
      appStateStore: this.appStateStore,
      controlStore: this.migrationControlStore,
      healthTransitionTrigger: this.healthTransitionTrigger,
      logger: this,
    });
    this.statusSyncService = new StatusSyncService({
      homey: this.homey,
      apiClient: this.apiClient,
      controlStore: this.migrationControlStore,
      logger: this,
    });
    this.historyService = new HistoryService({
      homey: this.homey,
      apiClient: this.apiClient,
      appStateStore: this.appStateStore,
      controlStore: this.migrationControlStore,
      sectorStartedTrigger: this.sectorStartedTrigger,
      sectorEndedTrigger: this.sectorEndedTrigger,
      logger: this,
    });
    this.recoveryService = new RecoveryService({
      homey: this.homey,
      apiClient: this.apiClient,
      appStateStore: this.appStateStore,
      controlStore: this.migrationControlStore,
      recoveryTokenStore: this.recoveryTokenStore,
      recoveryEventTrigger: this.recoveryEventTrigger,
      logger: this,
    });
    this.irrigationEngineService = new IrrigationEngineService({
      homey: this.homey,
      apiClient: this.apiClient,
      appStateStore: this.appStateStore,
      controlStore: this.migrationControlStore,
      sectorStartedTrigger: this.sectorStartedTrigger,
      sectorEndedTrigger: this.sectorEndedTrigger,
      logger: this,
    });
    this.schedulerPreflightService = new SchedulerPreflightService({
      appStateStore: this.appStateStore,
    });
    this.scheduler = new Scheduler({
      homey: this.homey,
      configStore: this.configStore,
      programRequestTrigger: this.programRequestTrigger,
      motorConfirmationStore: this.motorConfirmationStore,
      controlStore: this.migrationControlStore,
      irrigationEngineService: this.irrigationEngineService,
      preflightService: this.schedulerPreflightService,
      appStateStore: this.appStateStore,
      timeZone: this.homey.clock.getTimezone(),
    });
    this.systemDeviceProjectionService = new SystemDeviceProjectionService({
      homey: this.homey,
      apiClient: this.apiClient,
      appStateStore: this.appStateStore,
      controlStore: this.migrationControlStore,
      logger: this,
    });
    this.manualDeviceService = new ManualDeviceService({
      homey: this.homey,
      apiClient: this.apiClient,
      controlStore: this.migrationControlStore,
      engineService: this.irrigationEngineService,
      appStateStore: this.appStateStore,
      logger: this,
      onCommand: async command => {
        this.systemDeviceProjectionService?.scheduleFastRefresh?.(`manual-${command.action}`);
      },
    });
    this.migrationReadinessService = new MigrationReadinessService({
      configStore: this.configStore,
      controlStore: this.migrationControlStore,
      scheduler: this.scheduler,
      healthService: this.healthService,
      statusSyncService: this.statusSyncService,
      historyService: this.historyService,
      recoveryService: this.recoveryService,
      irrigationEngineService: this.irrigationEngineService,
    });
    this.diagnosticsService = new DiagnosticsService({
      appStateStore: this.appStateStore,
      scheduler: this.scheduler,
      configStore: this.configStore,
      healthService: this.healthService,
      recoveryService: this.recoveryService,
      irrigationEngineService: this.irrigationEngineService,
    });
    this.scheduler.start();
    this.healthService.start();
    this.statusSyncService.start();
    this.historyService.start();
    this.recoveryService.start();
    this.irrigationEngineService.start();
    this.systemDeviceProjectionService.start();
    this.manualDeviceService.start();
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
    this.log('Irrigation System v2 scheduler, health, status sync, history, recovery, engine shadow and native devices initialized');
  }

  async onUninit() {
    this.scheduler?.stop();
    this.healthService?.stop();
    this.statusSyncService?.stop();
    this.historyService?.stop();
    this.recoveryService?.stop();
    this.irrigationEngineService?.stop();
    this.systemDeviceProjectionService?.stop();
    this.manualDeviceService?.stop();
  }

  getConfigStore() {
    return this.configStore;
  }

  getAppStateStore() {
    return this.appStateStore;
  }

  async getStatus() {
    const scheduler = await this.scheduler.status();
    return {
      status: 'READY',
      mode: scheduler.mode,
      generation: 'branch2',
      message: scheduler.canEmitProgramRequests
        ? 'Rama 2 Scheduler activo. Entrega solicitudes al motor segun el modo activo.'
        : 'Rama 2 Scheduler en sombra. No emite solicitudes de riego.',
      startedAt: this.startedAt || 0,
      release: getReleaseInfo(),
      scheduler,
    };
  }

  getRelease() {
    return getReleaseInfo();
  }

  getHealthService() {
    return this.healthService;
  }

  getStatusSyncService() {
    return this.statusSyncService;
  }

  getHistoryService() {
    return this.historyService;
  }

  registerHistoryDevice(device) {
    return this.historyService?.registerNativeDevice(device);
  }

  unregisterHistoryDevice(device) {
    this.historyService?.unregisterNativeDevice(device);
  }

  getRecoveryService() {
    return this.recoveryService;
  }

  getRecoveryTokenStore() {
    return this.recoveryTokenStore;
  }

  getIrrigationEngineService() {
    return this.irrigationEngineService;
  }

  getSystemDeviceProjectionService() {
    return this.systemDeviceProjectionService;
  }

  getManualDeviceService() {
    return this.manualDeviceService;
  }

  registerSystemDevice(device) {
    return this.systemDeviceProjectionService?.registerDevice(device);
  }

  unregisterSystemDevice(device) {
    this.systemDeviceProjectionService?.unregisterDevice(device);
  }

  registerManualDevice(device) {
    return this.manualDeviceService?.registerDevice(device);
  }

  unregisterManualDevice(device) {
    this.manualDeviceService?.unregisterDevice(device);
  }

  getMigrationReadinessService() {
    return this.migrationReadinessService;
  }

  getMigrationControlStore() {
    return this.migrationControlStore;
  }

  getDiagnosticsService() {
    return this.diagnosticsService;
  }

  getScheduler() {
    return this.scheduler;
  }
};
