'use strict';

const PREFLIGHT_STABILITY_WINDOW_MS = 10 * 60 * 1000;
const PREFLIGHT_RECENT_TICK_MAX_AGE_MS = 2 * 60 * 1000;

function latest(items) {
  return Array.isArray(items) && items.length > 0 ? items[0] : null;
}

function blocked(code, message, details = {}) {
  return {
    allowed: false,
    code,
    message,
    details,
  };
}

function allowed(details = {}) {
  return {
    allowed: true,
    code: 'OK',
    message: 'Preflight correcto',
    details,
  };
}

function recent(nowTs, ts, maxAgeMs) {
  return Number(ts || 0) > 0 && nowTs - Number(ts) <= maxAgeMs;
}

class SchedulerPreflightService {
  constructor({
    appStateStore,
    now = () => Date.now(),
    stabilityWindowMs = PREFLIGHT_STABILITY_WINDOW_MS,
    recentTickMaxAgeMs = PREFLIGHT_RECENT_TICK_MAX_AGE_MS,
  }) {
    this.appStateStore = appStateStore;
    this.now = now;
    this.stabilityWindowMs = stabilityWindowMs;
    this.recentTickMaxAgeMs = recentTickMaxAgeMs;
    this.lastResult = null;
  }

  async check({ runDate = null, nowTs = this.now() } = {}) {
    if (!this.appStateStore) {
      this.lastResult = allowed({ runDate, reason: 'APP_STATE_STORE_NOT_AVAILABLE' });
      return this.lastResult;
    }

    const state = await this.appStateStore.getState();
    const health = state.health || null;
    const recovery = state.recovery || null;
    const engine = state.engine || {};
    const lastTick = latest(engine.tickDiagnostics);
    const activeRelays = Array.isArray(lastTick?.activeRelays) ? lastTick.activeRelays : [];

    let result = null;
    if (['ERROR', 'OFFLINE'].includes(String(health?.status || 'OK'))) {
      result = blocked(
        'HEALTH_NOT_OK',
        health?.summary || `Salud del sistema en ${health.status}`,
        { health },
      );
    } else if (health?.telemetry?.rawAvailable === false) {
      result = blocked(
        'RAW_UNAVAILABLE',
        'ESPHome no esta disponible para iniciar el riego',
        { health },
      );
    } else if (recovery?.awaitingRecovery) {
      result = blocked(
        'RECOVERY_AWAITING',
        recovery.lastMessage || 'Recovery esta esperando recuperar ESPHome Controller',
        { recovery },
      );
    } else if (Number(recovery?.consecutiveFailures || 0) > 0) {
      result = blocked(
        'RECOVERY_FAILURES',
        recovery.lastMessage || 'Recovery ha detectado fallos recientes de ESPHome Controller',
        { recovery },
      );
    } else if (recent(nowTs, recovery?.lastRestartTs, this.stabilityWindowMs)) {
      result = blocked(
        'RECOVERY_RECENT_RESTART',
        'ESPHome Controller se ha reiniciado recientemente',
        { recovery },
      );
    } else if (recent(nowTs, recovery?.lastRecoveryTs, this.stabilityWindowMs)) {
      result = blocked(
        'RECOVERY_RECENT_RECOVERY',
        'ESPHome Controller se ha recuperado recientemente',
        { recovery },
      );
    } else if (String(engine.state || 'IDLE') !== 'IDLE' || Number(engine.activeSector || 0) !== 0) {
      result = blocked(
        'ENGINE_NOT_IDLE',
        `Motor no disponible: ${engine.state || 'UNKNOWN'} sector ${Number(engine.activeSector || 0)}`,
        { engine },
      );
    } else if (
      recent(nowTs, lastTick?.ts, this.recentTickMaxAgeMs)
      && lastTick?.rawAvailable === false
    ) {
      result = blocked(
        'RAW_UNAVAILABLE',
        'ESPHome no esta disponible segun el ultimo tick del motor',
        { lastTick },
      );
    } else if (
      recent(nowTs, lastTick?.ts, this.recentTickMaxAgeMs)
      && activeRelays.length > 0
    ) {
      result = blocked(
        'RELAYS_ACTIVE',
        `Hay reles activos antes de iniciar: ${activeRelays.join(',')}`,
        { lastTick },
      );
    } else {
      result = allowed({
        runDate,
        healthStatus: health?.status || 'OK',
        engineState: engine.state || 'IDLE',
        lastTickTs: lastTick?.ts || 0,
      });
    }

    this.lastResult = {
      ...result,
      runDate,
      checkedTs: nowTs,
    };
    return this.lastResult;
  }

  status() {
    return {
      stabilityWindowMs: this.stabilityWindowMs,
      recentTickMaxAgeMs: this.recentTickMaxAgeMs,
      lastResult: this.lastResult,
    };
  }
}

module.exports = {
  SchedulerPreflightService,
  PREFLIGHT_STABILITY_WINDOW_MS,
  PREFLIGHT_RECENT_TICK_MAX_AGE_MS,
};
