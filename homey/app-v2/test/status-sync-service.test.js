'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MODE, SERVICE } = require('../lib/constants');
const StatusSyncService = require('../lib/status-sync-service');

const NOW = 1721300100000;

function createService(mode = MODE.SHADOW) {
  let deviceReads = 0;
  const logs = [];
  const service = new StatusSyncService({
    homey: {
      setInterval() {
        throw new Error('retired StatusSyncService must not start an interval');
      },
      clearInterval() {},
      app: {},
    },
    apiClient: {
      async getApi() {
        return {
          devices: {
            async getDevice() {
              deviceReads += 1;
              throw new Error('retired StatusSyncService must not read devices');
            },
            async getDevices() {
              deviceReads += 1;
              throw new Error('retired StatusSyncService must not read devices');
            },
          },
        };
      },
    },
    controlStore: {
      async getControl() {
        return {
          services: {
            [SERVICE.STATUS_SYNC]: mode,
          },
        };
      },
    },
    now: () => NOW,
    logger: {
      log(...args) {
        logs.push(args);
      },
      error(...args) {
        logs.push(args);
      },
    },
  });

  return {
    service,
    logs,
    getDeviceReads: () => deviceReads,
  };
}

test('reports StatusSync as retired without checking retired devices', async () => {
  const { service, getDeviceReads } = createService(MODE.ACTIVE_COMPAT);

  const projection = await service.check();

  assert.equal(projection.mode, MODE.ACTIVE_COMPAT);
  assert.equal(projection.retired, true);
  assert.equal(projection.updatesDevices, false);
  assert.equal(projection.writesOperationalVariables, false);
  assert.deepEqual(projection.applied, []);
  assert.deepEqual(projection.expected, {});
  assert.deepEqual(projection.sources, {});
  assert.equal(getDeviceReads(), 0);
});

test('does not start a periodic timer after retirement', async () => {
  const { service, logs, getDeviceReads } = createService();

  service.start();
  const status = await service.status();

  assert.equal(status.retired, true);
  assert.equal(status.timerActive, false);
  assert.equal(getDeviceReads(), 0);
  assert.equal(logs.length, 1);
});
