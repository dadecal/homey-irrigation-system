'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const MotorConfirmationStore = require('../lib/motor-confirmation-store');

function createHomey() {
  return {
    app: {
      error() {},
    },
  };
}

function createStore({
  appStateEngine = null,
} = {}) {
  return new MotorConfirmationStore({
    homey: createHomey(),
    appStateStore: appStateEngine
      ? {
        async getEngineState() {
          return appStateEngine;
        },
      }
      : null,
  });
}

test('confirms a pending request from appState engine while engine is in diagnostic mode', async () => {
  const requestedAt = Date.parse('2026-07-02T05:31:00Z');
  const store = createStore({
    appStateEngine: {
      state: 'RUNNING',
      source: 'SCHEDULER',
      startTs: requestedAt + 5000,
      history: [],
    },
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.reason, 'ENGINE_RUNNING');
  assert.equal(confirmation.sourceStore, 'appStateV2.engine');
});

test('confirms a pending request from appState engine while engine is active', async () => {
  const requestedAt = Date.parse('2026-07-25T21:50:29Z');
  const store = createStore({
    appStateEngine: {
      state: 'RUNNING',
      source: 'SCHEDULER',
      startTs: requestedAt + 5000,
      history: [],
    },
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.reason, 'ENGINE_RUNNING');
  assert.equal(confirmation.sourceStore, 'appStateV2.engine');
});

test('confirms a pending request from appState engine history after native completion', async () => {
  const requestedAt = Date.parse('2026-07-25T21:50:29Z');
  const store = createStore({
    appStateEngine: {
      state: 'IDLE',
      source: 'SCHEDULER',
      startTs: 0,
      history: [
        {
          id: 'history-1',
          source: 'SCHEDULER',
          startTs: requestedAt + 5000,
        },
      ],
    },
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.reason, 'HISTORY_RECORDED');
  assert.equal(confirmation.historyId, 'history-1');
  assert.equal(confirmation.sourceStore, 'appStateV2.engine');
});

test('does not confirm an old scheduler state from appState engine', async () => {
  const requestedAt = Date.parse('2026-07-25T21:50:29Z');
  const store = createStore({
    appStateEngine: {
      state: 'RUNNING',
      source: 'SCHEDULER',
      startTs: requestedAt - 120000,
      history: [],
    },
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, false);
  assert.equal(confirmation.sourceStore, 'appStateV2.engine');
});
