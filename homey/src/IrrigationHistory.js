'use strict';

// Component: homey-scripts@1.3.0
// Provides: irrigation-scripts-api@1.0.0
// Requires: irrigation-hw-api >=1.0.0 <2.0.0
//
// =========================================================
// Irrigation History
// Registra el último riego y actualiza métricas para Insights
// =========================================================
// Uso previsto:
//   - Sin argumento: proyecta la última entrada persistida por Irrigation.js en Irrigation.History.
//   - Con argumento JSON:
//     {
//       "sector": 3,
//       "durationMin": 5,
//       "program": "manual",
//       "reason": "completed"
//     }
// =========================================================

const DEVICES = {
  raw: '1120df26-8201-49de-b262-8fb98289d811',
  system: '611125df-85eb-4fa0-bce1-aabbbdabc55e',
  history: '4e479970-4f59-4bb1-8e4f-8cbfc1ef0bdb',
};

const VAR = {
  engineHistory: 'Irrigation.History',
  lastProjectedHistoryId: 'Irrigation.HistoryLastProjectedId',
};

// Para pruebas manuales desde HomeyScript, donde no se pueden pasar argumentos.
// Dejar en null en producción.
const TEST_INPUT = null;
// const TEST_INPUT = { sector: 1, durationMin: 1, program: 'manual', reason: 'test' };

const RAW_CAP = {
  lastLiters: {
    1: 'measure_generic.l1_litros__ltimo',
    2: 'measure_generic.l2_litros__ltimo',
    3: 'measure_generic.l3_litros__ltimo',
    4: 'measure_generic.l4_litros__ltimo',
    5: 'measure_generic.l5_litros__ltimo',
    6: 'measure_generic.l6_litros__ltimo',
  },
};

const SYSTEM_CAP = {
  sector: 'devicecapabilities_number-custom_10.number1',
  program: 'devicecapabilities_text-custom_1.text4',
  origin: 'devicecapabilities_text-custom_3.text3',
};

// Nota: estos IDs proceden del dispositivo virtual "Histórico de Riego".
// Si se recrean o modifican campos, hay que releer capabilities y actualizar aquí.
const HISTORY_CAP = {
  lastWatering: 'devicecapabilities_text-custom_40.text2',
  totalDurationMin: 'measure_devicecapabilities_number.number4',
  totalWaterLiters: 'measure_devicecapabilities_number.number5',
  accumulatedLiters: 'measure_devicecapabilities_number.number21',

  timestamp: 'devicecapabilities_text-custom_61.text3',
  program: 'devicecapabilities_text-custom_20.text4',
  sectorLastWatering: {
    1: 'devicecapabilities_text-custom_40.text1',
    2: 'devicecapabilities_text-custom_40.text5',
    3: 'devicecapabilities_text-custom_40.text6',
    4: 'devicecapabilities_text-custom_40.text7',
    5: 'devicecapabilities_text-custom_40.text8',
    6: 'devicecapabilities_text-custom_40.text9',
  },

  sectorDurationMin: {
    1: 'measure_devicecapabilities_number.number1',
    2: 'measure_devicecapabilities_number.number6',
    3: 'measure_devicecapabilities_number.number9',
    4: 'measure_devicecapabilities_number.number12',
    5: 'measure_devicecapabilities_number.number15',
    6: 'measure_devicecapabilities_number.number18',
  },
  sectorLiters: {
    1: 'measure_devicecapabilities_number.number2',
    2: 'measure_devicecapabilities_number.number7',
    3: 'measure_devicecapabilities_number.number10',
    4: 'measure_devicecapabilities_number.number13',
    5: 'measure_devicecapabilities_number.number16',
    6: 'measure_devicecapabilities_number.number19',
  },
  sectorAvgFlow: {
    1: 'measure_devicecapabilities_number.number3',
    2: 'measure_devicecapabilities_number.number8',
    3: 'measure_devicecapabilities_number.number11',
    4: 'measure_devicecapabilities_number.number14',
    5: 'measure_devicecapabilities_number.number17',
    6: 'measure_devicecapabilities_number.number20',
  },

  wateringCount: 'measure_devicecapabilities_number.number22',
  accumulatedDurationMin: 'measure_devicecapabilities_number.number23',
};

