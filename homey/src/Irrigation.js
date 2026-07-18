// Irrigation System v1.3 - queue architecture
// Component: homey-scripts@1.3.0
// Provides: irrigation-scripts-api@1.0.0
// Requires: irrigation-hw-api >=1.0.0 <2.0.0
// Responsabilidad: motor de riego, cola, relés y estado operativo.
// Sensores: IrrigationStatus.js
// Histórico/Insights: IrrigationHistory.js
function resolveAction(input) {
  if (Array.isArray(input)) {
    return input[0] || 'status';
  }

  if (typeof input === 'string' && input.trim()) {
    return input.trim();
  }

  if (input && typeof input === 'object') {
    if (typeof input.argument === 'string' && input.argument.trim()) {
      return input.argument.trim();
    }

    if (typeof input.value === 'string' && input.value.trim()) {
      return input.value.trim();
    }

    const firstStringValue = Object.values(input).find(
      value => typeof value === 'string' && value.trim(),
    );

    if (firstStringValue) {
      return firstStringValue.trim();
    }
  }

  return 'status';
}

const action = resolveAction(typeof args === 'undefined' ? undefined : args);

function parseProgramRequest(value) {
  let request;

  try {
    request = JSON.parse(value);
  } catch (error) {
    throw new Error(`Solicitud de programa no valida: ${error.message}`);
  }

  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('Solicitud de programa no valida');
  }

  if (request.version !== 1) {
    throw new Error(`Version de solicitud no soportada: ${request.version}`);
  }

  if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
    throw new Error('requestId no valido');
  }

  if (!Number.isInteger(request.requestedAt) || request.requestedAt <= 0) {
    throw new Error('requestedAt no valido');
  }

  if (request.source !== 'SCHEDULER') {
    throw new Error(`Origen de solicitud no soportado: ${request.source}`);
  }

  if (!Array.isArray(request.queue) || request.queue.length < 1 || request.queue.length > 6) {
    throw new Error('La solicitud debe contener entre 1 y 6 sectores');
  }

  const sectors = new Set();
  const queue = request.queue.map((item, index) => {
    const sector = Number(item?.sector);
    const duration = Number(item?.duration);

    if (!Number.isInteger(sector) || sector < 1 || sector > 6) {
      throw new Error(`queue.${index}.sector debe estar entre 1 y 6`);
    }

    if (sectors.has(sector)) {
      throw new Error(`El sector ${sector} aparece mas de una vez`);
    }

    if (!Number.isInteger(duration) || duration < 1 || duration > 30) {
      throw new Error(`queue.${index}.duration debe estar entre 1 y 30`);
    }

    sectors.add(sector);
    return { sector, duration };
  });

  return {
    version: request.version,
    requestId: request.requestId.trim(),
    requestedAt: request.requestedAt,
    source: request.source,
    queue,
  };
}

const DEVICES = {
  manual: 'f702f97b-7ba3-4ba2-9a82-426ca94a05f8',
  raw: '1120df26-8201-49de-b262-8fb98289d811',
  system: '611125df-85eb-4fa0-bce1-aabbbdabc55e',
};

const MANUAL_CAP = {
  sector: 'measure_devicecapabilities_slider_number.number1',
  duration: 'measure_devicecapabilities_slider_number.number2',
  onoff: 'onoff',
  info: 'devicecapabilities_text-custom_40.text1',
  remaining: 'measure_devicecapabilities_number-custom_61.number3',
};

const SYSTEM_CAP = {
  state: 'devicecapabilities_text-custom_18.text2',
  activeSector: 'devicecapabilities_number-custom_10.number1',
  remainingTime: 'devicecapabilities_number-custom_61.number2',
  queueLength: 'devicecapabilities_number-custom_12.number3',
  source: 'devicecapabilities_text-custom_3.text3',
  activeProgram: 'devicecapabilities_text-custom_1.text4',
  info: 'devicecapabilities_text-custom_40.text1',
  // Campo técnico del dispositivo "Sistema de Riego".
  // Debe apuntar a un Number field dedicado a disparar el Flow de histórico.
  // Cuando se cree el campo en Device Capabilities, sustituir null por su capability ID real.
  historyTrigger: 'measure_devicecapabilities_number.number7',
};


