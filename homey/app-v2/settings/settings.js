'use strict';

let HomeyRef = null;
let savedSnapshot = '';
let busy = false;
let leaveWarningShown = false;
let activeTab = 'schedule';
let recoveryCanResume = false;

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
  recoveryPanel: document.getElementById('recoveryPanel'),
  recoveryStatusText: document.getElementById('recoveryStatusText'),
  recoveryMessage: document.getElementById('recoveryMessage'),
  recoverySector: document.getElementById('recoverySector'),
  recoveryQueue: document.getElementById('recoveryQueue'),
  resumePendingButton: document.getElementById('resumePendingButton'),
  cancelPendingButton: document.getElementById('cancelPendingButton'),
  refreshDiagnostics: document.getElementById('refreshDiagnostics'),
  diagnosticHealth: document.getElementById('diagnosticHealth'),
  diagnosticRecovery: document.getElementById('diagnosticRecovery'),
  diagnosticEngine: document.getElementById('diagnosticEngine'),
  diagnosticPreflight: document.getElementById('diagnosticPreflight'),
  diagnosticEvents: document.getElementById('diagnosticEvents'),
  tabButtons: Array.from(document.querySelectorAll('[data-tab-target]')),
  tabPanels: Array.from(document.querySelectorAll('[data-tab-panel]')),
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

