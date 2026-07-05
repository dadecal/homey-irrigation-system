'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildQueue, Scheduler } = require('../lib/scheduler');

test('builds an ordered queue and excludes zero-duration sectors', () => {
  assert.deepEqual(buildQueue({
    sectorDurations: { 3: 8, 1: 10, 2: 0, 6: 4, 4: 0, 5: 0 },
  }), [
    { sector: 1, duration: 10 },
    { sector: 3, duration: 8 },
    { sector: 6, duration: 4 },
  ]);
});

test('persists the run date before emitting the request', async () => {
  const events = [];
  const config = {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 4, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    updatedTs: Date.parse('2026-07-02T04:00:00Z'),
  };
  const scheduler = new Scheduler({
    homey: {
      app: {
        log() {},
        error() {},
      },
    },
    configStore: {
      async getConfig() {
        return config;
      },
      async markRunDate(runDate) {
        events.push(`persist:${runDate}`);
      },
    },
    programRequestTrigger: {
      async trigger(queue) {
        events.push(`trigger:${JSON.stringify(queue)}`);
        return { requestId: 'request-1' };
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:31:00Z'));

  assert.equal(result.due, true);
  assert.deepEqual(events, [
    'persist:2026-07-02',
    'trigger:[{"sector":1,"duration":5},{"sector":3,"duration":4}]',
  ]);
});

test('does not emit when the configuration is disabled', async () => {
  let triggered = false;
  const scheduler = new Scheduler({
    homey: { app: { log() {}, error() {} } },
    configStore: {
      async getConfig() {
        return { enabled: false };
      },
    },
    programRequestTrigger: {
      async trigger() {
        triggered = true;
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate();
  assert.equal(result.due, undefined);
  assert.equal(triggered, false);
});
