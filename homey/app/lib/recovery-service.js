'use strict';

const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';
const APP_NAME_PATTERN = /esphome\s*controller/i;
const CHECK_INTERVAL_MS = 60 * 1000;

const VAR = {
  state: 'Irrigation.Recovery',
  message: 'Irrigation.RecoveryMessage',
  trigger: 'Irrigation.RecoveryTrigger',
  engineState: 'Irrigation.State',
};

const FAILURE_THRESHOLD_IDLE = 3;
const FAILURE_THRESHOLD_RUNNING = 2;
const RESTART_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS_PER_INCIDENT = 3;
const MAX_EVENTS = 20;

function initialRecoveryState() {
  return {
    version: 1,
    consecutiveFailures: 0,
    incidentStartedTs: 0,
    attemptsInIncident: 0,
    lastRestartTs: 0,
    awaitingRecovery: false,
    exhaustedNotified: false,
    lastRecoveryTs: 0,
    lastMessage: 'Sin incidencias de conexion',
    events: [],
  };
}

function parseRecoveryState(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return { ...initialRecoveryState(), ...parsed };
  } catch (error) {
    return initialRecoveryState();
  }
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

class RecoveryService {
  constructor({
    homey,
    apiClient,
    logicStore,
    now = () => Date.now(),
    logger = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.logicStore = logicStore;
    this.now = now;
    this.logger = logger || homey.app;
    this.timer = null;
    this.checking = false;
    this.lastError = null;
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

  async ensureVariables() {
    await this.logicStore.ensureVariable(VAR.state, JSON.stringify(initialRecoveryState()), 'string');
    await this.logicStore.ensureVariable(VAR.message, 'Sin incidencias de conexion', 'string');
    await this.logicStore.ensureVariable(VAR.trigger, 0, 'number');
  }

  async getState() {
    return parseRecoveryState(await this.logicStore.getValue(VAR.state, '{}'));
  }

  async persistState(state) {
    await this.logicStore.setValue(VAR.state, JSON.stringify(state), 'string');
  }

  async emitEvent(state, message, now) {
    await this.persistState(state);
    await this.logicStore.setValue(VAR.message, message, 'string');
    await this.logicStore.setValue(VAR.trigger, now, 'number');
  }

  async getApi() {
    return this.apiClient.getApi();
  }

  async getRawDevice() {
    const api = await this.getApi();

    if (api.devices?.getDevice) {
      return api.devices.getDevice({ id: RAW_DEVICE_ID });
    }

    const devices = await api.devices.getDevices();
    return devices[RAW_DEVICE_ID];
  }

  async rawIsAvailable() {
    try {
      const raw = await this.getRawDevice();
      return raw?.available !== false;
    } catch (error) {
      return false;
    }
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
    const api = await this.getApi();
    return api.apps.restartApp({ id: controller.id });
  }

  async status() {
    const state = await this.getState();
    const available = await this.rawIsAvailable();
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

    return {
      available,
      restartSupported: typeof api.apps?.restartApp === 'function',
      candidates,
      state,
      lastError: this.lastError,
    };
  }

  async check() {
    if (this.checking) {
      return { skipped: true, reason: 'ALREADY_RUNNING' };
    }

    this.checking = true;

    try {
      const result = await this.performCheck();
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
    await this.ensureVariables();
    const now = this.now();
    const available = await this.rawIsAvailable();
    let state = await this.getState();

    if (available) {
      if (state.consecutiveFailures > 0 || state.awaitingRecovery) {
        const recoveredAfterRestart = state.awaitingRecovery;
        const message = recoveredAfterRestart
          ? 'ESPHome Controller ha recuperado la conexion despues del reinicio automatico'
          : 'La conexion con ESPHome Controller se ha recuperado sin reinicio';
        state = appendEvent(state, 'RECOVERED', message, now, {
          attempts: state.attemptsInIncident,
        });
        state = {
          ...state,
          consecutiveFailures: 0,
          incidentStartedTs: 0,
          attemptsInIncident: 0,
          awaitingRecovery: false,
          exhaustedNotified: false,
          lastRecoveryTs: now,
        };
        await this.emitEvent(state, message, now);
        this.logger.log(message);
        return { status: 'RECOVERED', state };
      }

      this.logger.log('RECOVERY check: ESPHome disponible');
      return { status: 'AVAILABLE', state };
    }

    const engineState = String(await this.logicStore.getValue(VAR.engineState, 'IDLE'));
    const threshold = engineState === 'RUNNING'
      ? FAILURE_THRESHOLD_RUNNING
      : FAILURE_THRESHOLD_IDLE;
    const failures = state.consecutiveFailures + 1;
    state = {
      ...state,
      consecutiveFailures: failures,
      incidentStartedTs: state.incidentStartedTs || now,
    };

    if (failures < threshold) {
      await this.persistState(state);
      this.logger.log(`RECOVERY pending: ${failures}/${threshold} comprobaciones fallidas`);
      return { status: 'PENDING', state, failures, threshold };
    }

    if (state.attemptsInIncident >= MAX_ATTEMPTS_PER_INCIDENT) {
      if (!state.exhaustedNotified) {
        const message = `ESPHome Controller sigue desconectado tras ${state.attemptsInIncident} reinicios automaticos`;
        state = appendEvent(state, 'EXHAUSTED', message, now);
        state = { ...state, exhaustedNotified: true };
        await this.emitEvent(state, message, now);
      } else {
        await this.persistState(state);
      }
      this.logger.log('RECOVERY exhausted: intervencion manual necesaria');
      return { status: 'EXHAUSTED', state };
    }

    if (state.lastRestartTs > 0 && now - state.lastRestartTs < RESTART_COOLDOWN_MS) {
      await this.persistState(state);
      this.logger.log('RECOVERY cooldown activo');
      return { status: 'COOLDOWN', state };
    }

    let controller;
    try {
      controller = await this.findControllerApp();
    } catch (error) {
      const message = `No se puede reiniciar ESPHome Controller: ${error.message}`;
      state = appendEvent(state, 'CONFIG_ERROR', message, now);
      await this.emitEvent(state, message, now);
      this.logger.log(message);
      return { status: 'CONFIG_ERROR', state };
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
    };

    await this.persistState(state);

    try {
      await this.restartControllerApp(controller);
      await this.logicStore.setValue(VAR.message, requestedMessage, 'string');
      await this.logicStore.setValue(VAR.trigger, now, 'number');
      this.logger.log(requestedMessage);
      return { status: 'RESTART_REQUESTED', state };
    } catch (error) {
      const failedAt = this.now();
      const message = `Fallo el reinicio automatico de ESPHome Controller: ${error.message}`;
      state = appendEvent(state, 'RESTART_FAILED', message, failedAt, { attempt });
      state = { ...state, awaitingRecovery: false };
      await this.emitEvent(state, message, failedAt);
      this.logger.log(message);
      return { status: 'RESTART_FAILED', state };
    }
  }
}

module.exports = {
  RecoveryService,
  initialRecoveryState,
  parseRecoveryState,
  appendEvent,
  constants: {
    RAW_DEVICE_ID,
    VAR,
    CHECK_INTERVAL_MS,
    FAILURE_THRESHOLD_IDLE,
    FAILURE_THRESHOLD_RUNNING,
    RESTART_COOLDOWN_MS,
    MAX_ATTEMPTS_PER_INCIDENT,
    MAX_EVENTS,
  },
};
