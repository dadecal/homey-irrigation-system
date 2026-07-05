'use strict';

// =========================================================
// Irrigation Status
// Sincroniza sensores ESPHome -> Dispositivo "Sistema de Riego"
// =========================================================

const DEVICES = {
  raw: '1120df26-8201-49de-b262-8fb98289d811',
  temperatureSensor: '2a22d882-f38d-4efb-8735-fb54d4cabd6e',
  humiditySensor: 'c0d42117-3cf9-4a1e-861f-a376104ee83f',
  system: '611125df-85eb-4fa0-bce1-aabbbdabc55e',
};

const SYSTEM_CAP = {
  temperature: 'devicecapabilities_number-custom_26.number4',
  humidity: 'devicecapabilities_number-custom_22.number5',
  cpuTemperature: 'devicecapabilities_number-custom_26.number6',
  leak: 'devicecapabilities_text-custom_38.text5',
  espConnected: 'devicecapabilities_text-custom_7.text7',
};

async function getDevice(id) {
  return await Homey.devices.getDevice({ id });
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

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function capabilityDescriptor(capabilityId, capability) {
  return normalize([
    capabilityId,
    capability?.title,
    capability?.name,
    capability?.opts?.title,
  ].filter(Boolean).join(' '));
}

function findCapabilitiesByText(device, requiredTerms) {
  return Object.entries(device?.capabilitiesObj || {})
    .filter(([capabilityId, capability]) => {
      const descriptor = capabilityDescriptor(capabilityId, capability);
      return requiredTerms.every(term => descriptor.includes(normalize(term)));
    })
    .map(([id, capability]) => ({ id, ...capability }));
}

function isActive(value) {
  return value === true || value === 1 || ['true', 'on', 'yes', 'si'].includes(normalize(value));
}

function getLeakStatus(raw) {
  const leakCapabilities = findCapabilitiesByText(raw, ['fuga']);
  if (leakCapabilities.length === 0) return 'Sin datos';

  const activeLeaks = leakCapabilities.filter(capability => isActive(capability.value));
  if (activeLeaks.length === 0) return 'No detectada';

  const sectors = activeLeaks
    .map(capability => capabilityDescriptor(capability.id, capability).match(/(?:linea|l)[ _-]*(\d)/)?.[1])
    .filter(Boolean);

  return sectors.length > 0
    ? `Detectada: línea ${[...new Set(sectors)].join(', ')}`
    : 'Detectada';
}

async function main() {
  const system = await getDevice(DEVICES.system);

  let raw = null;
  let rawAvailable = false;

  try {
    raw = await getDevice(DEVICES.raw);
    rawAvailable = raw?.available !== false;
  } catch (error) {
    console.log(`RAW unavailable: ${error.message}`);
  }

  try {
    const temp = await getDevice(DEVICES.temperatureSensor);
    await setCapabilityIfNeeded(system, SYSTEM_CAP.temperature,
      temp.capabilitiesObj?.measure_temperature?.value ?? null);
  } catch (error) {
    console.log(`Temperature sensor unavailable: ${error.message}`);
  }

  try {
    const hum = await getDevice(DEVICES.humiditySensor);
    await setCapabilityIfNeeded(system, SYSTEM_CAP.humidity,
      hum.capabilitiesObj?.measure_humidity?.value ?? null);
  } catch (error) {
    console.log(`Humidity sensor unavailable: ${error.message}`);
  }

  await setCapabilityIfNeeded(system, SYSTEM_CAP.cpuTemperature,
    rawAvailable ? raw?.capabilitiesObj?.['measure_temperature.esp_internal']?.value ?? null : null);

  await setCapabilityIfNeeded(system, SYSTEM_CAP.leak,
    rawAvailable ? getLeakStatus(raw) : 'Sin conexión');
  await setCapabilityIfNeeded(system, SYSTEM_CAP.espConnected, rawAvailable ? 'Conectado' : 'Desconectado');

  console.log('Irrigation Status sync completed');
}

await main();
