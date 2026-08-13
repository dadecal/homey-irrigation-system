'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createProgramRequest,
  serializeProgramRequest,
} = require('../lib/program-request');
const ProgramRequestTrigger = require('../lib/program-request-trigger');

test('creates a versioned scheduler request', () => {
  const request = createProgramRequest([
    { sector: 1, duration: 10 },
    { sector: 3, duration: 8 },
  ], 123456);

  assert.equal(request.version, 1);
  assert.equal(request.requestedAt, 123456);
  assert.equal(request.runDate, null);
  assert.equal(request.source, 'SCHEDULER');
  assert.match(request.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(request.queue, [
    { sector: 1, duration: 10 },
    { sector: 3, duration: 8 },
  ]);
  assert.deepEqual(JSON.parse(serializeProgramRequest(request)), request);
});

test('includes the scheduler run date when provided', () => {
  const request = createProgramRequest([
    { sector: 1, duration: 10 },
  ], 123456, { runDate: '2026-07-09' });

  assert.equal(request.runDate, '2026-07-09');
});

test('rejects duplicate sectors and invalid durations', () => {
  assert.throws(
    () => createProgramRequest([{ sector: 1, duration: 0 }]),
    /duration debe estar entre 1 y 30/,
  );
  assert.throws(
    () => createProgramRequest([
      { sector: 2, duration: 5 },
      { sector: 2, duration: 7 },
    ]),
    /aparece mas de una vez/,
  );
});

test('publishes the serialized request as a Flow token', async () => {
  let emittedTokens = null;
  const card = {
    async trigger(tokens) {
      emittedTokens = tokens;
    },
  };
  const homey = {
    flow: {
      getTriggerCard(id) {
        assert.equal(id, 'program_requested');
        return card;
      },
    },
  };

  const trigger = new ProgramRequestTrigger(homey);
  const request = await trigger.trigger([{ sector: 4, duration: 6 }]);

  assert.deepEqual(JSON.parse(emittedTokens.request), request);
});
