'use strict';

// =========================================================
// Irrigation Recovery
// Recupera la integración ESPHome Controller cuando el
// dispositivo físico permanece indisponible en Homey.
// Nunca controla relés, motor ni cola.
// =========================================================

const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';
const APP_NAME_PATTERN = /esphome\s*controller/i;

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

function initialState() {
  return {
    version: 1,
    consecutiveFailures: 0,
    incidentStartedTs: 0,
    attemptsInIncident: 0,
    lastRestartTs: 0,
    awaitingRecovery: false,
    exhaustedNotified: false,
    lastRecoveryTs: 0,
    lastMessage: 'Sin incidencias de conexión',
    events: [],
  };
}

function parseState(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return { ...initialState(), ...parsed };
  } catch (error) {
    return initialState();
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

async function getLogicVariable(name) {
  const variables = await Homey.logic.getVariables();
  return Object.values(variables).find(variable => variable.name === name) || null;
}

async function getLogicValue(name, fallback = null) {
  const variable = await getLogicVariable(name);
  return variable ? variable.value : fallback;
}

async function setLogicValue(name, value, type) {
  const variable = await getLogicVariable(name);
  if (!variable) {
    await Homey.logic.createVariable({ variable: { name, type, value } });
    return;
  }
  if (variable.value === value) return;
  await Homey.logic.updateVariable({ id: variable.id, variable: { value } });
}

async function ensureLogicVariable(name, value, type) {
  if (await getLogicVariable(name)) return;
  await Homey.logic.createVariable({ variable: { name, type, value } });
}

async function persistState(state) {
  await setLogicValue(VAR.state, JSON.stringify(state), 'string');
}

async function emitEvent(state, message, now) {
  // Orden obligatorio: estado persistente -> mensaje -> trigger.
  await persistState(state);
  await setLogicValue(VAR.message, message, 'string');
  await setLogicValue(VAR.trigger, now, 'number');
}

async function ensureRecoveryVariables() {
  await ensureLogicVariable(VAR.state, JSON.stringify(initialState()), 'string');
  await ensureLogicVariable(VAR.message, 'Sin incidencias de conexión', 'string');
  await ensureLogicVariable(VAR.trigger, 0, 'number');
}

async function findControllerApp() {
  const apps = Object.values(await Homey.apps.getApps());
  const candidates = apps.filter(app => APP_NAME_PATTERN.test(String(app.name || '')));
  if (candidates.length !== 1) {
    throw new Error(`Se esperaba una app ESPHome Controller y se encontraron ${candidates.length}`);
  }
  return candidates[0];
}

async function rawIsAvailable() {
  try {
    const raw = await Homey.devices.getDevice({ id: RAW_DEVICE_ID });
    return raw?.available !== false;
  } catch (error) {
    return false;
  }
}

async function status() {
  const state = parseState(await getLogicValue(VAR.state, '{}'));
  const available = await rawIsAvailable();
  const apps = Object.values(await Homey.apps.getApps());
  const candidates = apps
    .filter(app => /esphome/i.test(String(app.name || app.id || '')))
    .map(app => ({ id: app.id, name: app.name, version: app.version, enabled: app.enabled }));

  console.log({
    available,
    restartSupported: typeof Homey.apps.restartApp === 'function',
    candidates,
    state,
  });
}

async function check() {
  await ensureRecoveryVariables();
  const now = Date.now();
  const available = await rawIsAvailable();
  let state = parseState(await getLogicValue(VAR.state, '{}'));

  if (available) {
    if (state.consecutiveFailures > 0 || state.awaitingRecovery) {
      const recoveredAfterRestart = state.awaitingRecovery;
      const message = recoveredAfterRestart
        ? 'ESPHome Controller ha recuperado la conexión después del reinicio automático'
        : 'La conexión con ESPHome Controller se ha recuperado sin reinicio';
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
      await emitEvent(state, message, now);
      console.log(message);
      return;
    }

    console.log('RECOVERY check: ESPHome disponible');
    return;
  }

  const engineState = String(await getLogicValue(VAR.engineState, 'IDLE'));
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
    await persistState(state);
    console.log(`RECOVERY pending: ${failures}/${threshold} comprobaciones fallidas`);
    return;
  }

  if (state.attemptsInIncident >= MAX_ATTEMPTS_PER_INCIDENT) {
    if (!state.exhaustedNotified) {
      const message = `ESPHome Controller sigue desconectado tras ${state.attemptsInIncident} reinicios automáticos`;
      state = appendEvent(state, 'EXHAUSTED', message, now);
      state = { ...state, exhaustedNotified: true };
      await emitEvent(state, message, now);
    } else {
      await persistState(state);
    }
    console.log('RECOVERY exhausted: intervención manual necesaria');
    return;
  }

  if (state.lastRestartTs > 0 && now - state.lastRestartTs < RESTART_COOLDOWN_MS) {
    await persistState(state);
    console.log('RECOVERY cooldown activo');
    return;
  }

  let controller;
  try {
    controller = await findControllerApp();
  } catch (error) {
    const message = `No se puede reiniciar ESPHome Controller: ${error.message}`;
    state = appendEvent(state, 'CONFIG_ERROR', message, now);
    await emitEvent(state, message, now);
    console.log(message);
    return;
  }

  const attempt = state.attemptsInIncident + 1;
  const requestedMessage = `Reinicio automático ${attempt}/${MAX_ATTEMPTS_PER_INCIDENT} de ESPHome Controller solicitado`;
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

  // El intento queda persistido antes de modificar el estado de la app.
  await persistState(state);

  try {
    await Homey.apps.restartApp({ id: controller.id });
    await setLogicValue(VAR.message, requestedMessage, 'string');
    await setLogicValue(VAR.trigger, now, 'number');
    console.log(requestedMessage);
  } catch (error) {
    const message = `Falló el reinicio automático de ESPHome Controller: ${error.message}`;
    state = appendEvent(state, 'RESTART_FAILED', message, Date.now(), { attempt });
    state = { ...state, awaitingRecovery: false };
    await emitEvent(state, message, Date.now());
    console.log(message);
  }
}

const action = typeof args?.[0] === 'string' ? args[0].trim().toLowerCase() : 'status';

if (action === 'check') {
  await check();
} else if (action === 'status') {
  await status();
} else {
  throw new Error(`Acción no soportada: ${action}`);
}
