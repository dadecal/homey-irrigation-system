'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AppStateStore, createDefaultState } = require('../lib/app-state-store');

const NOW = 1721300500000;

function createHomeyMock(initial = new Map()) {
  return {
    values: initial,
    settings: {
      get(key) {
        return initial.get(key);
      },
      set(key, value) {
        initial.set(key, value);
      },
    },
  };
}

test('stores internal Rama 2 state under an isolated settings key', async () => {
  const homey = createHomeyMock();
  const store = new AppStateStore(homey, { now: () => NOW });

  const state = await store.setHealth({
    status: 'OK',
    updatedTs: NOW,
  });

  assert.equal(homey.values.has('appState'), false);
  assert.equal(homey.values.has('appStateV2'), true);
  assert.equal(state.updatedTs, NOW);
  assert.equal(state.health.status, 'OK');
});

test('normalizes missing internal state fields', async () => {
  const homey = createHomeyMock(new Map([
    ['appStateV2', { health: { status: 'WARNING' } }],
  ]));
  const store = new AppStateStore(homey, { now: () => NOW });

  const state = await store.getState();

  assert.equal(state.version, createDefaultState().version);
  assert.equal(state.health.status, 'WARNING');
  assert.equal(state.history.lastProjectedEventId, null);
  assert.equal(state.engine.state, 'IDLE');
  assert.equal(state.engine.activeSector, 0);
  assert.deepEqual(state.engine.queue, []);
  assert.deepEqual(state.engine.history, []);
  assert.deepEqual(state.engine.tickDiagnostics, []);
  assert.deepEqual(state.engine.actionDiagnostics, []);
  assert.deepEqual(state.events, []);
});

test('persists native engine state inside app state', async () => {
  const homey = createHomeyMock();
  const store = new AppStateStore(homey, { now: () => NOW });

  await store.setEngineValues({
    state: 'RUNNING',
    activeSector: 3,
    startTs: NOW,
    endTs: NOW + 10 * 60 * 1000,
    source: 'MANUAL',
  });
  await store.setEngineQueue([{ sector: 4, duration: 5 }]);
  await store.setEngineLastTick(NOW + 1000);
  await store.appendEngineTickDiagnostic({
    ts: NOW + 1500,
    tickDecision: { decision: 'UPDATE_RUNNING' },
  });
  await store.appendEngineActionDiagnostic({
    ts: NOW + 1700,
    action: 'programStart',
  });
  await store.appendEngineHistory({ id: 'entry-1', sector: 3 });
  await store.emitEngineSectorEvent('sectorStart', 'Iniciado sector 3', NOW + 2000);

  const engine = await store.getEngineState();

  assert.equal(engine.state, 'RUNNING');
  assert.equal(engine.activeSector, 3);
  assert.equal(engine.queue.length, 1);
  assert.equal(engine.history[0].id, 'entry-1');
  assert.equal(engine.lastTickTs, NOW + 1000);
  assert.equal(engine.tickDiagnostics[0].tickDecision.decision, 'UPDATE_RUNNING');
  assert.equal(engine.actionDiagnostics[0].action, 'programStart');
  assert.equal(engine.lastSectorEvent.type, 'sectorStart');
});

test('keeps only the latest native engine tick diagnostics', async () => {
  const homey = createHomeyMock();
  const store = new AppStateStore(homey, { now: () => NOW });

  for (let index = 0; index < 245; index += 1) {
    await store.appendEngineTickDiagnostic({
      ts: NOW + index,
      tickDecision: { decision: `decision-${index}` },
    });
  }

  const engine = await store.getEngineState();

  assert.equal(engine.tickDiagnostics.length, 240);
  assert.equal(engine.tickDiagnostics[0].tickDecision.decision, 'decision-244');
  assert.equal(engine.tickDiagnostics[239].tickDecision.decision, 'decision-5');
});

test('keeps only the latest native engine action diagnostics', async () => {
  const homey = createHomeyMock();
  const store = new AppStateStore(homey, { now: () => NOW });

  for (let index = 0; index < 85; index += 1) {
    await store.appendEngineActionDiagnostic({
      ts: NOW + index,
      action: `action-${index}`,
    });
  }

  const engine = await store.getEngineState();

  assert.equal(engine.actionDiagnostics.length, 80);
  assert.equal(engine.actionDiagnostics[0].action, 'action-84');
  assert.equal(engine.actionDiagnostics[79].action, 'action-5');
});

test('persists history projection inside app state', async () => {
  const homey = createHomeyMock();
  const store = new AppStateStore(homey, { now: () => NOW });

  const state = await store.setHistoryProjection({
    lastProjectedEventId: 'event-1',
    lastProjection: {
      sector: 2,
      durationMin: 15,
    },
  });

  assert.equal(state.history.lastProjectedEventId, 'event-1');
  assert.equal(state.history.lastProjection.sector, 2);
});

test('keeps only the latest internal events', async () => {
  const homey = createHomeyMock();
  const store = new AppStateStore(homey, { now: () => NOW });

  for (let index = 0; index < 155; index += 1) {
    await store.appendEvent({ type: 'health.transition', ts: NOW + index, message: `event-${index}` });
  }

  const state = await store.getState();

  assert.equal(state.events.length, 150);
  assert.equal(state.events[0].message, 'event-154');
  assert.equal(state.events[149].message, 'event-5');
});
