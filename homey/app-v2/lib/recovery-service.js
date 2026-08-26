'use strict';

const { MODE, SERVICE } = require('./constants');
const { readEngineSnapshot } = require('./engine-state-source');

const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';
const APP_NAME_PATTERN = /esphome\s*controller/i;
const CHECK_INTERVAL_MS = 60 * 1000;

const RAW_CAP = {
  relays: {
    1: 'onoff',
    2: 'onoff.rel__l_nea_2',
    3: 'onoff.rel__l_nea_3',
    4: 'onoff.rel__l_nea_4',
    5: 'onoff.rel__l_nea_5',
    6: 'onoff.rel__l_nea_6',
  },
};

const FAILURE_THRESHOLD_IDLE = 3;
const FAILURE_THRESHOLD_RUNNING = 2;
const RESTART_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_PER_INCIDENT = 3;
const MAX_EVENTS = 20;
const RESTART_REQUIRED_SCOPE = 'homey.app';

function initialRecoveryState() {
  return {
    version: 1,
    consecutiveFailures: 0,
    incidentStartedTs: 0,
    attemptsInIncident: 0,
    lastRestartTs: 0,
    awaitingRecovery: false,
    exhaustedNotified: false,
    restartBlockedReason: null,
    restartBlockedTs: 0,
    lastRecoveryTs: 0,
    lastMessage: 'Sin incidencias de conexion',
    events: [],
  };
}

function normalizeRecoveryState(input) {
  const stored = input && typeof input === 'object' ? input : {};
  return {
    ...initialRecoveryState(),
    ...stored,
    events: Array.isArray(stored.events) ? stored.events : [],
  };
}

function appendEvent(state, type, message, now, extra = {}) {
  return {
    ...state,
    lastMessage: message,
    events: [
      { ts: now, type, message, ...extra },
      ...(Array.isArray(state.events) ? state.events : []),
    ].slice(0, MAX_EVENTS),
  };
}

function isMissingScopesError(error) {
  return /missing\s+scopes/i.test(String(error?.message || error || ''));
}