const RAW_CAP = {
  relays: {
    1: 'onoff',
    2: 'onoff.rel__l_nea_2',
    3: 'onoff.rel__l_nea_3',
    4: 'onoff.rel__l_nea_4',
    5: 'onoff.rel__l_nea_5',
    6: 'onoff.rel__l_nea_6',
  },

  litersCycle: {
    1: 'measure_generic.l1_litros_ciclo',
    2: 'measure_generic.l2_litros_ciclo',
    3: 'measure_generic.l3_litros_ciclo',
    4: 'measure_generic.l4_litros_ciclo',
    5: 'measure_generic.l5_litros_ciclo',
    6: 'measure_generic.l6_litros_ciclo',
  },
};

const VAR = {
  state: 'Irrigation.State',
  activeSector: 'Irrigation.ActiveSector',
  startTs: 'Irrigation.StartTimestamp',
  endTs: 'Irrigation.EndTimestamp',
  source: 'Irrigation.Source',
  stopReason: 'Irrigation.StopReason',
  queue: 'Irrigation.Queue',
  history: 'Irrigation.History',
  lastTickTs: 'Irrigation.LastTickTimestamp',
  sectorStartMessage: 'Irrigation.SectorStartMessage',
  sectorStartTrigger: 'Irrigation.SectorStartTrigger',
  sectorEndMessage: 'Irrigation.SectorEndMessage',
  sectorEndTrigger: 'Irrigation.SectorEndTrigger',
};

const NOTIFICATION_VARIABLES = [
  { name: VAR.lastTickTs, type: 'number', value: 0 },
  { name: VAR.sectorStartMessage, type: 'string', value: '' },
  { name: VAR.sectorStartTrigger, type: 'number', value: 0 },
  { name: VAR.sectorEndMessage, type: 'string', value: '' },
  { name: VAR.sectorEndTrigger, type: 'number', value: 0 },
];

const STATE = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  ERROR: 'ERROR',
};

const STOP_REASON = {
  NONE: 'none',
  MANUAL: 'manual',
  TIMEOUT: 'timeout',
  WATCHDOG: 'watchdog',
  ERROR: 'error',
};

const MAX_DURATION_MIN = 30;
const START_WATCHDOG_GRACE_MS = 15000;
const STALE_RUN_ABORT_MS = 2 * 60 * 1000;
const MAX_HISTORY_ENTRIES = 25;

async function getDevice(id) {
  return Homey.devices.getDevice({ id });
}

async function setCapability(deviceId, capabilityId, value) {
  await Homey.devices.setCapabilityValue({ deviceId, capabilityId, value });
}

async function setCapabilityIfNeeded(deviceId, capabilityId, value) {
  const device = await getDevice(deviceId);
  const currentValue = device.capabilitiesObj?.[capabilityId]?.value;

  if (currentValue === value) {
    return;
  }

  await setCapability(deviceId, capabilityId, value);
}

async function updateDevice(deviceId, values) {
  if (!deviceId) {
    return;
  }

  for (const [capabilityId, value] of Object.entries(values)) {
    if (value === undefined) {
      continue;
    }

    await setCapabilityIfNeeded(deviceId, capabilityId, value);
  }
}

const Manual = {
  async update(values) {
    return updateDevice(DEVICES.manual, values);
  },
};

const System = {
  async update(values) {
    try {
      return await updateDevice(DEVICES.system, values);
    } catch (error) {
      console.log(`SYSTEM update skipped: ${error.message}`);
    }
  },
};

const Raw = {
  async update(values) {
    try {
      return await updateDevice(DEVICES.raw, values);
    } catch (error) {
      throw new Error(`RAW Riego no disponible: ${error.message}`);
    }
  },
};


async function setVirtual(values) {
  return Manual.update(values);
}

async function setAllRelays(value) {
  const values = Object.values(RAW_CAP.relays).reduce((acc, capabilityId) => {
    acc[capabilityId] = value;
    return acc;
  }, {});

  await Raw.update(values);
}

