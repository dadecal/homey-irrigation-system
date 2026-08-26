'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { STOP_REASON, TICK_DECISION } = require('../lib/engine-contract');
const {
  buildForceIdlePlan,
  buildManualStartPreview,
  buildProgramStartPreview,
  buildStopPlan,
  buildTickDryRunTransaction,
} = require('../lib/engine-dry-run-adapters');

const NOW = 1784620000000;

function runningSnapshot(overrides = {}) {
  return {
    state: 'RUNNING',
    activeSector: 2,
    startTs: NOW - 5 * 60_000,
    endTs: NOW,
    source: 'MANUAL',
    stopReason: 'none',
    queue: [],
    activeRelays: [2],
    anyRelayOn: true,
    ...overrides,
  };
}

test('plans a timeout stop with hardware first', () => {
  const plan = buildStopPlan({
    snapshot: runningSnapshot({
      queue: [{ sector: 3, duration: 4 }],
    }),
    reason: STOP_REASON.TIMEOUT,
    now: NOW,
    liters: 12.3,
  });

  assert.equal(plan.type, 'stop');
  assert.equal(plan.dryRun, true);
  assert.equal(plan.historyEntry.id, `${NOW}-2`);
  assert.deepEqual(plan.steps.map(step => `${step.adapter}:${step.action}`), [
    'EspHomeIrrigationHardwareAdapter:setAllRelays',
    'EngineStateStore:appendHistory',
    'EngineStateStore:emitHistoryTrigger',
    'EngineStateStore:setValues',
    'EngineStateStore:emitSectorEvent',
  ]);
  assert.equal(plan.steps[0].value, false);
  assert.equal(plan.steps[1].entry.liters, 12.3);
});

test('plans a manual stop by clearing queue', () => {
  const plan = buildStopPlan({
    snapshot: runningSnapshot({
      queue: [{ sector: 3, duration: 4 }],
    }),
    reason: STOP_REASON.MANUAL,
    now: NOW,
    liters: 1.5,
  });

  assert.deepEqual(plan.steps.map(step => step.action), [
    'setAllRelays',
    'clearQueue',
    'appendHistory',
    'emitHistoryTrigger',
    'setValues',
    'emitSectorEvent',
  ]);
});

test('keeps active sector visible in the relay-stop failure plan', () => {
  const plan = buildStopPlan({
    snapshot: runningSnapshot({
      activeSector: 4,
      source: 'SCHEDULER',
    }),
    reason: STOP_REASON.WATCHDOG,
    now: NOW,
  });

  assert.deepEqual(plan.failurePlan.map(step => `${step.adapter}:${step.action}`), [
    'EngineStateStore:setValues',
  ]);
  assert.equal(plan.failurePlan[0].values.state, 'ERROR');
  assert.equal(plan.failurePlan[0].values.activeSector, 4);
  assert.equal(plan.failurePlan[0].values.stopReason, STOP_REASON.ERROR);
  assert.equal(plan.failurePlan[0].values.interruption.status, 'AWAITING_CONTROLLER');
  assert.equal(plan.failurePlan[0].values.interruption.sector, 4);
});

test('plans force idle with relay shutdown before clearing queue', () => {
  const plan = buildForceIdlePlan({
    snapshot: runningSnapshot({
      state: 'IDLE',
      activeSector: 0,
      queue: [{ sector: 1, duration: 3 }],
      source: 'MANUAL',
    }),
    reason: STOP_REASON.NONE,
  });

  assert.deepEqual(plan.steps.map(step => step.action), [
    'setAllRelays',
    'clearQueue',
    'setValues',
  ]);
  assert.equal(plan.steps[0].value, false);
});

test('plans force idle without hardware writes when no relay shutdown is required', () => {
  const plan = buildTickDryRunTransaction({
    snapshot: runningSnapshot({
      state: 'IDLE',
      activeSector: 0,
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
      source: 'none',
    }),
    tickDecision: {
      decision: TICK_DECISION.FORCE_IDLE_NONE,
      reason: STOP_REASON.NONE,
    },
    now: NOW,
  });

  assert.equal(plan.type, 'forceIdle');
  assert.deepEqual(plan.steps.map(step => `${step.adapter}:${step.action}`), [
    'EngineStateStore:clearQueue',
    'EngineStateStore:setValues',
  ]);
  assert.deepEqual(plan.failurePlan, []);
});

