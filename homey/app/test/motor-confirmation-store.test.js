'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const MotorConfirmationStore = require('../lib/motor-confirmation-store');

function createStore(values) {
  return new MotorConfirmationStore({
    app: {
      error() {},
    },
    logic: {
      async getVariables() {
        return Object.fromEntries(
          Object.entries(values).map(([name, value], index) => [
            `id-${index}`,
            { id: `id-${index}`, name, value },
          ]),
        );
      },
    },
  });
}

test('confirms a pending request when the engine is running a scheduler program', async () => {
  const requestedAt = Date.parse('2026-07-02T05:31:00Z');
  const store = createStore({
    'Irrigation.State': 'RUNNING',
    'Irrigation.Source': 'SCHEDULER',
    'Irrigation.StartTimestamp': requestedAt + 5000,
    'Irrigation.History': '[]',
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.reason, 'ENGINE_RUNNING');
});

test('confirms a pending request when scheduler history was recorded', async () => {
  const requestedAt = Date.parse('2026-07-02T05:31:00Z');
  const store = createStore({
    'Irrigation.State': 'IDLE',
    'Irrigation.Source': 'SCHEDULER',
    'Irrigation.StartTimestamp': 0,
    'Irrigation.History': JSON.stringify([
      {
        id: 'history-1',
        source: 'SCHEDULER',
        startTs: requestedAt + 5000,
      },
    ]),
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, true);
  assert.equal(confirmation.reason, 'HISTORY_RECORDED');
  assert.equal(confirmation.historyId, 'history-1');
});

test('does not confirm an old scheduler state', async () => {
  const requestedAt = Date.parse('2026-07-02T05:31:00Z');
  const store = createStore({
    'Irrigation.State': 'RUNNING',
    'Irrigation.Source': 'SCHEDULER',
    'Irrigation.StartTimestamp': requestedAt - 120000,
    'Irrigation.History': '[]',
  });

  const confirmation = await store.getConfirmation({
    requestId: 'request-1',
    requestedAt,
  });

  assert.equal(confirmation.confirmed, false);
});
