'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODE, SERVICE } = require('../lib/constants');
const { buildQueue, Scheduler, PREFLIGHT_RETRY_WINDOW_MS } = require('../lib/scheduler');

function dueConfig(overrides = {}) {
  return {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 4, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: null,
    preflightBlock: null,
    updatedTs: Date.parse('2026-07-02T04:00:00Z'),
    ...overrides,
  };
}

function createScheduler({
  mode = MODE.SHADOW,
  config = dueConfig(),
  events = [],
  preflightService = null,
  appStateStore = null,
} = {}) {
  const scheduler = new Scheduler({
    homey: {
      app: {
        log(message) {
          events.push(`log:${message}`);
        },
        error(message) {
          events.push(`error:${message}`);
        },
      },
    },
    configStore: {
      async getConfig() {
        return config;
      },
      async getStatus() {
        return {
          config,
          mode: MODE.SHADOW,
          shadow: true,
          canEmitProgramRequests: false,
        };
      },
      async markPendingRequest(pendingRequest) {
        events.push(`pending:${pendingRequest.runDate}:${pendingRequest.requestId}`);
        config.pendingRequest = pendingRequest;
        config.preflightBlock = null;
      },
      async markRunDate(runDate) {
        events.push(`persist:${runDate}`);
        config.lastRunDate = runDate;
        config.pendingRequest = null;
        config.preflightBlock = null;
      },
      async clearPendingRequest() {
        events.push('clear-pending');
        config.pendingRequest = null;
      },
      async markPreflightBlock(preflightBlock) {
        events.push(`preflight:${preflightBlock.runDate}:${preflightBlock.code}:${preflightBlock.attempts}`);
        config.preflightBlock = preflightBlock;
      },
      async clearPreflightBlock() {
        events.push('clear-preflight');
        config.preflightBlock = null;
      },
    },
    controlStore: {
      async getControl() {
        return {
          services: {
            [SERVICE.SCHEDULER]: mode,
          },
        };
      },
    },
    programRequestTrigger: {
      createRequest(queue, metadata) {
        events.push(`create:${metadata.runDate}:${JSON.stringify(queue)}`);
        return {
          version: 1,
          requestId: 'request-1',
          requestedAt: Date.parse('2026-07-02T05:31:00Z'),
          runDate: metadata.runDate,
          source: 'SCHEDULER',
          queue,
        };
      },
      async triggerRequest(request) {
        events.push(`trigger:${request.requestId}`);
        return request;
      },
    },
    motorConfirmationStore: {
      async getConfirmation(pendingRequest) {
        events.push(`confirm:${pendingRequest.requestId}`);
        return { confirmed: false, reason: 'NOT_CONFIRMED' };
      },
    },
    preflightService,
    appStateStore,
    timeZone: 'Europe/Madrid',
  });

  return scheduler;
}

test('builds an ordered queue and excludes zero-duration sectors', () => {
  assert.deepEqual(buildQueue({
    sectorDurations: { 3: 8, 1: 10, 2: 0, 6: 4, 4: 0, 5: 0 },
  }), [
    { sector: 1, duration: 10 },
    { sector: 3, duration: 8 },
    { sector: 6, duration: 4 },
  ]);
});

test('does not emit due requests while scheduler migration is in SHADOW mode', async () => {
  const events = [];
  const scheduler = createScheduler({ mode: MODE.SHADOW, events });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:31:00Z'));

  assert.equal(result.mode, MODE.SHADOW);
  assert.equal(result.due, true);
  assert.equal(result.canEmitProgramRequests, false);
  assert.deepEqual(events, []);
});

test('stores a pending request after emitting it in ACTIVE_COMPAT mode', async () => {
  const events = [];
  const config = dueConfig();
  const scheduler = createScheduler({ mode: MODE.ACTIVE_COMPAT, config, events });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:31:00Z'));

  assert.equal(result.mode, MODE.ACTIVE_COMPAT);
  assert.equal(result.due, true);
  assert.equal(result.canEmitProgramRequests, true);
  assert.deepEqual(events, [
    'create:2026-07-02:[{"sector":1,"duration":5},{"sector":3,"duration":4}]',
    'pending:2026-07-02:request-1',
    'trigger:request-1',
    'log:Scheduler v2 request emitted requestId=request-1 runDate=2026-07-02; awaiting engine confirmation',
  ]);
  assert.equal(config.pendingRequest.requestId, 'request-1');
});

test('persists the run date only when a pending request is confirmed', async () => {
  const events = [];
  const config = dueConfig({
    pendingRequest: {
      requestId: 'request-1',
      runDate: '2026-07-02',
      requestedAt: Date.parse('2026-07-02T05:31:00Z'),
      createdTs: Date.parse('2026-07-02T05:31:00Z'),
    },
  });
  const scheduler = createScheduler({ mode: MODE.ACTIVE_COMPAT, config, events });
  scheduler.motorConfirmationStore = {
    async getConfirmation(pendingRequest) {
      events.push(`confirm:${pendingRequest.requestId}`);
      return { confirmed: true, reason: 'ENGINE_RUNNING' };
    },
  };

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:32:00Z'));

  assert.equal(result.confirmation.confirmed, true);
  assert.equal(config.lastRunDate, '2026-07-02');
  assert.equal(config.pendingRequest, null);
  assert.deepEqual(events, [
    'confirm:request-1',
    'persist:2026-07-02',
    'log:Scheduler v2 request confirmed requestId=request-1 runDate=2026-07-02 reason=ENGINE_RUNNING',
  ]);
});