async function getDevice(id) {
  return await Homey.devices.getDevice({ id });
}

async function getLogicVariableByName(name) {
  const variables = await Homey.logic.getVariables();
  return Object.values(variables).find(variable => variable.name === name) || null;
}

async function getLogicValue(name, fallback = null) {
  const variable = await getLogicVariableByName(name);
  return variable ? variable.value : fallback;
}

async function setLogicValue(name, value, type = 'string') {
  const variable = await getLogicVariableByName(name);

  if (!variable) {
    await Homey.logic.createVariable({
      variable: {
        name,
        type,
        value,
      },
    });
    return;
  }

  await Homey.logic.updateVariable({
    id: variable.id,
    variable: {
      value,
    },
  });
}

async function getLatestEngineHistoryEntry() {
  try {
    const rawValue = await getLogicValue(VAR.engineHistory, '[]');
    const entries = rawValue ? JSON.parse(rawValue) : [];

    if (!Array.isArray(entries) || entries.length === 0) {
      return null;
    }

    return entries[0];
  } catch (error) {
    console.log(`History fallback read failed: ${error.message}`);
    return null;
  }
}

function getValue(device, capability, fallback = null) {
  return device?.capabilitiesObj?.[capability]?.value ?? fallback;
}

async function setCapabilityIfNeeded(device, capability, value) {
  const capabilityObj = device.capabilitiesObj?.[capability];

  if (!capabilityObj) {
    console.log(`SKIP ${capability}: capability not found`);
    return;
  }

  const current = capabilityObj.value;
  if (current === value) return;

  try {
    await device.setCapabilityValue(capability, value);
    console.log(`SET ${capability}: ${current} -> ${value}`);
  } catch (error) {
    console.log(`SKIP ${capability}: ${error.message}`);
  }
}

