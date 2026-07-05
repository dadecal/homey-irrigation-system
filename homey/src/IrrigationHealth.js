'use strict';

// =========================================================
// Irrigation Health
// Supervisa el hardware ESPHome sin controlar motor, cola ni relés.
// Orden de publicación: persistencia -> trigger -> interfaz.
// =========================================================

const DEVICES = {
  raw: '1120df26-8201-49de-b262-8fb98289d811',
  system: '611125df-85eb-4fa0-bce1-aabbbdabc55e',
};

const SYSTEM_CAP = {
  watchdog: 'devicecapabilities_text-custom_15.text6',
  espConnected: 'devicecapabilities_text-custom_7.text7',
};

const VAR = {
  health: 'Irrigation.Health',
  eventMessage: 'Irrigation.HealthEventMessage',
  trigger: 'Irrigation.HealthTrigger',
  engineState: 'Irrigation.State',
  activeSector: 'Irrigation.ActiveSector',
  stopReason: 'Irrigation.StopReason',
  engineEndTs: 'Irrigation.EndTimestamp',
  lastTickTs: 'Irrigation.LastTickTimestamp',
};

const GENERIC_WARN_TTL_MS = 15 * 60 * 1000;
const GENERIC_ERROR_TTL_MS = 30 * 60 * 1000;
const LOOP_WARNING_MS = 200;
const HEAP_WARNING_BYTES = 30000;
const ENGINE_TICK_STALE_MS = 3 * 60 * 1000;
const ENGINE_END_OVERDUE_MS = 2 * 60 * 1000;

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function descriptor(capabilityId, capability) {
  return normalize([
    capabilityId,
    capability?.title,
    capability?.name,
    capability?.opts?.title,
  ].filter(Boolean).join(' '));
}

function capabilities(raw) {
  return Object.entries(raw?.capabilitiesObj || {})
    .map(([id, capability]) => ({
      id,
      value: capability?.value,
      descriptor: descriptor(id, capability),
    }));
}

function findAll(entries, ...terms) {
  const normalizedTerms = terms.map(normalize);
  return entries.filter(entry => normalizedTerms.every(term => entry.descriptor.includes(term)));
}

function findOne(entries, ...terms) {
  return findAll(entries, ...terms)[0] || null;
}

function isActive(value) {
  return value === true || value === 1 || ['true', 'on', 'yes', 'si'].includes(normalize(value));
}

function finiteNumber(entry) {
  const value = Number(entry?.value);
  return Number.isFinite(value) ? value : null;
}

function sectorFrom(entry) {
  return entry?.descriptor.match(/(?:linea|l)[ _-]*(\d)/)?.[1] || null;
}

function issue(code, severity, component, message, previousByCode, now, extra = {}) {
  return {
    code,
    severity,
    component,
    message,
    firstSeenTs: previousByCode[code]?.firstSeenTs || now,
    lastSeenTs: now,
    ...extra,
  };
}

function parseHealth(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    return {};
  }
}

async function getLogicVariable(name) {
  const variables = await Homey.logic.getVariables();
  return Object.values(variables).find(variable => variable.name === name) || null;
}

async function getLogicValue(name, fallback = null) {
  const variable = await getLogicVariable(name);
  return variable ? variable.value : fallback;
}

async function setLogicValue(name, value, type) {
  const variable = await getLogicVariable(name);
  if (!variable) {
    await Homey.logic.createVariable({ variable: { name, type, value } });
    return;
  }
  if (variable.value === value) return;
  await Homey.logic.updateVariable({ id: variable.id, variable: { value } });
}

async function setCapabilityIfNeeded(device, capability, value) {
  const current = device?.capabilitiesObj?.[capability]?.value;
  if (!device?.capabilitiesObj?.[capability] || current === value) return;
  await device.setCapabilityValue(capability, value);
}

function statusFromIssues(issues) {
  if (issues.some(item => item.severity === 'OFFLINE')) return 'OFFLINE';
  if (issues.some(item => item.severity === 'ERROR')) return 'ERROR';
  if (issues.some(item => item.severity === 'WARNING')) return 'WARNING';
  return 'OK';
}

function summarize(status, issues) {
  if (status === 'OK') return 'OK - hardware sin incidencias';
  const first = issues.find(item => item.code.startsWith('ENGINE_')) || issues[0];
  return `${status} - ${first.message}`.slice(0, 240);
}

function signatureOf(health) {
  return JSON.stringify({
    status: health.status,
    issues: health.issues.map(item => [item.code, item.severity]),
    lastEspSequence: health.telemetry.lastEspSequence,
  });
}