test('clears an unconfirmed pending request after the TTL without marking the run date', async () => {
  const events = [];
  const config = dueConfig({
    pendingRequest: {
      requestId: 'request-1',
      runDate: '2026-07-02',
      requestedAt: Date.parse('2026-07-02T05:31:00Z'),
      createdTs: Date.parse('2026-07-02T05:31:00Z'),
    },
  });
  const scheduler = createScheduler({ mode: MODE.ACTIVE_COMPAT, config, events });

  await scheduler.evaluate(Date.parse('2026-07-02T05:42:00Z'));

  assert.equal(config.lastRunDate, null);
  assert.equal(config.pendingRequest.requestId, 'request-1');
  assert.deepEqual(events, [
    'confirm:request-1',
    'clear-pending',
    'error:Scheduler v2 request not confirmed requestId=request-1 runDate=2026-07-02',
    'create:2026-07-02:[{"sector":1,"duration":5},{"sector":3,"duration":4}]',
    'pending:2026-07-02:request-1',
    'trigger:request-1',
    'log:Scheduler v2 request emitted requestId=request-1 runDate=2026-07-02; awaiting engine confirmation',
  ]);
});

test('blocks a due scheduled request when preflight is not safe', async () => {
  const events = [];
  const config = dueConfig();
  const appEvents = [];
  const scheduler = createScheduler({
    mode: MODE.ACTIVE_COMPAT,
    config,
    events,
    preflightService: {
      status() {
        return { lastResult: null };
      },
      async check() {
        events.push('check-preflight');
        return {
          allowed: false,
          code: 'RAW_UNAVAILABLE',
          message: 'ESPHome no esta disponible',
        };
      },
    },
    appStateStore: {
      async appendEvent(event) {
        appEvents.push(event);
      },
    },
  });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:31:00Z'));

  assert.equal(result.preflight.allowed, false);
  assert.equal(config.pendingRequest, null);
  assert.equal(config.preflightBlock.code, 'RAW_UNAVAILABLE');
  assert.deepEqual(events, [
    'check-preflight',
    'preflight:2026-07-02:RAW_UNAVAILABLE:1',
    'log:Scheduler v2 preflight blocked runDate=2026-07-02 code=RAW_UNAVAILABLE',
  ]);
  assert.equal(appEvents[0].status, 'PREFLIGHT_BLOCKED');
});

test('clears a preflight block when the scheduled request becomes safe again', async () => {
  const events = [];
  const appEvents = [];
  const config = dueConfig({
    preflightBlock: {
      runDate: '2026-07-02',
      firstBlockedTs: Date.parse('2026-07-02T05:31:00Z'),
      lastBlockedTs: Date.parse('2026-07-02T05:31:00Z'),
      attempts: 1,
      code: 'RAW_UNAVAILABLE',
      message: 'ESPHome no esta disponible',
    },
  });
  const scheduler = createScheduler({
    mode: MODE.ACTIVE_COMPAT,
    config,
    events,
    preflightService: {
      status() {
        return { lastResult: null };
      },
      async check() {
        events.push('check-preflight');
        return {
          allowed: true,
          code: 'OK',
          message: 'Preflight correcto',
        };
      },
    },
    appStateStore: {
      async appendEvent(event) {
        appEvents.push(event);
      },
    },
  });

  await scheduler.evaluate(Date.parse('2026-07-02T05:35:00Z'));

  assert.equal(config.preflightBlock, null);
  assert.equal(config.pendingRequest.requestId, 'request-1');
  assert.deepEqual(events, [
    'check-preflight',
    'clear-preflight',
    'create:2026-07-02:[{"sector":1,"duration":5},{"sector":3,"duration":4}]',
    'pending:2026-07-02:request-1',
    'trigger:request-1',
    'log:Scheduler v2 request emitted requestId=request-1 runDate=2026-07-02; awaiting engine confirmation',
  ]);
  assert.equal(appEvents[0].status, 'PREFLIGHT_RECOVERED');
});

test('cancels the run date after the preflight retry window expires', async () => {
  const events = [];
  const appEvents = [];
  const firstBlockedTs = Date.parse('2026-07-02T05:31:00Z');
  const config = dueConfig({
    preflightBlock: {
      runDate: '2026-07-02',
      firstBlockedTs,
      lastBlockedTs: firstBlockedTs,
      attempts: 2,
      code: 'RECOVERY_AWAITING',
      message: 'Recovery esta esperando recuperar ESPHome Controller',
    },
  });
  const scheduler = createScheduler({
    mode: MODE.ACTIVE_COMPAT,
    config,
    events,
    preflightService: {
      status() {
        return { lastResult: null };
      },
      async check() {
        events.push('check-preflight');
        return {
          allowed: false,
          code: 'RECOVERY_AWAITING',
          message: 'Recovery esta esperando recuperar ESPHome Controller',
        };
      },
    },
    appStateStore: {
      async appendEvent(event) {
        appEvents.push(event);
      },
    },
  });

  const result = await scheduler.evaluate(firstBlockedTs + PREFLIGHT_RETRY_WINDOW_MS + 1000);

  assert.equal(result.status, 'ERROR');
  assert.equal(config.lastRunDate, '2026-07-02');
  assert.equal(config.pendingRequest, null);
  assert.equal(config.preflightBlock, null);
  assert.deepEqual(events, [
    'check-preflight',
    'persist:2026-07-02',
    'error:Scheduler v2 preflight cancelled runDate=2026-07-02 code=RECOVERY_AWAITING',
  ]);
  assert.equal(appEvents[0].status, 'PREFLIGHT_CANCELLED');
});
