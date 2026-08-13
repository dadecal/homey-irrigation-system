'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  STATE,
  STOP_REASON,
  SOURCE,
  TICK_DECISION,
  buildHistoryEntry,
  buildManualQueue,
  buildSchedulerQueue,
  decideTick,
  normalizeProgramRequest,
  remainingMinutes,
  validateStart,
} = require('../lib/engine-contract');

test('validates sector and duration with the same boundaries as native engine', () => {
  assert.equal(validateStart(1, 1), null);
  assert.equal(validateStart(6, 30), null);
  assert.equal(validateStart(0, 5), 'Sector no valido: 0');
  assert.equal(validateStart(7, 5), 'Sector no valido: 7');
  assert.equal(validateStart(1, 0), 'Duracion no valida: 0 min');
  assert.equal(validateStart(1, 31), 'Duracion no valida: 31 min');
});

test('normalizes a scheduler program request and rejects invalid contracts', () => {
  const request = normalizeProgramRequest(JSON.stringify({
    version: 1,
    requestId: ' request-1 ',
    requestedAt: 1783627200000,
    source: SOURCE.SCHEDULER,
    queue: [
      { sector: '1', duration: '5' },
      { sector: 3, duration: 10 },
    ],
  }));

  assert.deepEqual(request, {
    version: 1,
    requestId: 'request-1',
    requestedAt: 1783627200000,
    source: SOURCE.SCHEDULER,
    queue: [
      { sector: 1, duration: 5 },
      { sector: 3, duration: 10 },
    ],
  });

  assert.throws(
    () => normalizeProgramRequest({ version: 2 }),
    /Version de solicitud no soportada/,
  );
  assert.throws(
    () => normalizeProgramRequest({
      version: 1,
      requestId: 'request-1',
      requestedAt: 1,
      source: SOURCE.SCHEDULER,
      queue: [{ sector: 2, duration: 5 }, { sector: 2, duration: 6 }],
    }),
    /aparece mas de una vez/,
  );
});

test('builds manual and scheduler queues using the native engine state shape', () => {
  assert.deepEqual(buildManualQueue({ sector: 2, duration: 7 }, {
    now: 1000,
    idSuffix: 'manual',
  }), [{
    id: '1000-manual',
    createdTs: 1000,
    sector: 2,
    duration: 7,
    source: SOURCE.MANUAL,
    description: 'Riego manual',
  }]);

  assert.deepEqual(buildSchedulerQueue({
    version: 1,
    requestId: 'request-1',
    requestedAt: 900,
    source: SOURCE.SCHEDULER,
    queue: [{ sector: 1, duration: 5 }, { sector: 4, duration: 12 }],
  }, {
    now: 1000,
  }), [
    {
      id: '1000-request-1-1',
      createdTs: 1000,
      sector: 1,
      duration: 5,
      source: SOURCE.SCHEDULER,
      description: 'Programa automatico request-1',
    },
    {
      id: '1000-request-1-2',
      createdTs: 1000,
      sector: 4,
      duration: 12,
      source: SOURCE.SCHEDULER,
      description: 'Programa automatico request-1',
    },
  ]);
});

test('calculates remaining minutes with the native ceil behavior', () => {
  assert.equal(remainingMinutes(61_000, 1_000), 1);
  assert.equal(remainingMinutes(62_000, 1_000), 2);
  assert.equal(remainingMinutes(1_000, 2_000), 0);
});

test('decides tick recovery when engine is idle but a relay is still on', () => {
  assert.deepEqual(decideTick({
    state: STATE.IDLE,
    anyRelayOn: true,
    now: 10_000,
  }), {
    decision: TICK_DECISION.FORCE_IDLE_WATCHDOG,
    reason: STOP_REASON.WATCHDOG,
  });
});

test('aborts a stale running sector before continuing the queue', () => {
  assert.deepEqual(decideTick({
    state: STATE.RUNNING,
    endTs: 60_000,
    activeSector: 3,
    anyRelayOn: true,
    startTs: 0,
    now: 181_001,
  }), {
    decision: TICK_DECISION.STALE_RUN_ABORT,
    reason: STOP_REASON.WATCHDOG,
    activeSector: 3,
    overdueMs: 121_001,
  });
});

test('keeps the start watchdog grace window before stopping a sector', () => {
  assert.equal(decideTick({
    state: STATE.RUNNING,
    endTs: 120_000,
    activeSector: 4,
    anyRelayOn: false,
    startTs: 10_000,
    now: 20_000,
  }).decision, TICK_DECISION.WATCHDOG_GRACE);

  assert.deepEqual(decideTick({
    state: STATE.RUNNING,
    endTs: 120_000,
    activeSector: 4,
    anyRelayOn: false,
    startTs: 10_000,
    now: 25_000,
  }), {
    decision: TICK_DECISION.STOP_WATCHDOG,
    reason: STOP_REASON.WATCHDOG,
    activeSector: 4,
  });
});

test('stops by timeout when a running sector reaches its planned end', () => {
  assert.deepEqual(decideTick({
    state: STATE.RUNNING,
    endTs: 60_000,
    activeSector: 6,
    anyRelayOn: true,
    startTs: 0,
    now: 60_000,
  }), {
    decision: TICK_DECISION.STOP_TIMEOUT,
    reason: STOP_REASON.TIMEOUT,
    activeSector: 6,
  });
});

test('builds history entries with rounded planned and real durations', () => {
  assert.deepEqual(buildHistoryEntry({
    activeSector: 5,
    source: SOURCE.SCHEDULER,
    reason: STOP_REASON.TIMEOUT,
    startTs: 1_000,
    plannedEndTs: 901_000,
    endTs: 916_000,
    liters: 12.34,
  }), {
    id: '916000-5',
    sector: 5,
    source: SOURCE.SCHEDULER,
    reason: STOP_REASON.TIMEOUT,
    startTs: 1_000,
    plannedEndTs: 901_000,
    endTs: 916_000,
    plannedDurationMin: 15,
    durationRealMin: 15,
    liters: 12.34,
  });
});
