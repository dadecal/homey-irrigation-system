'use strict';

const { MODE, SERVICE } = require('./constants');
const { readEngineSnapshot } = require('./engine-state-source');

const RAW_DEVICE_ID = '1120df26-8201-49de-b262-8fb98289d811';
const CHECK_INTERVAL_MS = 60 * 1000;

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

function shouldNotifyHealth(health) {
  return (health.notificationChanged ?? health.changed)
    && ['ERROR', 'OFFLINE'].includes(health.status);
}

function isNoisyEspHomeWarning({ level, component, message }) {
  if (level !== 'WARNING') return false;

  const normalizedComponent = normalize(component);
  const normalizedMessage = normalize(message);
  const noisyComponent = [
    'api',
    'web_server',
    'httpd',
  ].some(term => normalizedComponent.includes(term));

  if (!noisyComponent) return false;

  return [
    'reading failed',
    'connection_closed',
    'unsupported content type',
    'application/json',
  ].some(term => normalizedMessage.includes(term));
}

function issueCodes(issues) {
  return (Array.isArray(issues) ? issues : []).map(item => item.code).sort();
}

function actionableIssueCodes(issues) {
  return (Array.isArray(issues) ? issues : [])
    .filter(item => ['ERROR', 'OFFLINE'].includes(item.severity))
    .map(item => item.code)
    .sort();
}

function notificationSignatureOf(health) {
  return JSON.stringify({
    status: ['ERROR', 'OFFLINE'].includes(health.status) ? health.status : 'OK',
    issues: actionableIssueCodes(health.issues),
  });
}

function sameIssueCodes(left, right) {
  const a = issueCodes(left);
  const b = issueCodes(right);
  return a.length === b.length && a.every((code, index) => code === b[index]);
}

function signatureOf(health) {
  return JSON.stringify({
    status: health.status,
    issues: (Array.isArray(health.issues) ? health.issues : []).map(item => [item.code, item.severity]),
    lastEspSequence: Number(health.telemetry?.lastEspSequence || 0),
  });
}

class HealthService {
  constructor({
    homey,
    apiClient,
    appStateStore = null,
    controlStore = null,
    healthTransitionTrigger = null,
    now = () => Date.now(),
    logger = null,
  }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.appStateStore = appStateStore;
    this.controlStore = controlStore;
    this.healthTransitionTrigger = healthTransitionTrigger;
    this.now = now;
    this.logger = logger || homey.app;
    this.timer = null;
    this.checking = false;
    this.lastHealth = null;
    this.lastError = null;
  }

  start() {
    if (this.timer) {
      return;
    }

    this.timer = this.homey.setInterval(() => {
      this.check().catch(error => {
        this.lastError = {
          ts: this.now(),
          message: error.message,
        };
        this.logger.error('Health check failed', error);
      });
    }, CHECK_INTERVAL_MS);
  }

  stop() {
    if (!this.timer) {
      return;
    }

    this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  async getApi() {
    return this.apiClient.getApi();
  }

  async getRawDevice() {
    return this.getDevice(RAW_DEVICE_ID);
  }

  async getDevice(id) {
    const api = await this.getApi();

    if (api.devices?.getDevice) {
      return api.devices.getDevice({ id });
    }

    const devices = await api.devices.getDevices();
    return devices[id] || null;
  }

  async getMode() {
    if (!this.controlStore) {
      return MODE.SHADOW;
    }

    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.HEALTH] || MODE.SHADOW;
  }

  async status() {
    const mode = await this.getMode();
    return {
      mode,
      shadow: mode === MODE.SHADOW,
      writesOperationalVariables: false,
      writesInternalState: mode === MODE.ACTIVE_COMPAT,
      updatesDevices: false,
      checkIntervalMs: CHECK_INTERVAL_MS,
      timerActive: Boolean(this.timer),
      lastHealth: this.lastHealth,
      lastError: this.lastError,
    };
  }

  async check() {
    if (this.checking) {
      return { skipped: true, reason: 'ALREADY_RUNNING' };
    }

    this.checking = true;

    try {
      const health = await this.buildHealth();
      const applied = health.mode === MODE.ACTIVE_COMPAT
        ? await this.applyHealth(health)
        : {
            state: [],
            devices: [],
            events: [],
            changed: health.changed,
          };
      health.applied = applied;
      this.lastHealth = health;
      this.lastError = null;
      this.logger.log(`Health ${health.mode} check: ${health.summary}`);
      return health;
    } catch (error) {
      this.lastError = {
        ts: this.now(),
        message: error.message,
      };
      throw error;
    } finally {
      this.checking = false;
    }
  }