async function setRelay(sector, value) {
  await Raw.update({
    [RAW_CAP.relays[sector]]: value,
  });
}

const LogicStore = {
  variablesByName: null,

  async load() {
    if (this.variablesByName) {
      return;
    }

    const variables = await Homey.logic.getVariables();
    this.variablesByName = Object.values(variables).reduce((acc, variable) => {
      acc[variable.name] = variable;
      return acc;
    }, {});
  },

  async getVariable(name) {
    await this.load();

    const variable = this.variablesByName[name];
    if (!variable) {
      throw new Error(`No existe la variable Logic: ${name}`);
    }

    return variable;
  },

  async ensureVariable(definition) {
    await this.load();

    if (this.variablesByName[definition.name]) {
      return;
    }

    const variable = await Homey.logic.createVariable({ variable: definition });
    this.variablesByName[definition.name] = variable;
  },

  async ensureVariables(definitions) {
    for (const definition of definitions) {
      await this.ensureVariable(definition);
    }
  },

  async getValue(name) {
    const variable = await this.getVariable(name);
    return variable.value;
  },

  async setValue(name, value) {
    const variable = await this.getVariable(name);

    if (variable.value === value) {
      return;
    }

    await Homey.logic.updateVariable({
      id: variable.id,
      variable: { value },
    });

    variable.value = value;
  },

  async setValues(values) {
    for (const [name, value] of Object.entries(values)) {
      await this.setValue(name, value);
    }
  },
};

async function getLogicValue(name) {
  return LogicStore.getValue(name);
}

async function setEngineState(values) {
  return LogicStore.setValues(values);
}

async function getQueue() {
  const raw = await getLogicValue(VAR.queue);

  if (!raw || raw === 'none') {
    return [];
  }

  try {
    const queue = JSON.parse(raw);
    return Array.isArray(queue) ? queue : [];
  } catch (error) {
    console.log(`QUEUE parse error: ${error.message}`);
    return [];
  }
}

async function setQueue(queue) {
  await setEngineState({
    [VAR.queue]: JSON.stringify(queue),
  });
}

function validateQueueItem(item) {
  if (!item || typeof item !== 'object') {
    return 'Elemento de cola no válido';
  }

  return validateStart(item.sector, item.duration);
}

function createQueueItem({ sector, duration, source = 'MANUAL', description = 'Riego manual' }) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdTs: Date.now(),
    sector,
    duration,
    source,
    description,
  };
}

const QueueStore = {
  async get() {
    return getQueue();
  },

  async set(queue) {
    return setQueue(queue);
  },

  async replace(queue) {
    return this.set(queue);
  },

  async append(items) {
    const currentQueue = await this.get();
    const itemsToAppend = Array.isArray(items) ? items : [items];
    return this.set([...currentQueue, ...itemsToAppend]);
  },

  async clear() {
    return this.set([]);
  },

  async peek() {
    const queue = await this.get();
    return queue[0] || null;
  },

  async dequeue() {
    const queue = await this.get();
    const [item, ...remainingQueue] = queue;
    await this.set(remainingQueue);
    return item || null;
  },

  async length() {
    const queue = await this.get();
    return queue.length;
  },

  async isEmpty() {
    return (await this.length()) === 0;
  },

  async hasPending() {
    return !(await this.isEmpty());
  },
};

const HistoryStore = {
  async get() {
    try {
      const raw = await getLogicValue(VAR.history);
      const history = raw ? JSON.parse(raw) : [];
      return Array.isArray(history) ? history : [];
    } catch (error) {
      console.log(`HISTORY read skipped: ${error.message}`);
      return [];
    }
  },

  async append(entry) {
    try {
      const history = await this.get();
      history.unshift(entry);

      await setEngineState({
        [VAR.history]: JSON.stringify(history.slice(0, MAX_HISTORY_ENTRIES)),
      });
    } catch (error) {
      console.log(`HISTORY write skipped: ${error.message}`);
    }
  },
};

