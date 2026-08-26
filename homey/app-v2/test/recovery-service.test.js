'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RecoveryService,
  initialRecoveryState,
  constants,
} = require('../lib/recovery-service');

const RAW_DEVICE_ID = constants.RAW_DEVICE_ID;
const NOW = 1721300000000;

function createAppState(initialRecovery = null, engineState = 'IDLE') {
  return {
    version: 1,
    updatedTs: 0,
    health: null,
    recovery: initialRecovery,
    history: {
      lastProjectedEventId: null,
      lastProjection: null,
    },
    engine: {
      state: engineState,
      activeSector: 0,
      startTs: 0,
      endTs: 0,
      source: 'none',
      stopReason: 'none',
      queue: [],
      history: [],
      lastTickTs: 0,
    },
    events: [],
  };
}

function createService({
  available = true,
  activeRelays = [],
  mode = 'SHADOW',
  engineMode = 'SHADOW',
  engineState = 'IDLE',
  initialRecovery = null,
  apps = {
    'com.ugrbnk.esphome': {
      id: 'com.ugrbnk.esphome',
      name: 'ESPHome Controller',
      version: '1.3.18',
      enabled: true,
    },
  },
  restartApp = async () => {},
  hasScope = null,
  recoveryToken = '',
  privilegedRestartApp = null,
  trigger = null,
  now = () => NOW,
} = {}) {
  const appState = createAppState(initialRecovery, engineState);
  const stateWrites = [];
  const triggerCalls = [];
  const restartCalls = [];
  const api = {
    devices: {
      async getDevice({ id }) {
        assert.equal(id, RAW_DEVICE_ID);
        if (available instanceof Error) throw available;
        const capabilitiesObj = {};
        activeRelays.forEach(sector => {
          const capability = constants.RAW_CAP.relays[sector];
          if (capability) {
            capabilitiesObj[capability] = { value: true };
          }
        });
        return { id, available, capabilitiesObj };
      },
    },
    apps: {
      async getApps() {
        return apps;
      },
      async restartApp(args) {
        restartCalls.push(args);
        return restartApp(args);
      },
    },
  };
  if (hasScope) {
    api.hasScope = hasScope;
  }

  const service = new RecoveryService({
    homey: {
      app: {},
      api: {
        async getLocalUrl() {
          return 'http://homey.local';
        },
      },
      setInterval() {
        return 1;
      },
      clearInterval() {},
    },
    apiClient: {
      async getApi() {
        return api;
      },
    },
    appStateStore: {
      async getState() {
        return appState;
      },
      async setRecovery(recovery) {
        stateWrites.push({ key: 'recovery', value: recovery });
        appState.recovery = recovery;
        return appState;
      },
      async appendEvent(event) {
        stateWrites.push({ key: 'event', value: event });
        appState.events.unshift(event);
        return appState;
      },
    },
    recoveryTokenStore: {
      async getToken() {
        return recoveryToken;
      },
      async getStatus() {
        return {
          configured: Boolean(recoveryToken),
          masked: recoveryToken ? '***test' : null,
        };
      },
    },
    controlStore: {
      async getControl() {
        return {
          services: {
            recovery: mode,
            engine: engineMode,
          },
        };
      },
    },
    recoveryEventTrigger: trigger || {
      async trigger(tokens) {
        triggerCalls.push(tokens);
      },
    },
    now,
    logger: {
      log() {},
      error() {},
    },
  });

  if (privilegedRestartApp) {
    service.getPrivilegedApi = async () => ({
      apps: {
        async restartApp(args) {
          return privilegedRestartApp(args);
        },
      },
    });
  }

  return { service, appState, stateWrites, triggerCalls, restartCalls };
}

test('observes unavailable ESPHome in shadow without persisting or restarting', async () => {
  const { service, stateWrites, triggerCalls, restartCalls } = createService({
    available: false,
  });

  const result = await service.check();

  assert.equal(result.mode, 'SHADOW');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.shadow, true);
  assert.equal(result.failures, 1);
  assert.deepEqual(stateWrites, []);
  assert.deepEqual(triggerCalls, []);
  assert.deepEqual(restartCalls, []);
});

test('tracks shadow failures in memory until it would restart', async () => {
  const { service, stateWrites, restartCalls } = createService({
    available: false,
  });

  await service.check();
  await service.check();
  const third = await service.check();

  assert.equal(third.mode, 'SHADOW');
  assert.equal(third.status, 'WOULD_RESTART');
  assert.equal(third.failures, 3);
  assert.deepEqual(stateWrites, []);
  assert.deepEqual(restartCalls, []);
});

