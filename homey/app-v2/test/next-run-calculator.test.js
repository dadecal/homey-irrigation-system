'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { STATUS } = require('../lib/constants');
const { calculateNextRun } = require('../lib/next-run-calculator');

const TIME_ZONE = 'Europe/Madrid';

function config(overrides = {}) {
  return {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    updatedTs: Date.parse('2026-07-02T04:00:00Z'),
    ...overrides,
  };
}

test('calculates the first run in the Homey timezone', () => {
  const result = calculateNextRun(
    config(),
    Date.parse('2026-07-02T05:00:00Z'),
    TIME_ZONE,
  );

  assert.equal(result.nextRunTs, Date.parse('2026-07-02T05:30:00Z'));
  assert.equal(result.runDate, '2026-07-02');
  assert.equal(result.due, false);
});

test('marks todays program due after its start time', () => {
  const result = calculateNextRun(
    config(),
    Date.parse('2026-07-02T05:31:00Z'),
    TIME_ZONE,
  );

  assert.equal(result.runDate, '2026-07-02');
  assert.equal(result.due, true);
});

test('respects interval days from the last generated program', () => {
  const result = calculateNextRun(
    config({ intervalDays: 2, lastRunDate: '2026-07-02' }),
    Date.parse('2026-07-03T12:00:00Z'),
    TIME_ZONE,
  );

  assert.equal(result.runDate, '2026-07-04');
  assert.equal(result.nextRunTs, Date.parse('2026-07-04T05:30:00Z'));
  assert.equal(result.due, false);
});

test('advances missed interval dates without changing the cadence', () => {
  const result = calculateNextRun(
    config({ intervalDays: 2, lastRunDate: '2026-06-30' }),
    Date.parse('2026-07-04T06:00:00Z'),
    TIME_ZONE,
  );

  assert.equal(result.runDate, '2026-07-04');
  assert.equal(result.due, true);
});

test('rain delay skips scheduled starts before its end', () => {
  const result = calculateNextRun(
    config({ rainDelayUntil: Date.parse('2026-07-03T08:00:00Z') }),
    Date.parse('2026-07-02T06:00:00Z'),
    TIME_ZONE,
  );

  assert.equal(result.status, STATUS.RAIN_DELAY);
  assert.equal(result.runDate, '2026-07-04');
  assert.equal(result.nextRunTs, Date.parse('2026-07-04T05:30:00Z'));
  assert.equal(result.due, false);
});

test('handles Madrid daylight saving time when converting local start time', () => {
  const result = calculateNextRun(
    config({
      lastRunDate: '2026-10-24',
      updatedTs: Date.parse('2026-10-24T04:00:00Z'),
    }),
    Date.parse('2026-10-24T12:00:00Z'),
    TIME_ZONE,
  );

  assert.equal(result.runDate, '2026-10-25');
  assert.equal(result.nextRunTs, Date.parse('2026-10-25T06:30:00Z'));
});
