'use strict';

let HomeyRef = null;
let savedSnapshot = '';
let busy = false;
let leaveWarningShown = false;

const { calculateEndTime, snapshotConfig } = window.IrrigationSettingsCalculations;

const fields = {
  enabled: document.getElementById('enabled'),
  notifySectorStart: document.getElementById('notifySectorStart'),
  notifySectorEnd: document.getElementById('notifySectorEnd'),
  startTime: document.getElementById('startTime'),
  endTime: document.getElementById('endTime'),
  intervalDays: document.getElementById('intervalDays'),
  sectorDurations: document.getElementById('sectorDurations'),
  statusText: document.getElementById('statusText'),
  nextRun: document.getElementById('nextRun'),
  rainDelayText: document.getElementById('rainDelayText'),
  notice: document.getElementById('notice'),
  saveButton: document.getElementById('saveButton'),
  clearRainDelay: document.getElementById('clearRainDelay'),
};

function callApi(method, path, body) {
  return new Promise((resolve, reject) => {
    HomeyRef.api(method, path, body || {}, (error, result) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    });
  });
}

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Sin proximo riego';
  }

  return new Date(timestamp).toLocaleString('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function renderSectorInputs(config) {
  fields.sectorDurations.querySelectorAll('input').forEach(input => {
    input.value = String(config.sectorDurations[input.dataset.sector] || 0);
  });
}

function showNotice(message, isError = false) {
  fields.notice.textContent = message;
  fields.notice.classList.toggle('visible', Boolean(message));
  fields.notice.classList.toggle('error', isError);
}

function isDirty() {
  return Boolean(savedSnapshot) && snapshotConfig(readForm()) !== savedSnapshot;
}

function updateActionState() {
  const dirty = isDirty();
  fields.saveButton.disabled = busy || !dirty;
  fields.clearRainDelay.disabled = busy || dirty;
  document.querySelectorAll('[data-rain-delay]').forEach(button => {
    button.disabled = busy || dirty;
  });
}

function setBusy(value) {
  busy = value;
  updateActionState();
}

function readForm() {
  const sectorDurations = {};
  fields.sectorDurations.querySelectorAll('input').forEach(input => {
    sectorDurations[input.dataset.sector] = Number(input.value);
  });

  return {
    enabled: fields.enabled.checked,
    notifySectorStart: fields.notifySectorStart.checked,
    notifySectorEnd: fields.notifySectorEnd.checked,
    startTime: fields.startTime.value,
    intervalDays: Number(fields.intervalDays.value),
    sectorDurations,
  };
}

function renderEndTime() {
  const form = readForm();
  const result = calculateEndTime(form.startTime, form.sectorDurations);
  if (!result) {
    fields.endTime.textContent = '--:--';
    return;
  }

  const daySuffix = result.daysLater === 1
    ? ' (día siguiente)'
    : result.daysLater > 1 ? ` (+${result.daysLater} días)` : '';
  fields.endTime.textContent = `${result.time}${daySuffix}`;
}

function handleFormChange() {
  renderEndTime();
  updateActionState();
  showNotice(isDirty() ? 'Hay cambios sin guardar' : '');
}

function renderState(state) {
  const { config, status, nextRunTs, message } = state;

  fields.enabled.checked = Boolean(config.enabled);
  fields.notifySectorStart.checked = Boolean(config.notifySectorStart);
  fields.notifySectorEnd.checked = Boolean(config.notifySectorEnd);
  fields.startTime.value = config.startTime;
  fields.intervalDays.value = String(config.intervalDays);
  const statusLabels = {
    DISABLED: 'Desactivado',
    READY: 'Preparado',
    RAIN_DELAY: 'Rain Delay activo',
    INVALID_CONFIG: 'Configuracion incompleta',
    ERROR: 'Error',
  };

  fields.statusText.textContent = `${statusLabels[status] || status}. ${message}`;
  fields.nextRun.textContent = formatTimestamp(nextRunTs);
  fields.rainDelayText.textContent = config.rainDelayUntil > Date.now()
    ? `Hasta ${formatTimestamp(config.rainDelayUntil)}`
    : 'Sin aplazamiento';
  renderSectorInputs(config);
  savedSnapshot = snapshotConfig(readForm());
  renderEndTime();
  updateActionState();
}

async function load() {
  const state = await callApi('GET', '/status');
  renderState(state);
}

async function save() {
  setBusy(true);
  fields.saveButton.textContent = 'Guardando...';
  showNotice('');

  try {
    const state = await callApi('PUT', '/config', readForm());
    renderState(state);
    showNotice('Configuracion guardada');
  } catch (error) {
    showNotice(error.message || 'No se pudo guardar la configuracion', true);
    HomeyRef.alert(error.message || 'No se pudo guardar la configuracion');
  } finally {
    setBusy(false);
    fields.saveButton.textContent = 'Guardar cambios';
  }
}

async function setRainDelay(hours) {
  setBusy(true);
  showNotice('');
  try {
    const state = await callApi('POST', '/rain-delay', { hours });
    renderState(state);
    showNotice(`Rain Delay de ${hours} horas aplicado`);
  } catch (error) {
    showNotice(error.message || 'No se pudo aplicar Rain Delay', true);
    HomeyRef.alert(error.message || 'No se pudo aplicar Rain Delay');
  } finally {
    setBusy(false);
  }
}

async function clearRainDelay() {
  setBusy(true);
  showNotice('');
  try {
    const state = await callApi('DELETE', '/rain-delay');
    renderState(state);
    showNotice('Rain Delay cancelado');
  } catch (error) {
    showNotice(error.message || 'No se pudo cancelar Rain Delay', true);
    HomeyRef.alert(error.message || 'No se pudo cancelar Rain Delay');
  } finally {
    setBusy(false);
  }
}

window.onHomeyReady = async Homey => {
  HomeyRef = Homey;

  fields.saveButton.addEventListener('click', save);
  fields.clearRainDelay.addEventListener('click', clearRainDelay);
  document.querySelectorAll('[data-rain-delay]').forEach(button => {
    button.addEventListener('click', () => setRainDelay(Number(button.dataset.rainDelay)));
  });
  document.querySelectorAll('input').forEach(input => {
    input.addEventListener('input', handleFormChange);
    input.addEventListener('change', handleFormChange);
  });
  window.addEventListener('beforeunload', event => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('blur', () => {
    if (!isDirty() || leaveWarningShown) return;
    leaveWarningShown = true;
    HomeyRef.alert('Hay cambios sin guardar. Si sales ahora, se perderán.');
  });
  window.addEventListener('focus', () => {
    leaveWarningShown = false;
  });

  try {
    await load();
  } catch (error) {
    fields.statusText.textContent = 'No se pudo cargar la configuracion';
    showNotice(error.message || 'Comprueba la conexion con Homey', true);
  } finally {
    Homey.ready();
  }
};