test('restarts ESPHome Controller in ACTIVE_COMPAT after idle threshold', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 2;
  const { service, appState, stateWrites, triggerCalls, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_REQUESTED');
  assert.deepEqual(result.restart, { method: 'appOwnerToken' });
  assert.deepEqual(restartCalls, [{ id: 'com.ugrbnk.esphome' }]);
  assert.equal(appState.recovery.attemptsInIncident, 1);
  assert.equal(appState.recovery.awaitingRecovery, true);
  assert.equal(appState.recovery.events[0].type, 'RESTART_REQUESTED');
  assert.deepEqual(triggerCalls, [{
    status: 'RESTART_REQUESTED',
    message: 'Reinicio automatico 1/3 de ESPHome Controller solicitado',
    attempts: 1,
  }]);
  assert.deepEqual(stateWrites.map(write => write.key), ['recovery']);
});

test('reports whether the app API token has the restart scope', async () => {
  const { service } = createService({
    mode: 'ACTIVE_COMPAT',
    hasScope: scope => scope === constants.RESTART_REQUIRED_SCOPE,
  });

  const result = await service.status();

  assert.equal(result.apiScopes.canInspectScopes, true);
  assert.equal(result.apiScopes.restartRequiredScope, 'homey.app');
  assert.equal(result.apiScopes.restartScopeAvailable, true);
  assert.equal(result.restartSupported, true);
  assert.equal(result.canRestartController, true);
});

test('does not call restartApp when the app API token lacks the restart scope', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 2;
  const { service, appState, triggerCalls, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
    hasScope: () => false,
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_UNAVAILABLE');
  assert.equal(result.reason, 'MISSING_SCOPES');
  assert.deepEqual(restartCalls, []);
  assert.equal(appState.recovery.restartBlockedReason, 'MISSING_SCOPES');
  assert.equal(appState.recovery.events[0].type, 'RESTART_UNAVAILABLE');
  assert.equal(appState.recovery.events[0].message, 'No se puede reiniciar ESPHome Controller automaticamente: el token interno de la app no tiene el scope homey.app');
  assert.deepEqual(triggerCalls, [{
    status: 'RESTART_UNAVAILABLE',
    message: 'No se puede reiniciar ESPHome Controller automaticamente: el token interno de la app no tiene el scope homey.app',
    attempts: 0,
  }]);
});

test('runs a guarded ESPHome Controller restart probe from the app API context', async () => {
  const { service, restartCalls, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    engineMode: 'ACTIVE_COMPAT',
    engineState: 'IDLE',
    hasScope: scope => scope === constants.RESTART_REQUIRED_SCOPE,
  });

  const result = await service.restartControllerProbe({
    confirmNoIrrigationActive: true,
  });

  assert.equal(result.status, 'RESTART_PROBE_REQUESTED');
  assert.deepEqual(result.restart, { method: 'appOwnerToken' });
  assert.deepEqual(restartCalls, [{ id: 'com.ugrbnk.esphome' }]);
  assert.deepEqual(result.activeRelays, []);
  assert.equal(result.apiScopes.restartScopeAvailable, true);
  assert.equal(triggerCalls[0].status, 'RESTART_PROBE_REQUESTED');
});

test('requests guarded ESPHome Controller restart after scheduler command failure', async () => {
  const { service, appState, restartCalls, triggerCalls } = createService({
    available: true,
    mode: 'ACTIVE_COMPAT',
    engineMode: 'ACTIVE_COMPAT',
    engineState: 'IDLE',
    hasScope: scope => scope === constants.RESTART_REQUIRED_SCOPE,
  });

  const result = await service.requestControllerRestartAfterCommandFailure({
    confirmNoIrrigationActive: true,
    nowTs: NOW,
  });

  assert.equal(result.status, 'RESTART_REQUESTED');
  assert.deepEqual(result.restart, { method: 'appOwnerToken' });
  assert.deepEqual(restartCalls, [{ id: 'com.ugrbnk.esphome' }]);
  assert.equal(appState.recovery.attemptsInIncident, 1);
  assert.equal(appState.recovery.awaitingRecovery, true);
  assert.equal(appState.recovery.consecutiveFailures, constants.FAILURE_THRESHOLD_IDLE);
  assert.equal(appState.recovery.events[0].type, 'RESTART_REQUESTED');
  assert.equal(appState.recovery.events[0].reason, 'COMMAND_UNAVAILABLE');
  assert.deepEqual(triggerCalls[0], {
    status: 'RESTART_REQUESTED',
    message: 'Reinicio automatico 1/3 de ESPHome Controller solicitado por fallo de comandos',
    attempts: 1,
  });
});

test('blocks the restart probe when any irrigation relay is still active', async () => {
  const { service, restartCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    engineMode: 'ACTIVE_COMPAT',
    engineState: 'IDLE',
    activeRelays: [4],
    hasScope: scope => scope === constants.RESTART_REQUIRED_SCOPE,
  });

  await assert.rejects(
    () => service.restartControllerProbe({ confirmNoIrrigationActive: true }),
    /reles activos: 4/,
  );
  assert.deepEqual(restartCalls, []);
});

