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

test('stores a pending request after emitting it and waits for engine confirmation', async () => {
  const events = [];
  const config = {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 4, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: null,
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
      async markPendingRequest(pendingRequest) {
        events.push(`pending:${pendingRequest.runDate}:${pendingRequest.requestId}`);
        config.pendingRequest = pendingRequest;
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
      async getConfirmation() {
        return { confirmed: false };
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:31:00Z'));

  assert.equal(result.due, true);
  assert.deepEqual(events, [
    'create:2026-07-02:[{"sector":1,"duration":5},{"sector":3,"duration":4}]',
    'pending:2026-07-02:request-1',
    'trigger:request-1',
  ]);
});

test('persists the run date when a pending request is confirmed by the engine', async () => {
  const events = [];
  const config = {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: {
      requestId: 'request-1',
      runDate: '2026-07-02',
      requestedAt: Date.parse('2026-07-02T05:31:00Z'),
      createdTs: Date.parse('2026-07-02T05:31:00Z'),
    },
    updatedTs: Date.parse('2026-07-02T04:00:00Z'),
  };
  const scheduler = new Scheduler({
    homey: { app: { log() {}, error() {} } },
    configStore: {
      async getConfig() {
        return config;
      },
      async markRunDate(runDate) {
        events.push(`persist:${runDate}`);
        config.lastRunDate = runDate;
        config.pendingRequest = null;
      },
    },
    programRequestTrigger: {
      createRequest() {
        throw new Error('should not create a new request');
      },
    },
    motorConfirmationStore: {
      async getConfirmation(pendingRequest) {
        events.push(`confirm:${pendingRequest.requestId}`);
        return { confirmed: true, reason: 'ENGINE_RUNNING' };
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:32:00Z'));

  assert.equal(result.confirmation.confirmed, true);
  assert.deepEqual(events, ['confirm:request-1', 'persist:2026-07-02']);
});

test('does not persist the run date while a pending request is unconfirmed', async () => {
  const events = [];
  const config = {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: {
      requestId: 'request-1',
      runDate: '2026-07-02',
      requestedAt: Date.parse('2026-07-02T05:31:00Z'),
      createdTs: Date.parse('2026-07-02T05:31:00Z'),
    },
    updatedTs: Date.parse('2026-07-02T04:00:00Z'),
  };
  const scheduler = new Scheduler({
    homey: { app: { log() {}, error() {} } },
    configStore: {
      async getConfig() {
        return config;
      },
      async markRunDate(runDate) {
        events.push(`persist:${runDate}`);
      },
    },
    programRequestTrigger: {
      createRequest() {
        throw new Error('should not create a new request');
      },
    },
    motorConfirmationStore: {
      async getConfirmation(pendingRequest) {
        events.push(`confirm:${pendingRequest.requestId}`);
        return { confirmed: false, reason: 'NOT_CONFIRMED' };
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:32:00Z'));

  assert.equal(result.pendingRequest.requestId, 'request-1');
  assert.deepEqual(events, ['confirm:request-1']);
});

test('reports an error when a pending request cannot be checked', async () => {
  const events = [];
  const config = {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: {
      requestId: 'request-1',
      runDate: '2026-07-02',
      requestedAt: Date.parse('2026-07-02T05:31:00Z'),
      createdTs: Date.parse('2026-07-02T05:31:00Z'),
    },
    updatedTs: Date.parse('2026-07-02T04:00:00Z'),
  };
  const scheduler = new Scheduler({
    homey: {
      app: {
        log() {},
        error(message) {
          events.push(`error:${message}`);
        },
      },
    },
    configStore: {
      async getConfig() {
        return config;
      },
      async markRunDate(runDate) {
        events.push(`persist:${runDate}`);
      },
      async clearPendingRequest() {
        events.push('clear-pending');
      },
    },
    programRequestTrigger: {
      createRequest() {
        throw new Error('should not create a new request');
      },
    },
    motorConfirmationStore: {
      async getConfirmation() {
        throw new Error('Missing Scopes');
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate(Date.parse('2026-07-02T05:42:00Z'));

  assert.equal(result.status, 'ERROR');
  assert.match(result.message, /Missing Scopes/);
  assert.equal(scheduler.getDiagnostic().lastError.pendingRequest.requestId, 'request-1');
  assert.deepEqual(events, [
    'error:No se pudo confirmar la solicitud pendiente: Missing Scopes',
  ]);
});

test('does not persist the run date when the request cannot be emitted', async () => {
  const events = [];
  const config = {
    enabled: true,
    startTime: '07:30',
    intervalDays: 1,
    sectorDurations: { 1: 5, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 },
    rainDelayUntil: 0,
    lastRunDate: null,
    pendingRequest: null,
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
      async markPendingRequest(pendingRequest) {
        events.push(`pending:${pendingRequest.requestId}`);
        config.pendingRequest = pendingRequest;
      },
      async clearPendingRequest() {
        events.push('clear-pending');
        config.pendingRequest = null;
      },
    },
    programRequestTrigger: {
      createRequest(queue, metadata) {
        return {
          version: 1,
          requestId: 'request-1',
          requestedAt: Date.parse('2026-07-02T05:31:00Z'),
          runDate: metadata.runDate,
          source: 'SCHEDULER',
          queue,
        };
      },
      async triggerRequest() {
        events.push('trigger:failed');
        throw new Error('Flow trigger unavailable');
      },
    },
    motorConfirmationStore: {
      async getConfirmation() {
        return { confirmed: false };
      },
    },
    timeZone: 'Europe/Madrid',
  });

  await assert.rejects(
    () => scheduler.evaluate(Date.parse('2026-07-02T05:31:00Z')),
    /Flow trigger unavailable/,
  );
  assert.deepEqual(events, ['pending:request-1', 'trigger:failed', 'clear-pending']);
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
    motorConfirmationStore: {
      async getConfirmation() {
        return { confirmed: false };
      },
    },
    timeZone: 'Europe/Madrid',
  });

  const result = await scheduler.evaluate();
  assert.equal(result.due, undefined);
  assert.equal(triggered, false);
});