  async buildHealth() {
    const now = this.now();
    const mode = await this.getMode();
    const appState = this.appStateStore ? await this.appStateStore.getState() : null;
    const previousHealth = appState?.health || {};
    const previousIssues = Array.isArray(previousHealth.issues) ? previousHealth.issues : [];
    const previousByCode = Object.fromEntries(previousIssues.map(item => [item.code, item]));
    const issues = [];

    const engine = await readEngineSnapshot({
      appStateStore: this.appStateStore,
    });
    const engineState = engine.state;
    const activeSector = engine.activeSector;
    const stopReason = engine.stopReason;
    const engineEndTs = engine.endTs;
    const lastTickTs = engine.lastTickTs;

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
        'Motor RUNNING sin mantenimiento periódico; revisar relés',
        previousByCode, now,
      ));
    }

    let raw = null;
    try {
      raw = await this.getRawDevice();
    } catch (error) {
      this.logger.log(`RAW unavailable: ${error.message}`);
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

    let sequence = Number(previousHealth.telemetry?.lastEspSequence || 0);
    let uptime = null;
    let lastEvent = previousHealth.lastEvent || null;

    if (!available) {
      issues.push(issue(
        'ESP_OFFLINE', 'OFFLINE', 'ESP32',
        'Controlador ESP32 desconectado',
        previousByCode, now,
      ));
    } else {
      const sequenceEntry = findOne(entries, 'esp', 'secuencia', 'error');
      const levelEntry = findOne(entries, 'esp', 'nivel', 'error');
      const componentEntry = findOne(entries, 'esp', 'componente', 'error');
      const messageEntry = findOne(entries, 'esp', 'ultimo', 'error');

      if (!sequenceEntry || !levelEntry || !componentEntry || !messageEntry) {
        issues.push(issue(
          'HEALTH_TELEMETRY_MISSING', 'WARNING', 'ESPHome',
          'Telemetría genérica de errores no disponible',
          previousByCode, now,
        ));
      } else {
        const currentSequence = finiteNumber(sequenceEntry) ?? 0;
        const previousSequence = Number(previousHealth.telemetry?.lastEspSequence || 0);

        if (currentSequence > previousSequence) {
          const level = normalize(levelEntry.value) === 'error' ? 'ERROR' : 'WARNING';
          const ttl = level === 'ERROR' ? GENERIC_ERROR_TTL_MS : GENERIC_WARN_TTL_MS;
          const component = String(componentEntry.value || 'ESPHome');
          const message = stripAnsi(messageEntry.value || 'Error ESPHome no categorizado');
          if (!isNoisyEspHomeWarning({ level, component, message })) {
            lastEvent = {
              sequence: currentSequence,
              level,
              component,
              message,
              detectedTs: now,
              expiresTs: now + ttl,
            };
          }
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
        issues.push(issue(
          `LEAK_${sector || entry.id}`,
          'ERROR',
          sector ? `Línea ${sector}` : 'Riego',
          sector ? `Caudal detectado con la línea ${sector} cerrada` : 'Caudal detectado con relés cerrados',
          previousByCode,
          now,
        ));
      }

      for (const entry of findAll(entries, 'fallo', 'actuacion').filter(item => isActive(item.value))) {
        const sector = sectorFrom(entry);
        issues.push(issue(
          `ACTUATION_FAILURE_${sector || entry.id}`,
          'ERROR',
          sector ? `Línea ${sector}` : 'Riego',
          sector ? `Línea ${sector} activa sin caudal` : 'Riego activo sin caudal',
          previousByCode,
          now,
        ));
      }

      const relayConflict = findOne(entries, 'conflicto', 'rele');
      if (relayConflict && isActive(relayConflict.value)) {
        issues.push(issue(
          'RELAY_CONFLICT', 'ERROR', 'Relés',
          'Hay varios relés de riego activos simultáneamente',
          previousByCode, now,
        ));
      }

      const overheat = findOne(entries, 'sobrecalentamiento');
      if (overheat && isActive(overheat.value)) {
        issues.push(issue(
          'ESP_OVERHEAT', 'ERROR', 'ESP32',
          'Protección térmica activada',
          previousByCode, now,
        ));
      }

      const loopMs = finiteNumber(findOne(entries, 'tiempo', 'loop'));
      if (loopMs !== null && loopMs > LOOP_WARNING_MS) {
        issues.push(issue(
          'ESP_LOOP_SLOW', 'WARNING', 'ESP32',
          `Tiempo de loop elevado: ${Math.round(loopMs)} ms`,
          previousByCode, now,
        ));
      }

      const heap = finiteNumber(findOne(entries, 'heap', 'libre'));
      if (heap !== null && heap < HEAP_WARNING_BYTES) {
        issues.push(issue(
          'ESP_HEAP_LOW', 'WARNING', 'ESP32',
          `Memoria libre baja: ${Math.round(heap)} bytes`,
          previousByCode, now,
        ));
      }

      uptime = finiteNumber(findOne(entries, 'uptime'));
      const previousUptime = Number(previousHealth.telemetry?.uptimeSeconds);
      if (uptime !== null && Number.isFinite(previousUptime) && uptime + 60 < previousUptime) {
        issues.push(issue(
          'ESP_RESTARTED', 'WARNING', 'ESP32',
          'El controlador ESP32 se ha reiniciado',
          previousByCode, now,
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

    const status = statusFromIssues(issues);
    const summary = summarize(status, issues);
    const previousSignature = signatureOf({
      status: previousHealth.status || 'OK',
      issues: Array.isArray(previousHealth.issues) ? previousHealth.issues : [],
      telemetry: {
        lastEspSequence: Number(previousHealth.telemetry?.lastEspSequence || 0),
      },
    });

    const currentSignature = signatureOf({
      status,
      issues,
      telemetry: {
        lastEspSequence: sequence,
      },
    });
    const changed = currentSignature !== previousSignature;
    const notificationChanged = notificationSignatureOf({
      status,
      issues,
    }) !== notificationSignatureOf({
      status: previousHealth.status || 'OK',
      issues: Array.isArray(previousHealth.issues) ? previousHealth.issues : [],
    });

    return {
      version: 1,
      mode,
      shadow: mode === MODE.SHADOW,
      writesOperationalVariables: false,
      writesInternalState: mode === MODE.ACTIVE_COMPAT,
      updatesDevices: false,
      status,
      summary,
      updatedTs: now,
      changed,
      notificationChanged,
      issues,
      lastEvent,
      telemetry: {
        rawAvailable: available,
        lastEspSequence: sequence,
        uptimeSeconds: uptime,
        lastTickTs,
        engineState,
        activeSector,
        stopReason,
        engineStateSource: engine.sourceStore,
      },
      comparison: {
        previousStatus: previousHealth.status || null,
        previousIssueCodes: issueCodes(previousHealth.issues),
        currentIssueCodes: issueCodes(issues),
        matchesPreviousHealth: (previousHealth.status || 'OK') === status
          && sameIssueCodes(previousHealth.issues, issues),
      },
    };
  }

  async applyHealth(health) {
    const persistedHealth = {
      version: health.version,
      status: health.status,
      updatedTs: health.updatedTs,
      issues: health.issues,
      lastEvent: health.lastEvent,
      telemetry: health.telemetry,
    };

    const state = [];
    const events = [];
    const triggers = [];
    const notifications = [];

    if (this.appStateStore) {
      await this.appStateStore.setHealth(persistedHealth);
      state.push({ key: 'health', skipped: false });

      if (health.changed) {
        const event = {
          type: 'health.transition',
          ts: health.updatedTs,
          status: health.status,
          message: health.summary,
          issueCodes: issueCodes(health.issues),
        };
        await this.appStateStore.appendEvent(event);
        events.push(event);
      }
    } else {
      state.push({ key: 'health', skipped: true, reason: 'APP_STATE_STORE_NOT_AVAILABLE' });
    }

    const notifyHealth = shouldNotifyHealth(health);

    if (notifyHealth && this.healthTransitionTrigger) {
      try {
        await this.healthTransitionTrigger.trigger({
          status: health.status,
          message: health.summary,
          issueCodes: issueCodes(health.issues).join(','),
        });
        triggers.push({ id: 'health_transition', skipped: false });
      } catch (error) {
        triggers.push({
          id: 'health_transition',
          skipped: true,
          reason: 'TRIGGER_FAILED',
          message: error.message,
        });
        this.logger.log(`Health transition trigger skipped: ${error.message}`);
      }
    } else if (health.changed && !notifyHealth) {
      triggers.push({ id: 'health_transition', skipped: true, reason: 'NOT_ACTIONABLE' });
    } else if (!health.changed) {
      triggers.push({ id: 'health_transition', skipped: true, reason: 'UNCHANGED' });
    } else {
      triggers.push({ id: 'health_transition', skipped: true, reason: 'TRIGGER_NOT_AVAILABLE' });
    }

    if (notifyHealth) {
      notifications.push({
        id: 'homey_notification',
        skipped: true,
        reason: 'FLOW_OWNS_NOTIFICATION',
      });
    } else if (health.changed) {
      notifications.push({ id: 'homey_notification', skipped: true, reason: 'NOT_ACTIONABLE' });
    } else {
      notifications.push({ id: 'homey_notification', skipped: true, reason: 'UNCHANGED' });
    }

    return {
      changed: health.changed,
      state,
      devices: [],
      events,
      triggers,
      notifications,
    };
  }
}

module.exports = HealthService;
module.exports.shouldNotifyHealth = shouldNotifyHealth;
module.exports.isNoisyEspHomeWarning = isNoisyEspHomeWarning;