async function main() {
  const now = Date.now();
  const previous = parseHealth(await getLogicValue(VAR.health, '{}'));
  const previousIssues = Array.isArray(previous.issues) ? previous.issues : [];
  const previousByCode = Object.fromEntries(previousIssues.map(item => [item.code, item]));
  const issues = [];

  const engineState = await getLogicValue(VAR.engineState, 'IDLE');
  const activeSector = Number(await getLogicValue(VAR.activeSector, 0)) || 0;
  const stopReason = String(await getLogicValue(VAR.stopReason, 'none') || 'none');
  const engineEndTs = Number(await getLogicValue(VAR.engineEndTs, 0));
  const lastTickTs = Number(await getLogicValue(VAR.lastTickTs, 0));
  if (engineState === 'ERROR') {
    issues.push(issue(
      'ENGINE_STOP_UNCONFIRMED', 'ERROR', 'Motor',
      activeSector > 0
        ? `Riego interrumpido: no se ha confirmado el cierre de la electroválvula del sector ${activeSector}`
        : 'Riego interrumpido: comprobar que todas las electroválvulas están cerradas',
      previousByCode, now, { sector: activeSector, stopReason },
    ));
  }
  if (engineState === 'RUNNING' && (
    (lastTickTs > 0 && now - lastTickTs > ENGINE_TICK_STALE_MS)
    || (engineEndTs > 0 && now - engineEndTs > ENGINE_END_OVERDUE_MS)
  )) {
    issues.push(issue(
      'ENGINE_TICK_STALE', 'ERROR', 'Homey',
      'Motor RUNNING sin mantenimiento periódico; revisar relés', previousByCode, now,
    ));
  }

  let raw = null;
  try {
    raw = await Homey.devices.getDevice({ id: DEVICES.raw });
  } catch (error) {
    console.log(`RAW unavailable: ${error.message}`);
  }

  const available = Boolean(raw) && raw.available !== false;
  const entries = capabilities(raw);

  if (!available && engineState === 'RUNNING') {
    issues.push(issue(
      'ENGINE_CONTROLLER_OFFLINE', 'OFFLINE', 'Motor',
      activeSector > 0
        ? `Conexión perdida durante el riego: comprobar la electroválvula del sector ${activeSector}`
        : 'Conexión perdida durante el riego: comprobar las electroválvulas',
      previousByCode, now, { sector: activeSector },
    ));
  }

  let sequence = Number(previous.telemetry?.lastEspSequence || 0);
  let uptime = null;
  let lastEvent = previous.lastEvent || null;

  if (!available) {
    issues.push(issue(
      'ESP_OFFLINE', 'OFFLINE', 'ESP32',
      'Controlador ESP32 desconectado', previousByCode, now,
    ));
  } else {
    const sequenceEntry = findOne(entries, 'esp', 'secuencia', 'error');
    const levelEntry = findOne(entries, 'esp', 'nivel', 'error');
    const componentEntry = findOne(entries, 'esp', 'componente', 'error');
    const messageEntry = findOne(entries, 'esp', 'ultimo', 'error');

    if (!sequenceEntry || !levelEntry || !componentEntry || !messageEntry) {
      issues.push(issue(
        'HEALTH_TELEMETRY_MISSING', 'WARNING', 'ESPHome',
        'Telemetría genérica de errores no disponible', previousByCode, now,
      ));
    } else {
      const currentSequence = finiteNumber(sequenceEntry) ?? 0;
      const previousSequence = Number(previous.telemetry?.lastEspSequence || 0);

      if (currentSequence > previousSequence) {
        const level = normalize(levelEntry.value) === 'error' ? 'ERROR' : 'WARNING';
        const ttl = level === 'ERROR' ? GENERIC_ERROR_TTL_MS : GENERIC_WARN_TTL_MS;
        lastEvent = {
          sequence: currentSequence,
          level,
          component: String(componentEntry.value || 'ESPHome'),
          message: stripAnsi(messageEntry.value || 'Error ESPHome no categorizado'),
          detectedTs: now,
          expiresTs: now + ttl,
        };
      }
      sequence = currentSequence;
    }

    if (lastEvent?.expiresTs > now) {
      issues.push(issue(
        `ESPHOME_${lastEvent.level}_${lastEvent.sequence}`,
        lastEvent.level,
        lastEvent.component,
        lastEvent.message,
        previousByCode,
        now,
        { expiresTs: lastEvent.expiresTs },
      ));
    }

    for (const entry of findAll(entries, 'fuga').filter(item => isActive(item.value))) {
      const sector = sectorFrom(entry);
      const code = `LEAK_${sector || entry.id}`;
      issues.push(issue(
        code, 'ERROR', sector ? `Línea ${sector}` : 'Riego',
        sector ? `Caudal detectado con la línea ${sector} cerrada` : 'Caudal detectado con relés cerrados',
        previousByCode, now,
      ));
    }

    for (const entry of findAll(entries, 'fallo', 'actuacion').filter(item => isActive(item.value))) {
      const sector = sectorFrom(entry);
      const code = `ACTUATION_FAILURE_${sector || entry.id}`;
      issues.push(issue(
        code, 'ERROR', sector ? `Línea ${sector}` : 'Riego',
        sector ? `Línea ${sector} activa sin caudal` : 'Riego activo sin caudal',
        previousByCode, now,
      ));
    }

    const relayConflict = findOne(entries, 'conflicto', 'rele');
    if (relayConflict && isActive(relayConflict.value)) {
      issues.push(issue(
        'RELAY_CONFLICT', 'ERROR', 'Relés',
        'Hay varios relés de riego activos simultáneamente', previousByCode, now,
      ));
    }

    const overheat = findOne(entries, 'sobrecalentamiento');
    if (overheat && isActive(overheat.value)) {
      issues.push(issue(
        'ESP_OVERHEAT', 'ERROR', 'ESP32',
        'Protección térmica activada', previousByCode, now,
      ));
    }

    const loopMs = finiteNumber(findOne(entries, 'tiempo', 'loop'));
    if (loopMs !== null && loopMs > LOOP_WARNING_MS) {
      issues.push(issue(
        'ESP_LOOP_SLOW', 'WARNING', 'ESP32',
        `Tiempo de loop elevado: ${Math.round(loopMs)} ms`, previousByCode, now,
      ));
    }

    const heap = finiteNumber(findOne(entries, 'heap', 'libre'));
    if (heap !== null && heap < HEAP_WARNING_BYTES) {
      issues.push(issue(
        'ESP_HEAP_LOW', 'WARNING', 'ESP32',
        `Memoria libre baja: ${Math.round(heap)} bytes`, previousByCode, now,
      ));
    }

    uptime = finiteNumber(findOne(entries, 'uptime'));
    const previousUptime = Number(previous.telemetry?.uptimeSeconds);
    if (uptime !== null && Number.isFinite(previousUptime) && uptime + 60 < previousUptime) {
      issues.push(issue(
        'ESP_RESTARTED', 'WARNING', 'ESP32',
        'El controlador ESP32 se ha reiniciado', previousByCode, now,
        { expiresTs: now + GENERIC_WARN_TTL_MS },
      ));
    } else if (previousByCode.ESP_RESTARTED?.expiresTs > now) {
      issues.push({ ...previousByCode.ESP_RESTARTED, lastSeenTs: now });
    }
  }

  issues.sort((a, b) => {
    const rank = { OFFLINE: 3, ERROR: 2, WARNING: 1 };
    return (rank[b.severity] || 0) - (rank[a.severity] || 0) || a.code.localeCompare(b.code);
  });

  const health = {
    version: 1,
    status: statusFromIssues(issues),
    updatedTs: now,
    issues,
    lastEvent,
    telemetry: {
      lastEspSequence: sequence,
      uptimeSeconds: uptime,
      lastTickTs,
      engineState,
      activeSector,
      stopReason,
    },
  };

  const previousSignature = signatureOf({
    status: previous.status || 'OK',
    issues: previousIssues,
    telemetry: { lastEspSequence: Number(previous.telemetry?.lastEspSequence || 0) },
  });
  const currentSignature = signatureOf(health);
  const changed = currentSignature !== previousSignature;
  const summary = summarize(health.status, issues);

  // 1. Persistencia
  await setLogicValue(VAR.health, JSON.stringify(health), 'string');

  // 2. Trigger: solo ante transición o nuevo evento ESPHome
  if (changed) {
    await setLogicValue(VAR.eventMessage, summary, 'string');
    await setLogicValue(VAR.trigger, now, 'number');
  }

  // 3. Proyección UI
  try {
    const system = await Homey.devices.getDevice({ id: DEVICES.system });
    await setCapabilityIfNeeded(system, SYSTEM_CAP.watchdog, summary);
    await setCapabilityIfNeeded(system, SYSTEM_CAP.espConnected, available ? 'Conectado' : 'Desconectado');
  } catch (error) {
    console.log(`System projection skipped: ${error.message}`);
  }

  console.log(`Irrigation Health: ${summary}`);
}

await main();