async function recordHistory({ sector, source, reason, durationMin, liters }) {
  console.log(JSON.stringify({
    event: 'HISTORY_PENDING',
    sector,
    source,
    reason,
    durationMin,
    liters,
  }));

  // IrrigationHistory.js lee la última entrada desde VAR.history.
  // No ejecutamos otro HomeyScript desde aquí porque runFlowCardAction no es fiable
  // para encadenar scripts en este entorno.
}


const ProgramBuilder = {
  manual(input, source = 'MANUAL') {
    return [createQueueItem({
      sector: input.sector,
      duration: input.duration,
      source,
      description: 'Riego manual',
    })];
  },

  scheduler(request) {
    return request.queue.map(item => createQueueItem({
      sector: item.sector,
      duration: item.duration,
      source: request.source,
      description: `Programa automatico ${request.requestId}`,
    }));
  },
};


async function readVirtual() {
  const device = await getDevice(DEVICES.manual);
  const c = device.capabilitiesObj;

  const sectorRaw = c[MANUAL_CAP.sector]?.value;
  const durationRaw = c[MANUAL_CAP.duration]?.value;

  return {
    on: Boolean(c[MANUAL_CAP.onoff]?.value),
    sector: Math.round(Number(sectorRaw)),
    duration: Math.round(Number(durationRaw)),
    sectorRaw,
    durationRaw,
  };
}


async function readRiego() {
  const device = await getDevice(DEVICES.raw);
  const c = device.capabilitiesObj;

  const relayStates = {};
  for (const [sector, cap] of Object.entries(RAW_CAP.relays)) {
    relayStates[Number(sector)] = Boolean(c[cap]?.value);
  }

  return {
    relayStates,
    anyRelayOn: Object.values(relayStates).some(Boolean),
  };
}

function remainingMinutes(endTs) {
  const remainingMs = Math.max(Number(endTs) - Date.now(), 0);
  return Math.ceil(remainingMs / 60000);
}

function validateStart(sector, duration) {
  if (!Number.isInteger(sector) || sector < 1 || sector > 6) {
    return `Sector no válido: ${sector}`;
  }

  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_DURATION_MIN) {
    return `Duración no válida: ${duration} min`;
  }

  return null;
}

async function readLiters(sector) {
  const device = await getDevice(DEVICES.raw);
  const cap = RAW_CAP.litersCycle[sector];
  return Number(device.capabilitiesObj[cap]?.value || 0);
}

async function updateSystemStatus({ state, activeSector, remainingTime, queueLength, source, activeProgram, info }) {
  const values = {};

  if (state !== undefined) values[SYSTEM_CAP.state] = state;
  if (activeSector !== undefined) values[SYSTEM_CAP.activeSector] = activeSector;
  if (remainingTime !== undefined) values[SYSTEM_CAP.remainingTime] = remainingTime;
  if (queueLength !== undefined) values[SYSTEM_CAP.queueLength] = queueLength;
  if (source !== undefined) values[SYSTEM_CAP.source] = source;
  if (activeProgram !== undefined) values[SYSTEM_CAP.activeProgram] = activeProgram;
  if (info !== undefined) values[SYSTEM_CAP.info] = info;

  await System.update(values);
}

async function emitHistoryTrigger(entryId) {
  if (!SYSTEM_CAP.historyTrigger) {
    console.log(`HISTORY trigger skipped: SYSTEM_CAP.historyTrigger not configured. entryId=${entryId}`);
    return;
  }

  await System.update({
    [SYSTEM_CAP.historyTrigger]: Date.now(),
  });

  console.log(`HISTORY trigger emitted: entryId=${entryId}`);
}

async function emitSectorEvent(messageVariable, triggerVariable, message) {
  await LogicStore.setValue(messageVariable, message);
  await LogicStore.setValue(triggerVariable, Date.now());
}