test('keeps relay shutdown for watchdog force idle', () => {
  const plan = buildTickDryRunTransaction({
    snapshot: runningSnapshot({
      state: 'IDLE',
      activeSector: 0,
      queue: [],
      activeRelays: [3],
      anyRelayOn: true,
      source: 'none',
    }),
    tickDecision: {
      decision: TICK_DECISION.FORCE_IDLE_WATCHDOG,
      reason: STOP_REASON.WATCHDOG,
    },
    now: NOW,
  });

  assert.equal(plan.steps[0].action, 'setAllRelays');
  assert.equal(plan.steps[0].value, false);
  assert(plan.failurePlan.length > 0);
});

test('builds tick dry-run transactions from the contract decision', () => {
  const plan = buildTickDryRunTransaction({
    snapshot: runningSnapshot(),
    tickDecision: {
      decision: TICK_DECISION.STOP_TIMEOUT,
      reason: STOP_REASON.TIMEOUT,
      activeSector: 2,
    },
    now: NOW,
  });

  assert.equal(plan.type, 'stop');
  assert.equal(plan.reason, STOP_REASON.TIMEOUT);
});

test('plans a manual start preview without executing hardware writes', () => {
  const plan = buildManualStartPreview({
    snapshot: runningSnapshot({
      state: 'IDLE',
      activeSector: 0,
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
    }),
    input: { sector: 3, duration: 8 },
    now: NOW,
  });

  assert.equal(plan.type, 'startQueuedItem');
  assert.equal(plan.accepted, true);
  assert.equal(plan.item.sector, 3);
  assert.deepEqual(plan.steps.map(step => `${step.adapter}:${step.action}`), [
    'EngineStateStore:setQueue',
    'EngineStateStore:setQueue',
    'EspHomeIrrigationHardwareAdapter:setAllRelays',
    'EspHomeIrrigationHardwareAdapter:setRelay',
    'EngineStateStore:setValues',
    'EngineStateStore:emitSectorEvent',
  ]);
  assert(plan.steps.every(step => step.dryRun === true));
  assert.equal(plan.steps[3].sector, 3);
});

test('plans start failure as idle retryable state cleanup', () => {
  const plan = buildManualStartPreview({
    snapshot: runningSnapshot({
      state: 'IDLE',
      activeSector: 0,
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
    }),
    input: { sector: 3, duration: 8 },
    now: NOW,
  });

  assert.deepEqual(plan.failurePlan.map(step => `${step.adapter}:${step.action}`), [
    'EngineStateStore:clearQueue',
    'EngineStateStore:setValues',
  ]);
  assert.equal(plan.failurePlan[1].values.state, 'IDLE');
  assert.equal(plan.failurePlan[1].values.activeSector, 0);
  assert.equal(plan.failurePlan[1].values.startTs, 0);
  assert.equal(plan.failurePlan[1].values.endTs, 0);
  assert.equal(plan.failurePlan[1].values.stopReason, STOP_REASON.NONE);
  assert.equal(plan.failurePlan[1].values.interruption, null);
});

test('plans a scheduler start preview with the accepted request queue', () => {
  const plan = buildProgramStartPreview({
    snapshot: runningSnapshot({
      state: 'IDLE',
      activeSector: 0,
      queue: [],
      activeRelays: [],
      anyRelayOn: false,
    }),
    request: {
      version: 1,
      requestId: 'request-1',
      requestedAt: NOW - 1000,
      source: 'SCHEDULER',
      queue: [{ sector: 1, duration: 5 }, { sector: 2, duration: 6 }],
    },
    now: NOW,
  });

  assert.equal(plan.type, 'startQueuedItem');
  assert.equal(plan.item.source, 'SCHEDULER');
  assert.equal(plan.remainingQueue.length, 1);
  assert.equal(plan.remainingQueue.length, 1);
});

test('does not accept native start previews when the engine is busy', () => {
  const plan = buildManualStartPreview({
    snapshot: runningSnapshot(),
    input: { sector: 3, duration: 8 },
    now: NOW,
  });

  assert.equal(plan.type, 'busy');
  assert.equal(plan.accepted, false);
  assert.deepEqual(plan.steps, []);
  assert(plan.steps.every(step => step.dryRun === true));
});
