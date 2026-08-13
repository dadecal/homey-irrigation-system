'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ManualDeviceService,
  constants,
} = require('../lib/manual-device-service');

const { CAP } = constants;

function createNativeDevice(initialValues = {}) {
  const values = {
    [CAP.sector]: initialValues.sector ?? 1,
    [CAP.duration]: initialValues.duration ?? 1,
    [CAP.onoff]: initialValues.onoff ?? false,
    [CAP.remaining]: initialValues.remaining ?? 0,
    [CAP.message]: initialValues.message ?? 'Sin riego activo',
  };

  return {
    values,
    data: { id: 'irrigation_manual' },
    hasCapability(capability) {
      return Object.prototype.hasOwnProperty.call(values, capability);
    },
    getCapabilityValue(capability) {
      return values[capability];
    },
    async applyNativeProjection(projection) {
      Object.assign(values, projection);
    },
    getData() {
      return this.data;
    },
  };
}

function createService(options = {}) {
  return new ManualDeviceService({
    homey: {
      setInterval: () => 1,
      clearInterval: () => {},
      app: console,
    },
    apiClient: {
      async getApi() {
        return {
          devices: {
            async getDevices() {
              return {};
            },
          },
        };
      },
    },
    controlStore: {
      async getControl() {
        return { services: { engine: 'ACTIVE_COMPAT' } };
      },
    },
    appStateStore: {
      async getState() {
        return options.appState || {};
      },
    },
    now: () => 1784620000000,
    logger: {
      log() {},
      error() {},
    },
    ...options,
  });
}

test('manual device start sends native sector and duration to the engine', async () => {
  const native = createNativeDevice({ sector: 4, duration: 7, onoff: false });
  const calls = [];
  const service = createService({
    engineService: {
      async startManual(input) {
        calls.push({ action: 'startManual', input });
        return { writesOperationalVariables: false, controlsHardware: true };
      },
    },
  });

  await service.registerDevice(native);
  const result = await service.setOnOff(true);

  assert.equal(result.action, 'START');
  assert.equal(result.route, 'native-engine');
  assert.deepEqual(calls, [{ action: 'startManual', input: { sector: 4, duration: 7 } }]);
  assert.equal(result.controlsHardwareDirectly, true);
  assert.equal(result.writesOperationalVariables, false);
});

test('manual device stop sends a native stop to the engine', async () => {
  const native = createNativeDevice({ sector: 3, duration: 10, onoff: true });
  const calls = [];
  const service = createService({
    engineService: {
      async stopManual() {
        calls.push({ action: 'stopManual' });
        return { writesOperationalVariables: false, controlsHardware: true };
      },
    },
  });

  await service.registerDevice(native);
  const result = await service.setOnOff(false);

  assert.equal(result.action, 'STOP');
  assert.equal(result.route, 'native-engine');
  assert.deepEqual(calls, [{ action: 'stopManual' }]);
});

test('manual projection follows appStateV2 engine state from appStateV2', async () => {
  const native = createNativeDevice({ sector: 2, duration: 12, onoff: false });
  const service = createService({
    appState: {
      engine: {
        state: 'RUNNING',
        source: 'MANUAL',
        activeSector: 6,
        endTs: 1784620000000 + 8 * 60 * 1000,
      },
    },
  });

  await service.registerDevice(native);
  const projection = await service.check();

  assert.equal(projection.values[CAP.sector], 6);
  assert.equal(projection.values[CAP.duration], 12);
  assert.equal(projection.values[CAP.onoff], true);
  assert.equal(projection.values[CAP.remaining], 8);
  assert.equal(native.values[CAP.message], 'Regando sector 6 (8 min restantes)');
});

test('manual start and stop notify the app to refresh native system projection', async () => {
  const native = createNativeDevice({ sector: 2, duration: 3, onoff: false });
  const commands = [];
  const service = createService({
    engineService: {
      async startManual() {
        return { writesOperationalVariables: false, controlsHardware: true };
      },
      async stopManual() {
        return { writesOperationalVariables: false, controlsHardware: true };
      },
    },
    async onCommand(command) {
      commands.push(command.action);
    },
  });

  await service.registerDevice(native);
  await service.setOnOff(true);
  await service.setOnOff(false);

  assert.deepEqual(commands, ['START', 'STOP']);
});

test('manual settings remain native-device only for sector and duration updates', async () => {
  const native = createNativeDevice({ sector: 5, duration: 9 });
  const service = createService();

  await service.registerDevice(native);
  const sectorCommand = await service.setSector(5);
  const durationCommand = await service.setDuration(9);

  assert.equal(sectorCommand.route, 'native-device');
  assert.equal(durationCommand.route, 'native-device');
  assert.equal(sectorCommand.writesOperationalVariables, false);
  assert.equal(durationCommand.writesOperationalVariables, false);
});
