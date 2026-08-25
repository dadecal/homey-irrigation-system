'use strict';

const { SETTING } = require('./constants');

const MAX_EVENTS = 150;
const MAX_ENGINE_HISTORY = 25;
const MAX_ENGINE_TICK_DIAGNOSTICS = 240;
const MAX_ENGINE_ACTION_DIAGNOSTICS = 80;

function createDefaultEngineState() {
  return {
    version: 1,
    state: 'IDLE',
    activeSector: 0,
    startTs: 0,
    endTs: 0,
    source: 'none',
    stopReason: 'none',
    queue: [],
    history: [],
    tickDiagnostics: [],
    actionDiagnostics: [],
    lastTickTs: 0,
    lastHistoryTriggerTs: 0,
    lastSectorEvent: null,
    interruption: null,
    updatedTs: 0,
  };
}

function createDefaultState() {
  return {
    version: 1,
    updatedTs: 0,
    health: null,
    recovery: null,
    history: {
      lastProjectedEventId: null,
      lastProjection: null,
    },
    engine: createDefaultEngineState(),
    events: [],
  };
}

function normalizeEngineState(input) {
  const defaults = createDefaultEngineState();
  const stored = input && typeof input === 'object' ? input : {};

  return {
    ...defaults,
    ...stored,
    state: String(stored.state || defaults.state),
    activeSector: Number(stored.activeSector) || 0,
    startTs: Number(stored.startTs) || 0,
    endTs: Number(stored.endTs) || 0,
    source: String(stored.source || defaults.source),
    stopReason: String(stored.stopReason || defaults.stopReason),
    queue: Array.isArray(stored.queue) ? stored.queue : defaults.queue,
    history: Array.isArray(stored.history) ? stored.history : defaults.history,
    tickDiagnostics: Array.isArray(stored.tickDiagnostics)
      ? stored.tickDiagnostics
      : defaults.tickDiagnostics,
    actionDiagnostics: Array.isArray(stored.actionDiagnostics)
      ? stored.actionDiagnostics
      : defaults.actionDiagnostics,
    lastTickTs: Number(stored.lastTickTs) || 0,
    lastHistoryTriggerTs: Number(stored.lastHistoryTriggerTs) || 0,
    lastSectorEvent: stored.lastSectorEvent && typeof stored.lastSectorEvent === 'object'
      ? stored.lastSectorEvent
      : defaults.lastSectorEvent,
    interruption: stored.interruption && typeof stored.interruption === 'object'
      ? stored.interruption
      : defaults.interruption,
    updatedTs: Number(stored.updatedTs) || 0,
  };
}

function normalizeState(input) {
  const defaults = createDefaultState();
  const stored = input && typeof input === 'object' ? input : {};
  const history = stored.history && typeof stored.history === 'object'
    ? stored.history
    : {};

  return {
    ...defaults,
    ...stored,
    history: {
      ...defaults.history,
      ...history,
    },
    engine: normalizeEngineState(stored.engine),
    events: Array.isArray(stored.events) ? stored.events : defaults.events,
  };
}

class AppStateStore {
  constructor(homey, { now = () => Date.now() } = {}) {
    this.settings = homey.settings;
    this.now = now;
  }

  async getState() {
    return normalizeState(this.settings.get(SETTING.appState));
  }

  async setState(nextState) {
    const state = normalizeState({
      ...nextState,
      updatedTs: this.now(),
    });
    this.settings.set(SETTING.appState, state);
    return state;
  }

  async update(mutator) {
    const current = await this.getState();
    const next = await mutator(current);
    return this.setState(next);
  }

  async setHealth(health) {
    return this.update(state => ({
      ...state,
      health,
    }));
  }

  async setRecovery(recovery) {
    return this.update(state => ({
      ...state,
      recovery,
    }));
  }

  async appendEvent(event) {
    return this.update(state => ({
      ...state,
      events: [
        event,
        ...state.events,
      ].slice(0, MAX_EVENTS),
    }));
  }

  async setHistoryProjection({ lastProjectedEventId, lastProjection }) {
    return this.update(state => ({
      ...state,
      history: {
        ...state.history,
        lastProjectedEventId,
        lastProjection,
      },
    }));
  }

  async getEngineState() {
    const state = await this.getState();
    return state.engine;
  }

  async updateEngine(mutator) {
    let nextEngine = null;
    await this.update(async state => {
      nextEngine = normalizeEngineState(await mutator(state.engine));
      nextEngine.updatedTs = this.now();
      return {
        ...state,
        engine: nextEngine,
      };
    });
    return nextEngine;
  }

  async setEngineValues(values = {}) {
    return this.updateEngine(engine => ({
      ...engine,
      ...Object.fromEntries(Object.entries(values)
        .filter(([, value]) => value !== undefined)),
    }));
  }

  async setEngineQueue(queue = []) {
    return this.updateEngine(engine => ({
      ...engine,
      queue: Array.isArray(queue) ? queue : [],
    }));
  }

  async clearEngineQueue() {
    return this.setEngineQueue([]);
  }

  async appendEngineHistory(entry) {
    return this.updateEngine(engine => ({
      ...engine,
      history: [
        entry,
        ...engine.history,
      ].slice(0, MAX_ENGINE_HISTORY),
    }));
  }

  async setEngineLastTick(ts) {
    return this.setEngineValues({ lastTickTs: Number(ts) || 0 });
  }

  async appendEngineTickDiagnostic(entry) {
    if (!entry || typeof entry !== 'object') {
      return this.getEngineState();
    }

    return this.updateEngine(engine => ({
      ...engine,
      tickDiagnostics: [
        entry,
        ...engine.tickDiagnostics,
      ].slice(0, MAX_ENGINE_TICK_DIAGNOSTICS),
    }));
  }

  async appendEngineActionDiagnostic(entry) {
    if (!entry || typeof entry !== 'object') {
      return this.getEngineState();
    }

    return this.updateEngine(engine => ({
      ...engine,
      actionDiagnostics: [
        entry,
        ...engine.actionDiagnostics,
      ].slice(0, MAX_ENGINE_ACTION_DIAGNOSTICS),
    }));
  }

  async emitEngineHistoryTrigger(entryId, ts = this.now()) {
    return this.updateEngine(engine => ({
      ...engine,
      lastHistoryTriggerTs: ts,
      lastHistoryEntryId: entryId || null,
    }));
  }

  async emitEngineSectorEvent(type, message, ts = this.now()) {
    return this.updateEngine(engine => ({
      ...engine,
      lastSectorEvent: {
        type,
        message: message || '',
        ts,
      },
    }));
  }
}

module.exports = {
  AppStateStore,
  createDefaultEngineState,
  createDefaultState,
  normalizeEngineState,
  normalizeState,
};