function parseArgs() {
  if (TEST_INPUT) {
    console.log(`History TEST_INPUT used: ${JSON.stringify(TEST_INPUT)}`);
    return TEST_INPUT;
  }

  if (typeof args === 'undefined' || args === null) {
    console.log('History args: undefined/null');
    return {};
  }

  console.log(`History raw args type: ${typeof args}`);
  console.log(`History raw args value: ${JSON.stringify(args)}`);

  let value = args;

  if (Array.isArray(value)) {
    value = value[0];
  }

  if (value && typeof value === 'object') {
    return value;
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.log(`Argument is not valid JSON, ignored: ${value}`);
    return {};
  }
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString('es-ES', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function writeVisibleDiagnostic(history, message) {
  const timestamp = formatTimestamp();
  await setCapabilityIfNeeded(history, HISTORY_CAP.lastWatering, message.slice(0, 250));
  await setCapabilityIfNeeded(history, HISTORY_CAP.timestamp, timestamp);
}

async function main() {
  let input = parseArgs();

  if (!input || Object.keys(input).length === 0) {
    const latestEntry = await getLatestEngineHistoryEntry();

    if (latestEntry) {
      input = {
        id: latestEntry.id,
        sector: latestEntry.sector,
        source: latestEntry.source,
        origin: latestEntry.source,
        reason: latestEntry.reason,
        endTs: latestEntry.endTs,
        durationMin: latestEntry.reason === 'timeout'
          ? latestEntry.plannedDurationMin
          : latestEntry.durationRealMin,
        liters: latestEntry.liters,
        program: 'manual',
      };
      console.log(`History fallback input from engine history: ${JSON.stringify(input)}`);
    }
  }

  console.log(`History input: ${JSON.stringify(input)}`);

  const system = await getDevice(DEVICES.system);
  const history = await getDevice(DEVICES.history);
  let raw = null;

  if (input.liters === undefined || input.liters === null) {
    try {
      raw = await getDevice(DEVICES.raw);
    } catch (error) {
      console.log(`History RAW read skipped: ${error.message}`);
    }
  }

  const sector = Number(input.sector ?? getValue(system, SYSTEM_CAP.sector, 0));
  const durationMin = round(Number(input.durationMin ?? 0), 2);
  const program = String(input.program ?? getValue(system, SYSTEM_CAP.program, 'manual') ?? 'manual');
  const origin = String(input.origin ?? getValue(system, SYSTEM_CAP.origin, 'MANUAL') ?? 'MANUAL');
  const reason = String(input.reason ?? 'completed');
  const eventEndTs = Number(input.endTs ?? Date.now());
  const eventId = String(input.id ?? `${eventEndTs}-${sector}`);
  console.log(`History resolved: sector=${sector}, durationMin=${durationMin}, program=${program}, origin=${origin}, reason=${reason}`);

  if (!Number.isInteger(sector) || sector < 1 || sector > 6) {
    const message = `HISTORY error · sector inválido=${sector} · input=${JSON.stringify(input).slice(0, 120)}`;
    console.log(message);
    await writeVisibleDiagnostic(history, message);
    return;
  }

  const liters = round(input.liters ?? getValue(raw, RAW_CAP.lastLiters[sector], 0), 2);
  console.log(`History liters resolved: ${liters}`);
  const avgFlow = durationMin > 0 ? round(liters / durationMin, 2) : 0;
  const timestamp = formatTimestamp(new Date(eventEndTs));
  const lastWateringText = `S${sector} · ${liters} L · ${durationMin} min · ${reason}`;
  const sectorText = `${timestamp} · ${liters} L · ${durationMin} min`;

  const lastProjectedHistoryId = String(await getLogicValue(VAR.lastProjectedHistoryId, ''));
  if (eventId && lastProjectedHistoryId === eventId) {
    console.log(`History skipped: event already projected. id=${eventId} sector=${sector}`);
    return;
  }

  const previousAccumulatedLiters = Number(getValue(history, HISTORY_CAP.accumulatedLiters, 0)) || 0;
  const previousWateringCount = Number(getValue(history, HISTORY_CAP.wateringCount, 0)) || 0;
  const previousAccumulatedDuration = Number(getValue(history, HISTORY_CAP.accumulatedDurationMin, 0)) || 0;

  await setCapabilityIfNeeded(history, HISTORY_CAP.lastWatering, lastWateringText);
  await setCapabilityIfNeeded(history, HISTORY_CAP.timestamp, timestamp);
  await setCapabilityIfNeeded(history, HISTORY_CAP.program, `${origin}/${program}`);
  await setCapabilityIfNeeded(history, HISTORY_CAP.totalDurationMin, durationMin);
  await setCapabilityIfNeeded(history, HISTORY_CAP.totalWaterLiters, liters);

  await setCapabilityIfNeeded(history, HISTORY_CAP.sectorLastWatering[sector], sectorText);
  await setCapabilityIfNeeded(history, HISTORY_CAP.sectorDurationMin[sector], durationMin);
  await setCapabilityIfNeeded(history, HISTORY_CAP.sectorLiters[sector], liters);
  await setCapabilityIfNeeded(history, HISTORY_CAP.sectorAvgFlow[sector], avgFlow);

  await setCapabilityIfNeeded(history, HISTORY_CAP.accumulatedLiters, round(previousAccumulatedLiters + liters, 2));
  await setCapabilityIfNeeded(history, HISTORY_CAP.wateringCount, previousWateringCount + 1);
  await setCapabilityIfNeeded(history, HISTORY_CAP.accumulatedDurationMin, round(previousAccumulatedDuration + durationMin, 2));
  await setLogicValue(VAR.lastProjectedHistoryId, eventId, 'string');

  console.log(`Irrigation History updated: id=${eventId}, S${sector}, ${liters} L, ${durationMin} min, ${avgFlow} L/min`);
}

await main();
