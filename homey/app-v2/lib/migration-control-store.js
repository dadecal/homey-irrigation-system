'use strict';

const { MODE, SERVICE, SETTING } = require('./constants');

function createDefaultMigrationControl() {
  return {
    version: 1,
    services: {
      [SERVICE.SCHEDULER]: MODE.SHADOW,
      [SERVICE.HEALTH]: MODE.SHADOW,
      [SERVICE.STATUS_SYNC]: MODE.SHADOW,
      [SERVICE.HISTORY]: MODE.SHADOW,
      [SERVICE.RECOVERY]: MODE.SHADOW,
      [SERVICE.ENGINE]: MODE.SHADOW,
    },
    activeCompatSupported: {
      [SERVICE.SCHEDULER]: true,
      [SERVICE.HEALTH]: true,
      [SERVICE.STATUS_SYNC]: true,
      [SERVICE.HISTORY]: true,
      [SERVICE.RECOVERY]: true,
      [SERVICE.ENGINE]: true,
    },
    updatedTs: 0,
  };
}

function normalizeControl(input) {
  const defaults = createDefaultMigrationControl();
  const stored = input && typeof input === 'object' ? input : {};
  const services = stored.services && typeof stored.services === 'object'
    ? stored.services
    : {};
  const activeCompatSupported = stored.activeCompatSupported && typeof stored.activeCompatSupported === 'object'
    ? stored.activeCompatSupported
    : {};

  return {
    ...defaults,
    ...stored,
    services: {
      ...defaults.services,
      ...Object.fromEntries(Object.entries(services)
        .filter(([service, value]) => {
          if (value === MODE.SHADOW) return true;
          return [
            SERVICE.SCHEDULER,
            SERVICE.HEALTH,
            SERVICE.STATUS_SYNC,
            SERVICE.HISTORY,
            SERVICE.RECOVERY,
            SERVICE.ENGINE,
          ].includes(service)
            && value === MODE.ACTIVE_COMPAT;
        })),
    },
    activeCompatSupported: {
      ...defaults.activeCompatSupported,
      ...Object.fromEntries(Object.entries(activeCompatSupported)
        .filter(([service, value]) => Object.values(SERVICE).includes(service) && typeof value === 'boolean')),
      [SERVICE.ENGINE]: true,
    },
  };
}

class MigrationControlStore {
  constructor(homey) {
    this.settings = homey.settings;
  }

  async getControl() {
    const stored = this.settings.get(SETTING.migrationControl);
    return normalizeControl(stored);
  }

  async setServiceMode(service, mode, options = {}) {
    if (!Object.values(SERVICE).includes(service)) {
      const error = new Error(`Servicio de migracion no soportado: ${service}`);
      error.statusCode = 400;
      throw error;
    }

    if (![MODE.SHADOW, MODE.ACTIVE_COMPAT].includes(mode)) {
      const error = new Error(`Modo de migracion no soportado: ${mode}`);
      error.statusCode = 400;
      throw error;
    }

    if (mode === MODE.ACTIVE_COMPAT && ![
      SERVICE.SCHEDULER,
      SERVICE.HEALTH,
      SERVICE.STATUS_SYNC,
      SERVICE.HISTORY,
      SERVICE.RECOVERY,
      SERVICE.ENGINE,
    ].includes(service)) {
      const error = new Error(`ACTIVE_COMPAT solo esta implementado para ${SERVICE.SCHEDULER}, ${SERVICE.HEALTH}, ${SERVICE.STATUS_SYNC}, ${SERVICE.HISTORY} y ${SERVICE.RECOVERY}`);
      error.statusCode = 400;
      throw error;
    }

    if (service === SERVICE.ENGINE
      && mode === MODE.ACTIVE_COMPAT
      && options.engineActivationPrecheck?.allowed !== true) {
      const blockers = options.engineActivationPrecheck?.blockers || [];
      const details = blockers.map(blocker => blocker.code).join(', ');
      const error = new Error(`ACTIVE_COMPAT para engine requiere precheck limpio${details ? `: ${details}` : ''}`);
      error.statusCode = 400;
      error.blockers = blockers;
      throw error;
    }

    if (mode === MODE.ACTIVE_COMPAT && options.acknowledgeDuplicateWriteRisk !== true) {
      const error = new Error('Activar ACTIVE_COMPAT requiere acknowledgeDuplicateWriteRisk=true');
      error.statusCode = 400;
      throw error;
    }

    const current = await this.getControl();
    const next = normalizeControl({
      ...current,
      services: {
        ...current.services,
        [service]: mode,
      },
      activeCompatSupported: {
        ...current.activeCompatSupported,
        [SERVICE.ENGINE]: true,
      },
      updatedTs: Date.now(),
    });

    this.settings.set(SETTING.migrationControl, next);
    return next;
  }
}

module.exports = {
  MigrationControlStore,
  createDefaultMigrationControl,
};