function formatShortTimestamp(timestamp) {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderSectorInputs(config) {
  fields.sectorDurations.querySelectorAll('input').forEach(input => {
    input.value = String(config.sectorDurations[input.dataset.sector] || 0);
  });
}

function renderDiagnostics(diagnostics) {
  if (!diagnostics) return;

  const health = diagnostics.health?.state;
  const recovery = diagnostics.recovery?.state;
  const engine = diagnostics.engine?.state;
  const preflight = diagnostics.scheduler?.diagnostic?.lastPreflight;
  const preflightBlock = diagnostics.scheduler?.config?.preflightBlock;

  fields.diagnosticHealth.textContent = health?.status || 'OK';
  fields.diagnosticRecovery.textContent = recovery?.awaitingRecovery
    ? 'Recuperando'
    : recovery?.restartBlockedReason || recovery?.lastMessage || 'OK';
  fields.diagnosticEngine.textContent = `${engine?.state || 'IDLE'} S${Number(engine?.activeSector || 0)}`;
  fields.diagnosticPreflight.textContent = preflightBlock
    ? `${preflightBlock.code} ${preflightBlock.attempts || 0}x`
    : preflight?.code || 'OK';

  const events = Array.isArray(diagnostics.events) ? diagnostics.events.slice(0, 8) : [];
  fields.diagnosticEvents.innerHTML = '';
  if (events.length === 0) {
    const item = document.createElement('li');
    item.textContent = 'Sin eventos recientes';
    fields.diagnosticEvents.appendChild(item);
    return;
  }

  events.forEach(event => {
    const item = document.createElement('li');
    const time = document.createElement('span');
    const message = document.createElement('strong');
    time.textContent = formatShortTimestamp(event.ts);
    message.textContent = event.message || event.status || event.type || 'Evento';
    item.appendChild(time);
    item.appendChild(message);
    fields.diagnosticEvents.appendChild(item);
  });
}

function formatPendingQueue(queue) {
  if (!Array.isArray(queue) || queue.length === 0) {
    return 'Sin sectores pendientes';
  }

  return queue
    .map(item => `S${item.sector}:${item.duration} min`)
    .join(', ');
}

function renderRecovery(engineStatus) {
  const engine = engineStatus?.engine || null;
  const interruption = engine?.interruption || null;
  fields.recoveryPanel.hidden = !interruption;

  if (!interruption) {
    recoveryCanResume = false;
    return;
  }

  const ready = interruption.status === 'READY_TO_RESUME'
    && engineStatus.rawAvailable !== false
    && !(engineStatus.lastCheck?.hardware?.anyRelayOn);
  recoveryCanResume = ready && Boolean(engine.queueLength);
  fields.recoveryStatusText.textContent = ready ? 'Lista para reanudar' : 'Esperando confirmacion';
  fields.recoveryMessage.textContent = interruption.message || 'Hay un programa interrumpido pendiente de revision.';
  fields.recoverySector.textContent = `Sector interrumpido: S${Number(interruption.sector || engine.activeSector || 0)}`;
  fields.recoveryQueue.textContent = `Pendientes: ${formatPendingQueue(engine.queue || interruption.pendingQueue)}`;
  fields.resumePendingButton.disabled = busy || !recoveryCanResume;
  fields.cancelPendingButton.disabled = busy;
}

function showNotice(message, isError = false) {
  fields.notice.textContent = message;
  fields.notice.classList.toggle('visible', Boolean(message));
  fields.notice.classList.toggle('error', isError);
}

function setActiveTab(tabName) {
  if (!['schedule', 'diagnostics'].includes(tabName)) return;
  const changed = activeTab !== tabName;
  activeTab = tabName;

  fields.tabButtons.forEach(button => {
    const isActive = button.dataset.tabTarget === tabName;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  fields.tabPanels.forEach(panel => {
    const isActive = panel.dataset.tabPanel === tabName;
    panel.classList.toggle('active', isActive);
    panel.hidden = !isActive;
  });

  if (changed && tabName === 'diagnostics' && HomeyRef) {
    refreshDiagnostics();
  }
}

function isDirty() {
  return Boolean(savedSnapshot) && snapshotConfig(readForm()) !== savedSnapshot;
}

function updateActionState() {
  const dirty = isDirty();
  fields.saveButton.disabled = busy || !dirty;
  fields.saveButton.classList.toggle('dirty', dirty && !busy);
  if (dirty) fields.saveButton.classList.remove('saved');
  fields.clearRainDelay.disabled = busy;
  if (!fields.recoveryPanel.hidden) {
    fields.resumePendingButton.disabled = busy || !recoveryCanResume;
    fields.cancelPendingButton.disabled = busy;
  }
  document.querySelectorAll('[data-rain-delay]').forEach(button => {
    button.disabled = busy;
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
  const schedulerState = state.scheduler || state;
  const { config, status, nextRunTs, message } = schedulerState;

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
  const [state, diagnostics, engineStatus] = await Promise.all([
    callApi('GET', '/status'),
    callApi('GET', '/diagnostics/status'),
    callApi('GET', '/engine/status'),
  ]);
  renderState(state);
  renderDiagnostics(diagnostics);
  renderRecovery(engineStatus);
}

async function save() {
  setBusy(true);
  fields.saveButton.textContent = 'Guardando...';
  showNotice('');

  try {
    const state = await callApi('PUT', '/config', readForm());
    renderState(state);
    showNotice('Configuracion guardada');
    fields.saveButton.textContent = 'Guardado';
    fields.saveButton.classList.add('saved');
    window.setTimeout(() => {
      fields.saveButton.classList.remove('saved');
      if (!busy) fields.saveButton.textContent = 'Guardar cambios';
    }, 1200);
  } catch (error) {
    showNotice(error.message || 'No se pudo guardar la configuracion', true);
    HomeyRef.alert(error.message || 'No se pudo guardar la configuracion');
  } finally {
    setBusy(false);
    if (!fields.saveButton.classList.contains('saved')) {
      fields.saveButton.textContent = 'Guardar cambios';
    }
  }
}

async function setRainDelay(hours) {
  if (isDirty()) {
    const message = 'Guarda los cambios pendientes antes de aplicar Rain Delay';
    showNotice(message, true);
    HomeyRef.alert(message);
    return;
  }

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
  if (isDirty()) {
    const message = 'Guarda los cambios pendientes antes de cancelar Rain Delay';
    showNotice(message, true);
    HomeyRef.alert(message);
    return;
  }

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

async function refreshDiagnostics() {
  fields.refreshDiagnostics.disabled = true;
  try {
    const [diagnostics, engineStatus] = await Promise.all([
      callApi('GET', '/diagnostics/status'),
      callApi('GET', '/engine/status'),
    ]);
    renderDiagnostics(diagnostics);
    renderRecovery(engineStatus);
  } catch (error) {
    showNotice(error.message || 'No se pudo cargar el diagnostico', true);
  } finally {
    fields.refreshDiagnostics.disabled = false;
  }
}

async function resumePending() {
  setBusy(true);
  showNotice('');
  try {
    await callApi('POST', '/engine/resume-pending');
    showNotice('Sectores pendientes reanudados');
    await load();
  } catch (error) {
    showNotice(error.message || 'No se pudo reanudar el programa', true);
    HomeyRef.alert(error.message || 'No se pudo reanudar el programa');
  } finally {
    setBusy(false);
  }
}

async function cancelPending() {
  setBusy(true);
  showNotice('');
  try {
    await callApi('POST', '/engine/cancel-pending');
    showNotice('Programa pendiente cancelado');
    await load();
  } catch (error) {
    showNotice(error.message || 'No se pudo cancelar el programa pendiente', true);
    HomeyRef.alert(error.message || 'No se pudo cancelar el programa pendiente');
  } finally {
    setBusy(false);
  }
}

window.onHomeyReady = async Homey => {
  HomeyRef = Homey;

  fields.saveButton.addEventListener('click', save);
  fields.refreshDiagnostics.addEventListener('click', refreshDiagnostics);
  fields.clearRainDelay.addEventListener('click', clearRainDelay);
  fields.resumePendingButton.addEventListener('click', resumePending);
  fields.cancelPendingButton.addEventListener('click', cancelPending);
  fields.tabButtons.forEach(button => {
    button.addEventListener('click', () => setActiveTab(button.dataset.tabTarget));
  });
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