class RecoveryService {
  constructor({
    homey,
    apiClient,
    appStateStore = null,
    controlStore = null,
    recoveryTokenStore = null,
    recoveryEventTrigger = null,
    now = () => Date.now(),
    logger = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.appStateStore = appStateStore;
    this.controlStore = controlStore;
    this.recoveryTokenStore = recoveryTokenStore;
    this.recoveryEventTrigger = recoveryEventTrigger;
    this.now = now;
    this.logger = logger || homey.app;
    this.timer = null;
    this.checking = false;
    this.lastCheck = null;
    this.lastError = null;
    this.shadowState = initialRecoveryState();
    this.privilegedApi = null;
    this.privilegedApiToken = null;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = this.homey.setInterval(() => {
      this.check().catch(error => {
        this.lastError = {
          ts: this.now(),
          message: error.message,
        };
        this.logger.error('Recovery check failed', error);
      });
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  async getApi() {
    return this.apiClient.getApi();
  }

  async getMode() {
    if (!this.controlStore) {
      return MODE.SHADOW;
    }

    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.RECOVERY] || MODE.SHADOW;
  }

  async getState() {
    const appState = this.appStateStore ? await this.appStateStore.getState() : {};
    return normalizeRecoveryState(appState?.recovery);
  }

  async setState(state) {
    if (!this.appStateStore) {
      return normalizeRecoveryState(state);
    }

    await this.appStateStore.setRecovery(normalizeRecoveryState(state));
    return normalizeRecoveryState(state);
  }

  async recordEvent(state, type, message, now, extra = {}) {
    const nextState = appendEvent(state, type, message, now, extra);
    await this.setState(nextState);

    if (this.appStateStore) {
      await this.appStateStore.appendEvent({
        type: 'recovery.event',
        ts: now,
        status: type,
        message,
        ...extra,
      });
    }

    const triggers = await this.triggerEvent(type, message, nextState);
    return { state: nextState, triggers };
  }

  async triggerEvent(type, message, state) {
    const triggers = [];
    if (this.recoveryEventTrigger) {
      try {
        await this.recoveryEventTrigger.trigger({
          status: type,
          message,
          attempts: Number(state.attemptsInIncident || 0),
        });
        triggers.push({ id: 'recovery_event', skipped: false });
      } catch (error) {
        triggers.push({
          id: 'recovery_event',
          skipped: true,
          reason: 'TRIGGER_FAILED',
          message: error.message,
        });
        this.logger.log(`Recovery event trigger skipped: ${error.message}`);
      }
    } else {
      triggers.push({ id: 'recovery_event', skipped: true, reason: 'TRIGGER_NOT_AVAILABLE' });
    }

    return triggers;
  }

  async getRawDevice() {
    const api = await this.getApi();

    if (api.devices?.getDevice) {
      return api.devices.getDevice({ id: RAW_DEVICE_ID });
    }

    const devices = await api.devices.getDevices();
    return devices[RAW_DEVICE_ID] || null;
  }

  async rawIsAvailable() {
    try {
      const raw = await this.getRawDevice();
      return raw?.available !== false;
    } catch (error) {
      return false;
    }
  }

  getActiveRelays(raw) {
    return Object.entries(RAW_CAP.relays)
      .filter(([, capability]) => raw?.capabilitiesObj?.[capability]?.value === true)
      .map(([sector]) => Number(sector));
  }

  async getApps() {
    const api = await this.getApi();
    return api.apps.getApps();
  }

  async findControllerApp() {
    const apps = Object.values(await this.getApps());
    const candidates = apps.filter(app => APP_NAME_PATTERN.test(String(app.name || '')));

    if (candidates.length !== 1) {
      throw new Error(`Se esperaba una app ESPHome Controller y se encontraron ${candidates.length}`);
    }

    return candidates[0];
  }

  async restartControllerApp(controller) {
    const privileged = await this.getPrivilegedApi();
    if (privileged) {
      await privileged.apps.restartApp({ id: controller.id });
      return { method: 'configuredUserToken' };
    }

    const api = await this.getApi();
    try {
      await api.apps.restartApp({ id: controller.id });
      return { method: 'appOwnerToken' };
    } catch (error) {
      throw error;
    }
  }

  async getPrivilegedApi() {
    if (!this.recoveryTokenStore) {
      return null;
    }

    const token = await this.recoveryTokenStore.getToken();
    if (!token) {
      return null;
    }

    if (this.privilegedApi && this.privilegedApiToken === token) {
      return this.privilegedApi;
    }

    const { HomeyAPI } = require('homey-api');
    this.privilegedApi = await HomeyAPI.createLocalAPI({
      address: await this.homey.api.getLocalUrl(),
      token,
    });
    this.privilegedApiToken = token;
    return this.privilegedApi;
  }

  async hasConfiguredRecoveryToken() {
    if (!this.recoveryTokenStore) {
      return false;
    }

    const status = await this.recoveryTokenStore.getStatus();
    return Boolean(status.configured);
  }

  getApiScopeInfo(api) {
    const canInspectScopes = typeof api.hasScope === 'function';
    const restartScopeAvailable = canInspectScopes
      ? Boolean(api.hasScope(RESTART_REQUIRED_SCOPE))
      : null;

    return {
      canInspectScopes,
      restartRequiredScope: RESTART_REQUIRED_SCOPE,
      restartScopeAvailable,
    };
  }

  async status() {
    const mode = await this.getMode();
    const available = await this.rawIsAvailable();
    const state = mode === MODE.SHADOW ? this.shadowState : await this.getState();
    const apps = Object.values(await this.getApps());
    const candidates = apps
      .filter(app => /esphome/i.test(String(app.name || app.id || '')))
      .map(app => ({
        id: app.id,
        name: app.name,
        version: app.version,
        enabled: app.enabled,
      }));
    const api = await this.getApi();
    const apiScopes = this.getApiScopeInfo(api);
    const configuredRecoveryToken = await this.hasConfiguredRecoveryToken();
    const restartSupported = typeof api.apps?.restartApp === 'function'
      && (apiScopes.restartScopeAvailable !== false || configuredRecoveryToken)
      && (state.restartBlockedReason !== 'MISSING_SCOPES' || configuredRecoveryToken);

    return {
      mode,
      shadow: mode === MODE.SHADOW,
      restartSupported,
      canRestartController: mode === MODE.ACTIVE_COMPAT && restartSupported,
      apiScopes,
      configuredRecoveryToken,
      restartBlockedReason: state.restartBlockedReason || null,
      writesOperationalVariables: false,
      writesInternalState: mode === MODE.ACTIVE_COMPAT,
      checkIntervalMs: CHECK_INTERVAL_MS,
      timerActive: Boolean(this.timer),
      available,
      candidates,
      state,
      lastCheck: this.lastCheck,
      lastError: this.lastError,
    };
  }

  async restartControllerProbe({ confirmNoIrrigationActive = false } = {}) {
    const now = this.now();
    const mode = await this.getMode();

    if (mode !== MODE.ACTIVE_COMPAT) {
      throw new Error('Recovery debe estar en ACTIVE_COMPAT para reiniciar ESPHome Controller');
    }

    if (confirmNoIrrigationActive !== true) {
      throw new Error('Se requiere confirmNoIrrigationActive=true para ejecutar el reinicio de prueba');
    }

    const engine = await readEngineSnapshot({
      appStateStore: this.appStateStore,
    });
    if (engine.state !== 'IDLE' || Number(engine.activeSector || 0) !== 0) {
      throw new Error(`No se reinicia ESPHome Controller con motor ${engine.state} y sector activo ${engine.activeSector}`);
    }

    const raw = await this.getRawDevice();
    const activeRelays = this.getActiveRelays(raw);
    if (activeRelays.length > 0) {
      throw new Error(`No se reinicia ESPHome Controller con reles activos: ${activeRelays.join(',')}`);
    }

    const api = await this.getApi();
    const apiScopes = this.getApiScopeInfo(api);
    const configuredRecoveryToken = await this.hasConfiguredRecoveryToken();
    if (apiScopes.restartScopeAvailable === false && !configuredRecoveryToken) {
      throw new Error(`El token interno de la app no tiene el scope requerido ${RESTART_REQUIRED_SCOPE}`);
    }

    const controller = await this.findControllerApp();
    let restart;
    try {
      restart = await this.restartControllerApp(controller);
    } catch (error) {
      if (isMissingScopesError(error)) {
        const state = mode === MODE.SHADOW ? this.shadowState : await this.getState();
        const message = 'No se puede reiniciar ESPHome Controller automaticamente: faltan permisos de Homey (Missing Scopes)';
        await this.recordEvent(
          {
            ...state,
            awaitingRecovery: false,
            restartBlockedReason: 'MISSING_SCOPES',
            restartBlockedTs: now,
          },
          'RESTART_UNAVAILABLE',
          message,
          now,
        );
      }

      throw error;
    }

    const state = mode === MODE.SHADOW ? this.shadowState : await this.getState();
    const message = 'Reinicio de prueba de ESPHome Controller solicitado desde Recovery v2';
    const recorded = await this.recordEvent(state, 'RESTART_PROBE_REQUESTED', message, now, {
      appId: controller.id,
      appVersion: controller.version || 'unknown',
    });

    return {
      status: 'RESTART_PROBE_REQUESTED',
      mode,
      controller: {
        id: controller.id,
        name: controller.name,
        version: controller.version || 'unknown',
      },
      engine: {
        state: engine.state,
        activeSector: Number(engine.activeSector || 0),
      },
      activeRelays,
      apiScopes,
      configuredRecoveryToken,
      restart,
      state: recorded.state,
      applied: { triggers: recorded.triggers },
    };
  }

  async requestControllerRestartAfterCommandFailure({
    confirmNoIrrigationActive = false,
    nowTs = this.now(),
  } = {}) {
    const mode = await this.getMode();

    if (mode !== MODE.ACTIVE_COMPAT) {
      throw new Error('Recovery debe estar en ACTIVE_COMPAT para reiniciar ESPHome Controller');
    }

    if (confirmNoIrrigationActive !== true) {
      throw new Error('Se requiere confirmNoIrrigationActive=true para reiniciar ESPHome Controller');
    }

    const engine = await readEngineSnapshot({
      appStateStore: this.appStateStore,
    });
    if (engine.state !== 'IDLE' || Number(engine.activeSector || 0) !== 0) {
      throw new Error(`No se reinicia ESPHome Controller con motor ${engine.state} y sector activo ${engine.activeSector}`);
    }

    const raw = await this.getRawDevice();
    const activeRelays = this.getActiveRelays(raw);
    if (activeRelays.length > 0) {
      throw new Error(`No se reinicia ESPHome Controller con reles activos: ${activeRelays.join(',')}`);
    }

    let state = await this.getState();
    state = {
      ...state,
      incidentStartedTs: state.incidentStartedTs || nowTs,
      consecutiveFailures: Math.max(Number(state.consecutiveFailures || 0), FAILURE_THRESHOLD_IDLE),
    };

    if (state.attemptsInIncident >= MAX_ATTEMPTS_PER_INCIDENT) {
      await this.setState(state);
      return { status: 'EXHAUSTED', mode, state, reason: 'MAX_ATTEMPTS' };
    }

    const configuredRecoveryToken = await this.hasConfiguredRecoveryToken();
    if (state.restartBlockedReason === 'MISSING_SCOPES' && !configuredRecoveryToken) {
      await this.setState(state);
      return { status: 'RESTART_UNAVAILABLE', mode, state, reason: 'MISSING_SCOPES' };
    }

    const api = await this.getApi();
    const apiScopes = this.getApiScopeInfo(api);
    if (apiScopes.restartScopeAvailable === false && !configuredRecoveryToken) {
      const message = 'No se puede reiniciar ESPHome Controller automaticamente: el token interno de la app no tiene el scope homey.app';
      const recorded = await this.recordEvent(
        {
          ...state,
          awaitingRecovery: false,
          restartBlockedReason: 'MISSING_SCOPES',
          restartBlockedTs: nowTs,
        },
        'RESTART_UNAVAILABLE',
        message,
        nowTs,
      );
      this.logger.log(message);
      return {
        status: 'RESTART_UNAVAILABLE',
        mode,
        state: recorded.state,
        reason: 'MISSING_SCOPES',
        apiScopes,
        applied: { triggers: recorded.triggers },
      };
    }

    if (state.lastRestartTs > 0 && nowTs - state.lastRestartTs < RESTART_COOLDOWN_MS) {
      await this.setState(state);
      this.logger.log('Recovery cooldown activo tras fallo de arranque del programador');
      return { status: 'COOLDOWN', mode, state };
    }

    let controller;
    try {
      controller = await this.findControllerApp();
    } catch (error) {
      const message = `No se puede reiniciar ESPHome Controller: ${error.message}`;
      const recorded = await this.recordEvent(state, 'CONFIG_ERROR', message, nowTs);
      this.logger.log(message);
      return { status: 'CONFIG_ERROR', mode, state: recorded.state, applied: { triggers: recorded.triggers } };
    }

    const attempt = state.attemptsInIncident + 1;
    const requestedMessage = `Reinicio automatico ${attempt}/${MAX_ATTEMPTS_PER_INCIDENT} de ESPHome Controller solicitado por fallo de comandos`;
    state = appendEvent(state, 'RESTART_REQUESTED', requestedMessage, nowTs, {
      appId: controller.id,
      appVersion: controller.version || 'unknown',
      engineState: engine.state,
      reason: 'COMMAND_UNAVAILABLE',
      attempt,
    });
    state = {
      ...state,
      attemptsInIncident: attempt,
      lastRestartTs: nowTs,
      awaitingRecovery: true,
      restartBlockedReason: configuredRecoveryToken ? null : state.restartBlockedReason,
      restartBlockedTs: configuredRecoveryToken ? 0 : state.restartBlockedTs,
    };

    await this.setState(state);

    try {
      const restart = await this.restartControllerApp(controller);
      const triggers = await this.triggerEvent('RESTART_REQUESTED', requestedMessage, state);
      this.logger.log(requestedMessage);
      return { status: 'RESTART_REQUESTED', mode, state, restart, applied: { triggers } };
    } catch (error) {
      const failedAt = this.now();
      const missingScopes = isMissingScopesError(error);
      const message = missingScopes
        ? 'No se puede reiniciar ESPHome Controller automaticamente: faltan permisos de Homey (Missing Scopes)'
        : `Fallo el reinicio automatico de ESPHome Controller: ${error.message}`;
      const eventType = missingScopes ? 'RESTART_UNAVAILABLE' : 'RESTART_FAILED';
      const recorded = await this.recordEvent(
        {
          ...state,
          awaitingRecovery: false,
          restartBlockedReason: missingScopes ? 'MISSING_SCOPES' : state.restartBlockedReason,
          restartBlockedTs: missingScopes ? failedAt : state.restartBlockedTs,
        },
        eventType,
        message,
        failedAt,
        { attempt, reason: 'COMMAND_UNAVAILABLE' },
      );
      this.logger.log(message);
      return { status: eventType, mode, state: recorded.state, applied: { triggers: recorded.triggers } };
    }
  }

  async check() {
    if (this.checking) {
      return { skipped: true, reason: 'ALREADY_RUNNING' };
    }

    this.checking = true;

    try {
      const result = await this.performCheck();
      this.lastCheck = result;
      this.lastError = null;
      return result;
    } catch (error) {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      throw error;
    } finally {
      this.checking = false;
    }
  }

  async performCheck() {
    const now = this.now();
    const mode = await this.getMode();
    const available = await this.rawIsAvailable();
    let state = mode === MODE.SHADOW ? this.shadowState : await this.getState();

    if (available) {
      if (mode === MODE.SHADOW) {
        this.shadowState = initialRecoveryState();
      }

      if (mode === MODE.ACTIVE_COMPAT && (state.consecutiveFailures > 0 || state.awaitingRecovery)) {
        const recoveredAfterRestart = state.awaitingRecovery;
        const message = recoveredAfterRestart
          ? 'ESPHome Controller ha recuperado la conexion despues del reinicio automatico'
          : 'La conexion con ESPHome Controller se ha recuperado sin reinicio';
        const recorded = await this.recordEvent(state, 'RECOVERED', message, now, {
          attempts: state.attemptsInIncident,
        });
        state = {
          ...recorded.state,
          consecutiveFailures: 0,
          incidentStartedTs: 0,
          attemptsInIncident: 0,
          awaitingRecovery: false,
          exhaustedNotified: false,
          restartBlockedReason: null,
          restartBlockedTs: 0,
          lastRecoveryTs: now,
        };
        await this.setState(state);
        this.logger.log(message);
        return { status: 'RECOVERED', mode, state, applied: { triggers: recorded.triggers } };
      }

      this.logger.log(`Recovery ${mode} check: ESPHome disponible`);
      return { status: 'AVAILABLE', mode, state, available };
    }

    const engine = await readEngineSnapshot({
      appStateStore: this.appStateStore,
    });
    const engineState = engine.state;
    const threshold = engineState === 'RUNNING'
      ? FAILURE_THRESHOLD_RUNNING
      : FAILURE_THRESHOLD_IDLE;
    const failures = state.consecutiveFailures + 1;

    if (mode !== MODE.ACTIVE_COMPAT) {
      const shadowState = {
        ...state,
        consecutiveFailures: failures,
        incidentStartedTs: state.incidentStartedTs || now,
      };
      this.shadowState = shadowState;
      this.logger.log(`Recovery SHADOW pending: ${failures}/${threshold} comprobaciones fallidas`);
      return {
        status: failures >= threshold ? 'WOULD_RESTART' : 'PENDING',
        mode,
        shadow: true,
        available,
        failures,
        threshold,
        state: shadowState,
      };
    }

    state = {
      ...state,
      consecutiveFailures: failures,
      incidentStartedTs: state.incidentStartedTs || now,
    };

    if (failures < threshold) {
      await this.setState(state);
      this.logger.log(`Recovery pending: ${failures}/${threshold} comprobaciones fallidas`);
      return { status: 'PENDING', mode, state, failures, threshold };
    }

    if (state.attemptsInIncident >= MAX_ATTEMPTS_PER_INCIDENT) {
      if (!state.exhaustedNotified) {
        const message = `ESPHome Controller sigue desconectado tras ${state.attemptsInIncident} reinicios automaticos`;
        const recorded = await this.recordEvent(state, 'EXHAUSTED', message, now);
        state = { ...recorded.state, exhaustedNotified: true };
        await this.setState(state);
        this.logger.log('Recovery exhausted: intervencion manual necesaria');
        return { status: 'EXHAUSTED', mode, state, applied: { triggers: recorded.triggers } };
      }

      await this.setState(state);
      this.logger.log('Recovery exhausted: intervencion manual necesaria');
      return { status: 'EXHAUSTED', mode, state, applied: { triggers: [{ id: 'recovery_event', skipped: true, reason: 'UNCHANGED' }] } };
    }

    const configuredRecoveryToken = await this.hasConfiguredRecoveryToken();
    if (state.restartBlockedReason === 'MISSING_SCOPES' && !configuredRecoveryToken) {
      await this.setState(state);
      const message = 'ESPHome Controller sigue desconectado, pero Homey no ha concedido permisos para reiniciarlo automaticamente';
      this.logger.log(message);
      return {
        status: 'RESTART_UNAVAILABLE',
        mode,
        state,
        reason: 'MISSING_SCOPES',
        applied: {
          triggers: [{ id: 'recovery_event', skipped: true, reason: 'UNCHANGED' }],
        },
      };
    }

    const api = await this.getApi();
    const apiScopes = this.getApiScopeInfo(api);
    if (apiScopes.restartScopeAvailable === false && !configuredRecoveryToken) {
      const message = 'No se puede reiniciar ESPHome Controller automaticamente: el token interno de la app no tiene el scope homey.app';
      const recorded = await this.recordEvent(
        {
          ...state,
          awaitingRecovery: false,
          restartBlockedReason: 'MISSING_SCOPES',
          restartBlockedTs: now,
        },
        'RESTART_UNAVAILABLE',
        message,
        now,
      );
      this.logger.log(message);
      return {
        status: 'RESTART_UNAVAILABLE',
        mode,
        state: recorded.state,
        reason: 'MISSING_SCOPES',
        apiScopes,
        applied: { triggers: recorded.triggers },
      };
    }

    if (state.lastRestartTs > 0 && now - state.lastRestartTs < RESTART_COOLDOWN_MS) {
      await this.setState(state);
      this.logger.log('Recovery cooldown activo');
      return { status: 'COOLDOWN', mode, state };
    }

    let controller;
    try {
      controller = await this.findControllerApp();
    } catch (error) {
      const message = `No se puede reiniciar ESPHome Controller: ${error.message}`;
      const recorded = await this.recordEvent(state, 'CONFIG_ERROR', message, now);
      this.logger.log(message);
      return { status: 'CONFIG_ERROR', mode, state: recorded.state, applied: { triggers: recorded.triggers } };
    }

    const attempt = state.attemptsInIncident + 1;
    const requestedMessage = `Reinicio automatico ${attempt}/${MAX_ATTEMPTS_PER_INCIDENT} de ESPHome Controller solicitado`;
    state = appendEvent(state, 'RESTART_REQUESTED', requestedMessage, now, {
      appId: controller.id,
      appVersion: controller.version || 'unknown',
      engineState,
      attempt,
    });
    state = {
      ...state,
      attemptsInIncident: attempt,
      lastRestartTs: now,
      awaitingRecovery: true,
      restartBlockedReason: configuredRecoveryToken ? null : state.restartBlockedReason,
      restartBlockedTs: configuredRecoveryToken ? 0 : state.restartBlockedTs,
    };

    await this.setState(state);

    try {
      const restart = await this.restartControllerApp(controller);
      const triggers = await this.triggerEvent('RESTART_REQUESTED', requestedMessage, state);
      this.logger.log(requestedMessage);
      return { status: 'RESTART_REQUESTED', mode, state, restart, applied: { triggers } };
    } catch (error) {
      const failedAt = this.now();
      const missingScopes = isMissingScopesError(error);
      const message = missingScopes
        ? 'No se puede reiniciar ESPHome Controller automaticamente: faltan permisos de Homey (Missing Scopes)'
        : `Fallo el reinicio automatico de ESPHome Controller: ${error.message}`;
      const eventType = missingScopes ? 'RESTART_UNAVAILABLE' : 'RESTART_FAILED';
      const recorded = await this.recordEvent(
        {
          ...state,
          awaitingRecovery: false,
          restartBlockedReason: missingScopes ? 'MISSING_SCOPES' : state.restartBlockedReason,
          restartBlockedTs: missingScopes ? failedAt : state.restartBlockedTs,
        },
        eventType,
        message,
        failedAt,
        { attempt },
      );
      this.logger.log(message);
      return { status: eventType, mode, state: recorded.state, applied: { triggers: recorded.triggers } };
    }
  }
}

module.exports = {
  RecoveryService,
  initialRecoveryState,
  normalizeRecoveryState,
  appendEvent,
  isMissingScopesError,
  constants: {
    RAW_DEVICE_ID,
    RAW_CAP,
    CHECK_INTERVAL_MS,
    FAILURE_THRESHOLD_IDLE,
    FAILURE_THRESHOLD_RUNNING,
    RESTART_COOLDOWN_MS,
    MAX_ATTEMPTS_PER_INCIDENT,
    MAX_EVENTS,
    RESTART_REQUIRED_SCOPE,
  },
};
