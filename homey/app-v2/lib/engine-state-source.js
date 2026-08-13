'use strict';

function normalizeEngine(engine = {}) {
  return {
    state: String(engine.state || 'IDLE'),
    activeSector: Number(engine.activeSector) || 0,
    startTs: Number(engine.startTs) || 0,
    endTs: Number(engine.endTs) || 0,
    source: String(engine.source || 'none'),
    stopReason: String(engine.stopReason || 'none'),
    queue: Array.isArray(engine.queue) ? engine.queue : [],
    history: Array.isArray(engine.history) ? engine.history : [],
    lastTickTs: Number(engine.lastTickTs) || 0,
  };
}

async function readAppStateEngineSnapshot(appStateStore) {
  if (!appStateStore) return null;

  const engine = typeof appStateStore.getEngineState === 'function'
    ? await appStateStore.getEngineState()
    : (await appStateStore.getState())?.engine;
  return {
    ...normalizeEngine(engine),
    sourceStore: 'appStateV2.engine',
  };
}

async function readEngineSnapshot({
  appStateStore = null,
}) {
  const snapshot = await readAppStateEngineSnapshot(appStateStore);
  return snapshot || {
    ...normalizeEngine(),
    sourceStore: 'appStateV2.engine',
  };
}

async function readLatestEngineHistoryEntry(options) {
  const snapshot = await readEngineSnapshot(options);
  return {
    entry: snapshot.history[0] || null,
    sourceStore: snapshot.sourceStore,
  };
}

module.exports = {
  normalizeEngine,
  readEngineSnapshot,
  readLatestEngineHistoryEntry,
};
