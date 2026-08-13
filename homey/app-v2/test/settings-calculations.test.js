'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateEndTime, snapshotConfig } = require('../settings/settings-calculations');

test('calculates the estimated end time from all sector durations', () => {
  assert.deepEqual(calculateEndTime('07:30', { 1: 10, 2: 5, 3: 0, 4: 20 }), {
    time: '08:05', daysLater: 0, durationMinutes: 35,
  });
});

test('marks an estimated end time on the following day', () => {
  assert.deepEqual(calculateEndTime('23:50', { 1: 20 }), {
    time: '00:10', daysLater: 1, durationMinutes: 20,
  });
});

test('creates a stable snapshot for persisted form fields', () => {
  const config = {
    enabled: true,
    notifySectorStart: true,
    notifySectorEnd: false,
    startTime: '07:30',
    intervalDays: 2,
    sectorDurations: { 1: 10 },
  };
  assert.equal(snapshotConfig(config), snapshotConfig({
    ...config,
    updatedTs: Date.now(),
    sectorDurations: { '1': 10, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
  }));
});
