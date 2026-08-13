'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const SchedulerConfigStore = require('../lib/scheduler-config-store');

function createHomeyMock() {
  const values = new Map();
  return {
    values,
    settings: {
      get(key) {
        return values.get(key);
      },
      set(key, value) {
        values.set(key, value);
      },
    },
  };
}

test('stores Rama 2 scheduler config under an isolated settings key', async () => {
  const homey = createHomeyMock();
  const store = new SchedulerConfigStore(homey);

  const status = await store.saveConfig({
    enabled: true,
    startTime: '22:00',
    intervalDays: 1,
    sectorDurations: {
      1: 5,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    },
  });

  assert.equal(homey.values.has('schedulerConfig'), false);
  assert.equal(homey.values.has('schedulerConfigV2'), true);
  assert.equal(status.mode, 'SHADOW');
  assert.equal(status.shadow, true);
  assert.equal(status.canEmitProgramRequests, false);
  assert.equal(status.config.pendingRequest, null);
});

test('persists scheduler runtime markers under the isolated Rama 2 config key', async () => {
  const homey = createHomeyMock();
  const store = new SchedulerConfigStore(homey);

  await store.saveConfig({
    enabled: true,
    startTime: '22:00',
    intervalDays: 1,
    sectorDurations: {
      1: 5,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
    },
  });

  await store.markPendingRequest({
    requestId: 'request-1',
    runDate: '2026-07-18',
    requestedAt: 1721300000000,
    createdTs: 1721300000000,
  });

  assert.equal(homey.values.get('schedulerConfigV2').pendingRequest.requestId, 'request-1');

  await store.markRunDate('2026-07-18');

  assert.equal(homey.values.get('schedulerConfigV2').lastRunDate, '2026-07-18');
  assert.equal(homey.values.get('schedulerConfigV2').pendingRequest, null);
  assert.equal(homey.values.has('schedulerConfig'), false);
});