const Engine = {
  async start(source = 'MANUAL') {
    const currentState = await getLogicValue(VAR.state);
    const riego = await readRiego();
    const input = await readVirtual();

    if (!Number.isFinite(input.sector) || !Number.isFinite(input.duration)) {
      await setVirtual({
        [MANUAL_CAP.onoff]: false,
        [MANUAL_CAP.info]: 'No se han podido leer sector o duración',
        [MANUAL_CAP.remaining]: 0,
      });
      await updateSystemStatus({
        state: STATE.ERROR,
        activeSector: 0,
        remainingTime: 0,
        queueLength: await QueueStore.length(),
        source,
        info: 'No se han podido leer sector o duración',
      });
      return;
    }

    if (currentState === STATE.RUNNING || riego.anyRelayOn) {
      await setVirtual({
        [MANUAL_CAP.info]: 'Ya hay un riego en curso',
      });
      await updateSystemStatus({
        state: currentState,
        activeSector: Number(await getLogicValue(VAR.activeSector)) || 0,
        remainingTime: remainingMinutes(Number(await getLogicValue(VAR.endTs))),
        queueLength: await QueueStore.length(),
        source,
        info: 'Ya hay un riego en curso',
      });
      return;
    }

    const queue = ProgramBuilder.manual(input, source);
    await QueueStore.replace(queue);
    await this.startNextQueuedItem();
  },

  async startProgram(request) {
    const currentState = await getLogicValue(VAR.state);
    const riego = await readRiego();

    if (currentState === STATE.RUNNING || riego.anyRelayOn) {
      const message = `Solicitud ${request.requestId} ignorada: ya hay un riego en curso`;
      await setVirtual({ [MANUAL_CAP.info]: message });
      await updateSystemStatus({
        state: currentState,
        activeSector: Number(await getLogicValue(VAR.activeSector)) || 0,
        remainingTime: remainingMinutes(Number(await getLogicValue(VAR.endTs))),
        queueLength: await QueueStore.length(),
        source: await getLogicValue(VAR.source),
        info: message,
      });
      console.log(message);
      return;
    }

    const queue = ProgramBuilder.scheduler(request);
    await QueueStore.replace(queue);
    console.log(`PROGRAM_REQUEST accepted requestId=${request.requestId} queueLength=${queue.length}`);
    await this.startNextQueuedItem();
  },

  async startNextQueuedItem() {
    if (await QueueStore.isEmpty()) {
      await setEngineState({
        [VAR.state]: STATE.IDLE,
        [VAR.activeSector]: 0,
        [VAR.endTs]: 0,
        [VAR.stopReason]: STOP_REASON.NONE,
      });

      await setVirtual({
        [MANUAL_CAP.onoff]: false,
        [MANUAL_CAP.remaining]: 0,
        [MANUAL_CAP.info]: 'Cola de riego vacía',
      });
      await updateSystemStatus({
        state: STATE.IDLE,
        activeSector: 0,
        remainingTime: 0,
        queueLength: 0,
        source: await getLogicValue(VAR.source),
        activeProgram: 'none',
        info: 'Cola de riego vacía',
      });
      return;
    }

    const item = await QueueStore.dequeue();
    const validationError = validateQueueItem(item);

    if (validationError) {
      await QueueStore.clear();
      await setAllRelays(false);
      await setVirtual({
        [MANUAL_CAP.onoff]: false,
        [MANUAL_CAP.info]: validationError,
        [MANUAL_CAP.remaining]: 0,
      });
      await setEngineState({
        [VAR.state]: STATE.ERROR,
        [VAR.activeSector]: 0,
        [VAR.endTs]: 0,
        [VAR.stopReason]: STOP_REASON.ERROR,
      });
      await updateSystemStatus({
        state: STATE.ERROR,
        activeSector: 0,
        remainingTime: 0,
        queueLength: await QueueStore.length(),
        source: item?.source || 'unknown',
        activeProgram: item?.description || 'unknown',
        info: validationError,
      });
      return;
    }

    const now = Date.now();
    const end = now + item.duration * 60 * 1000;

    try {
      await setAllRelays(false);
      await setRelay(item.sector, true);
    } catch (error) {
      await QueueStore.clear();
      await setEngineState({
        [VAR.state]: STATE.ERROR,
        [VAR.activeSector]: 0,
        [VAR.endTs]: 0,
        [VAR.stopReason]: STOP_REASON.ERROR,
      });
      await setVirtual({
        [MANUAL_CAP.info]: `${error.message}. Comprueba el dispositivo RAW Riego.`,
        [MANUAL_CAP.remaining]: 0,
      });
      await updateSystemStatus({
        state: STATE.ERROR,
        activeSector: 0,
        remainingTime: 0,
        queueLength: 0,
        source: item.source || 'MANUAL',
        activeProgram: item.description || 'none',
        info: `${error.message}. Comprueba RAW Riego.`,
      });
      return;
    }

    await setEngineState({
      [VAR.state]: STATE.RUNNING,
      [VAR.activeSector]: item.sector,
      [VAR.startTs]: now,
      [VAR.endTs]: end,
      [VAR.source]: item.source || 'MANUAL',
      [VAR.stopReason]: STOP_REASON.NONE,
    });

    await emitSectorEvent(
      VAR.sectorStartMessage,
      VAR.sectorStartTrigger,
      `Iniciado sector ${item.sector}: ${item.duration} min (${item.source || 'MANUAL'})`,
    );

    await setVirtual({
      [MANUAL_CAP.info]: `Regando sector ${item.sector} durante ${item.duration} min`,
      [MANUAL_CAP.remaining]: item.duration,
    });
    await updateSystemStatus({
      state: STATE.RUNNING,
      activeSector: item.sector,
      remainingTime: item.duration,
      queueLength: await QueueStore.length(),
      source: item.source || 'MANUAL',
      activeProgram: item.description || 'none',
      info: `Regando sector ${item.sector} durante ${item.duration} min`,
    });

    console.log(`START sector=${item.sector} duration=${item.duration} source=${item.source || 'MANUAL'}`);
  },

  async forceIdle(reason = STOP_REASON.WATCHDOG) {
    try {
      await setAllRelays(false);
    } catch (error) {
      await QueueStore.clear();
      await setEngineState({
        [VAR.state]: STATE.ERROR,
        [VAR.stopReason]: STOP_REASON.ERROR,
      });
      await updateSystemStatus({
        state: STATE.ERROR,
        activeSector: Number(await getLogicValue(VAR.activeSector)) || 0,
        remainingTime: 0,
        queueLength: 0,
        source: await getLogicValue(VAR.source),
        info: `No se pudieron apagar los relés: ${error.message}`,
      });
      throw error;
    }

    await QueueStore.clear();

    await setEngineState({
      [VAR.state]: STATE.IDLE,
      [VAR.activeSector]: 0,
      [VAR.endTs]: 0,
      [VAR.stopReason]: reason,
    });

    await setVirtual({
      [MANUAL_CAP.onoff]: false,
      [MANUAL_CAP.remaining]: 0,
      [MANUAL_CAP.info]: 'Sin riego activo',
    });

    await updateSystemStatus({
      state: STATE.IDLE,
      activeSector: 0,
      remainingTime: 0,
      queueLength: 0,
      source: await getLogicValue(VAR.source),
      activeProgram: 'none',
      info: 'Sin riego activo',
    });


    console.log(`FORCE_IDLE reason=${reason}`);
  },

  async stop(reason = STOP_REASON.MANUAL) {
    const currentState = await getLogicValue(VAR.state);
    if (currentState === STATE.IDLE) {
      console.log(`STOP ignored reason=${reason}; engine already IDLE`);
      return;
    }

    const activeSector = Number(await getLogicValue(VAR.activeSector));
    const startTs = Number(await getLogicValue(VAR.startTs));
    const plannedEndTs = Number(await getLogicValue(VAR.endTs));
    const endRealTs = Date.now();

    let liters = 0;
    if (activeSector >= 1 && activeSector <= 6) {
      try {
        liters = await readLiters(activeSector);
      } catch (error) {
        console.log(`LITERS unavailable sector=${activeSector}: ${error.message}`);
      }
    }

    try {
      await setAllRelays(false);
    } catch (error) {
      await QueueStore.clear();
      await setEngineState({
        [VAR.state]: STATE.ERROR,
        [VAR.stopReason]: STOP_REASON.ERROR,
      });
      await setVirtual({
        [MANUAL_CAP.onoff]: false,
        [MANUAL_CAP.remaining]: 0,
        [MANUAL_CAP.info]: `ERROR apagando relés: ${error.message}`.slice(0, 250),
      });
      await updateSystemStatus({
        state: STATE.ERROR,
        activeSector,
        remainingTime: 0,
        queueLength: 0,
        source: await getLogicValue(VAR.source),
        activeProgram: 'error',
        info: `No se pudieron apagar los relés: ${error.message}`,
      });
      throw error;
    }

    if (reason !== STOP_REASON.TIMEOUT) {
      await QueueStore.clear();
    }

    const plannedDurationMin = startTs > 0 && plannedEndTs > startTs
      ? Math.round((plannedEndTs - startTs) / 60000)
      : 0;

    const durationRealMin = startTs > 0
      ? Math.round((endRealTs - startTs) / 60000)
      : 0;

    const source = await getLogicValue(VAR.source);
    const pendingQueue = await QueueStore.get();
    const shouldTurnOffVirtual = reason !== STOP_REASON.TIMEOUT || pendingQueue.length === 0;

    const historyEntry = {
      id: `${endRealTs}-${activeSector}`,
      sector: activeSector,
      source,
      reason,
      startTs,
      plannedEndTs,
      endTs: endRealTs,
      plannedDurationMin,
      durationRealMin,
      liters,
    };

    await HistoryStore.append(historyEntry);

    await recordHistory({
      sector: activeSector,
      source,
      reason,
      durationMin: reason === STOP_REASON.TIMEOUT ? plannedDurationMin : durationRealMin,
      liters,
    });

    await emitHistoryTrigger(historyEntry.id);

    await setEngineState({
      [VAR.state]: STATE.IDLE,
      [VAR.activeSector]: 0,
      [VAR.endTs]: 0,
      [VAR.stopReason]: reason,
    });

    const sectorEndMessage = reason === STOP_REASON.TIMEOUT
      ? `Finalizado sector ${activeSector}: ${liters.toFixed(1)} L`
      : `Detenido sector ${activeSector}: ${liters.toFixed(1)} L (${reason})`;

    await emitSectorEvent(
      VAR.sectorEndMessage,
      VAR.sectorEndTrigger,
      sectorEndMessage,
    );

    const message =
      reason === STOP_REASON.TIMEOUT
        ? `Finalizado S${activeSector}: ${liters.toFixed(1)} L`
        : `Detenido S${activeSector}: ${liters.toFixed(1)} L (${reason})`;

    const virtualUpdate = {
      [MANUAL_CAP.remaining]: 0,
      [MANUAL_CAP.info]: message,
    };

    if (shouldTurnOffVirtual) {
      virtualUpdate[MANUAL_CAP.onoff] = false;
    }

    await setVirtual(virtualUpdate);

    const hasPendingAfterStop = await QueueStore.hasPending();
    await updateSystemStatus({
      state: STATE.IDLE,
      activeSector: 0,
      remainingTime: 0,
      queueLength: await QueueStore.length(),
      source,
      activeProgram: reason === STOP_REASON.TIMEOUT && hasPendingAfterStop ? 'pending queue' : 'none',
      info: message,
    });

    console.log(JSON.stringify({
      event: 'STOP',
      sector: activeSector,
      reason,
      startTs,
      plannedEndTs,
      endTs: endRealTs,
      plannedDurationMin,
      durationRealMin,
      liters,
    }));
  },

  async tick() {
    const now = Date.now();
    await setEngineState({ [VAR.lastTickTs]: now });
    const state = await getLogicValue(VAR.state);
    const endTs = Number(await getLogicValue(VAR.endTs));
    const activeSector = Number(await getLogicValue(VAR.activeSector));
    const riego = await readRiego();

    if (state === STATE.RUNNING && endTs > 0 && now - endTs > STALE_RUN_ABORT_MS) {
      console.log(`STALE RUN sector=${activeSector} overdueMs=${now - endTs}`);
      await this.stop(STOP_REASON.WATCHDOG);
      return;
    }

    if (state !== STATE.RUNNING) {
      if (riego.anyRelayOn) {
        await this.forceIdle(STOP_REASON.WATCHDOG);
        return;
      }

      await this.forceIdle(STOP_REASON.NONE);
      return;
    }

    if (!riego.anyRelayOn) {
      const startTs = Number(await getLogicValue(VAR.startTs));
      const ageMs = Date.now() - startTs;

      if (ageMs < START_WATCHDOG_GRACE_MS) {
        console.log(`WATCHDOG grace sector=${activeSector} ageMs=${ageMs}`);
        return;
      }

      await this.stop(STOP_REASON.WATCHDOG);
      return;
    }

    const remaining = remainingMinutes(endTs);

    if (remaining <= 0) {
      await this.stop(STOP_REASON.TIMEOUT);

      if (await QueueStore.hasPending()) {
        await this.startNextQueuedItem();
      }

      return;
    }

    await setVirtual({
      [MANUAL_CAP.remaining]: remaining,
      [MANUAL_CAP.info]: `Regando sector ${activeSector}. Quedan ${remaining} min`,
    });
    await updateSystemStatus({
      state: STATE.RUNNING,
      activeSector,
      remainingTime: remaining,
      queueLength: await QueueStore.length(),
      source: await getLogicValue(VAR.source),
      info: `Regando sector ${activeSector}. Quedan ${remaining} min`,
    });

    console.log(`TICK sector=${activeSector} remaining=${remaining}`);
  },

  async toggle() {
    const input = await readVirtual();
    return input.on
      ? this.start('MANUAL')
      : this.stop(STOP_REASON.MANUAL);
  },

  async recover() {
    await QueueStore.clear();
    await setEngineState({
      [VAR.state]: STATE.IDLE,
      [VAR.activeSector]: 0,
      [VAR.startTs]: 0,
      [VAR.endTs]: 0,
      [VAR.stopReason]: STOP_REASON.WATCHDOG,
    });
    await setVirtual({
      [MANUAL_CAP.onoff]: false,
      [MANUAL_CAP.remaining]: 0,
      [MANUAL_CAP.info]: 'Recuperación manual: hardware confirmado apagado',
    });
    await updateSystemStatus({
      state: STATE.IDLE,
      activeSector: 0,
      remainingTime: 0,
      queueLength: 0,
      source: await getLogicValue(VAR.source),
      activeProgram: 'none',
      info: 'Recuperación manual completada',
    });
    console.log('RECOVER completed after external hardware confirmation');
  },

  async run(action) {
    console.log(`ACTION ${action}`);

    try {
      if (typeof action === 'string' && action.startsWith('{')) {
        return await this.startProgram(parseProgramRequest(action));
      }

      if (action === 'start') return await this.start('MANUAL');
      if (action === 'stop') return await this.stop(STOP_REASON.MANUAL);
      if (action === 'tick') return await this.tick();
      if (action === 'toggle') return await this.toggle();
      if (action === 'sync') return await this.forceIdle(STOP_REASON.NONE);
      if (action === 'recover') return await this.recover();
      if (action === 'status') {
        console.log({
          state: await getLogicValue(VAR.state),
          activeSector: await getLogicValue(VAR.activeSector),
          startTs: await getLogicValue(VAR.startTs),
          endTs: await getLogicValue(VAR.endTs),
          source: await getLogicValue(VAR.source),
          stopReason: await getLogicValue(VAR.stopReason),
          queue: await QueueStore.get(),
          queueLength: await QueueStore.length(),
          history: await HistoryStore.get(),
        });
        return;
      }

      throw new Error(`Acción no soportada: ${action}`);
    } catch (error) {
      console.log(`ENGINE ERROR: ${error.message}`);
      await Manual.update({
        [MANUAL_CAP.info]: `ERROR: ${error.message}`.slice(0, 250),
        [MANUAL_CAP.remaining]: 0,
      });
      throw error;
    }
  },
};

await LogicStore.ensureVariables(NOTIFICATION_VARIABLES);
await Engine.run(action);