test('uses a configured user token directly instead of trying the app owner token first', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 2;
  const privilegedCalls = [];
  const { service, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
    recoveryToken: 'pat-test-token',
    restartApp: async () => {
      throw new Error('Missing Scopes');
    },
    privilegedRestartApp: async args => {
      privilegedCalls.push(args);
    },
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_REQUESTED');
  assert.deepEqual(restartCalls, []);
  assert.deepEqual(privilegedCalls, [{ id: 'com.ugrbnk.esphome' }]);
  assert.deepEqual(result.restart, {
    method: 'configuredUserToken',
  });
});

test('marks ESPHome Controller restart as unavailable when Homey reports Missing Scopes', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 2;
  const { service, appState, triggerCalls, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
    restartApp: async () => {
      throw new Error('Missing Scopes');
    },
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_UNAVAILABLE');
  assert.deepEqual(restartCalls, [{ id: 'com.ugrbnk.esphome' }]);
  assert.equal(appState.recovery.awaitingRecovery, false);
  assert.equal(appState.recovery.restartBlockedReason, 'MISSING_SCOPES');
  assert.equal(appState.recovery.restartBlockedTs, NOW);
  assert.equal(appState.recovery.events[0].type, 'RESTART_UNAVAILABLE');
  assert.equal(
    appState.recovery.events[0].message,
    'No se puede reiniciar ESPHome Controller automaticamente: faltan permisos de Homey (Missing Scopes)',
  );
  assert.deepEqual(triggerCalls, [{
    status: 'RESTART_UNAVAILABLE',
    message: 'No se puede reiniciar ESPHome Controller automaticamente: faltan permisos de Homey (Missing Scopes)',
    attempts: 1,
  }]);
});

test('does not retry ESPHome Controller restart while Missing Scopes block is active', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 3;
  initialRecovery.restartBlockedReason = 'MISSING_SCOPES';
  initialRecovery.restartBlockedTs = NOW;
  const { service, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_UNAVAILABLE');
  assert.equal(result.reason, 'MISSING_SCOPES');
  assert.deepEqual(restartCalls, []);
});

test('reports restart unavailable after Missing Scopes unless a fallback token is configured', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.restartBlockedReason = 'MISSING_SCOPES';
  const blocked = createService({
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
  });

  const blockedStatus = await blocked.service.status();

  assert.equal(blockedStatus.restartSupported, false);
  assert.equal(blockedStatus.canRestartController, false);

  const fallback = createService({
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
    recoveryToken: 'pat-test-token',
  });

  const fallbackStatus = await fallback.service.status();

  assert.equal(fallbackStatus.configuredRecoveryToken, true);
  assert.equal(fallbackStatus.restartSupported, true);
  assert.equal(fallbackStatus.canRestartController, true);
});

test('uses running threshold in ACTIVE_COMPAT', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 1;
  const { service, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    engineMode: 'ACTIVE_COMPAT',
    engineState: 'RUNNING',
    initialRecovery,
  });

  const result = await service.check();

  assert.equal(result.status, 'RESTART_REQUESTED');
  assert.equal(restartCalls.length, 1);
});

test('does not restart during cooldown', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 3;
  initialRecovery.lastRestartTs = NOW;
  const { service, restartCalls } = createService({
    available: false,
    mode: 'ACTIVE_COMPAT',
    initialRecovery,
    now: () => NOW + constants.RESTART_COOLDOWN_MS - 1,
  });

  const result = await service.check();

  assert.equal(result.status, 'COOLDOWN');
  assert.deepEqual(restartCalls, []);
});

test('resets incident counters when ESPHome is available again in ACTIVE_COMPAT', async () => {
  const initialRecovery = initialRecoveryState();
  initialRecovery.consecutiveFailures = 2;
  initialRecovery.attemptsInIncident = 1;
  initialRecovery.awaitingRecovery = true;
  const { service, appState, triggerCalls } = createService({
    mode: 'ACTIVE_COMPAT',
    available: true,
    initialRecovery,
  });

  const result = await service.check();

  assert.equal(result.status, 'RECOVERED');
  assert.equal(appState.recovery.consecutiveFailures, 0);
  assert.equal(appState.recovery.attemptsInIncident, 0);
  assert.equal(appState.recovery.awaitingRecovery, false);
  assert.equal(appState.recovery.lastRecoveryTs, NOW);
  assert.equal(appState.recovery.events[0].type, 'RECOVERED');
  assert.equal(triggerCalls[0].status, 'RECOVERED');
});
