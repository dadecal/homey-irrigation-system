'use strict';

const { MODE, SERVICE, STATUS } = require('./constants');
const { calculateNextRun } = require('./next-run-calculator');

const TICK_INTERVAL_MS = 30000;
const PENDING_REQUEST_TTL_MS = 10 * 60 * 1000;
const PREFLIGHT_RETRY_WINDOW_MS = 15 * 60 * 1000;

function buildQueue(config) {
  return Object.entries(config.sectorDurations)
    .map(([sector, duration]) => ({
      sector: Number(sector),
      duration: Number(duration),
    }))
    .filter(item => item.duration > 0)
    .sort((left, right) => left.sector - right.sector);
}

class Scheduler {
  constructor({
    homey,
    configStore,
    programRequestTrigger,
    motorConfirmationStore,
    controlStore = null,
    irrigationEngineService = null,
    preflightService = null,
    appStateStore = null,
    timeZone,
  }) {
    this.homey = homey;
    this.configStore = configStore;
    this.programRequestTrigger = programRequestTrigger;
    this.motorConfirmationStore = motorConfirmationStore;
    this.controlStore = controlStore;
    this.irrigationEngineService = irrigationEngineService;
    this.preflightService = preflightService;
    this.appStateStore = appStateStore;
    this.timeZone = timeZone;
    this.timer = null;
    this.evaluating = false;
    this.lastDecision = null;
    this.lastError = null;
    this.lastPreflight = null;
  }

  start() {
    if (this.timer) return;

    this.timer = this.homey.setInterval(() => {
      this.evaluate().catch(error => this.homey.app.error('Scheduler v2 tick failed', error));
    }, TICK_INTERVAL_MS);

    this.evaluate().catch(error => this.homey.app.error('Scheduler v2 startup failed', error));
  }

  stop() {
    if (!this.timer) return;
    this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  async getMode() {
    if (!this.controlStore) {
      return MODE.SHADOW;
    }

    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.SCHEDULER] || MODE.SHADOW;
  }

  async getEngineMode() {
    if (!this.controlStore) return MODE.SHADOW;
    const control = await this.controlStore.getControl();
    return control.services?.[SERVICE.ENGINE] || MODE.SHADOW;
  }

  async status() {
    const mode = await this.getMode();
    const status = await this.configStore.getStatus();
    return {
      ...status,
      mode,
      shadow: mode === MODE.SHADOW,
      canEmitProgramRequests: mode === MODE.ACTIVE_COMPAT,
      timerActive: Boolean(this.timer),
      lastDecision: this.lastDecision,
      lastError: this.lastError,
      preflight: this.preflightService?.status?.() || null,
    };
  }

  async evaluate(nowTs = Date.now()) {
    if (this.evaluating) return null;
    this.evaluating = true;

    try {
      const mode = await this.getMode();
      const config = await this.configStore.getConfig();
      const decision = calculateNextRun(config, nowTs, this.timeZone);
      const baseDecision = {
        ...decision,
        mode,
        shadow: mode === MODE.SHADOW,
        canEmitProgramRequests: mode === MODE.ACTIVE_COMPAT,
      };

      if (mode !== MODE.ACTIVE_COMPAT) {
        this.lastDecision = baseDecision;
        this.lastError = null;
        return baseDecision;
      }

      const activeDecision = await this.evaluateActive(config, baseDecision, nowTs);
      this.lastDecision = activeDecision;
      return activeDecision;
    } catch (error) {
      this.lastError = {
        ts: Date.now(),
        message: error.message,
      };
      throw error;
    } finally {
      this.evaluating = false;
    }
  }

  async evaluateActive(config, decision, nowTs) {
    if (config.pendingRequest) {
      const pendingRequest = config.pendingRequest;
      let confirmation;

      try {
        confirmation = await this.motorConfirmationStore.getConfirmation(pendingRequest);
      } catch (error) {
        this.lastError = {
          ts: Date.now(),
          message: `No se pudo confirmar la solicitud pendiente: ${error.message}`,
          pendingRequest,
        };
        this.homey.app.error(this.lastError.message, error);
        return {
          ...decision,
          status: STATUS.ERROR,
          pendingRequest,
          error: this.lastError,
          message: this.lastError.message,
        };
      }

      if (confirmation.confirmed) {
        await this.configStore.markRunDate(pendingRequest.runDate);
        this.lastError = null;
        this.homey.app.log(
          `Scheduler v2 request confirmed requestId=${pendingRequest.requestId} runDate=${pendingRequest.runDate} reason=${confirmation.reason}`,
        );
        return { ...decision, confirmation };
      }

      if (nowTs - pendingRequest.createdTs < PENDING_REQUEST_TTL_MS) {
        return {
          ...decision,
          pendingRequest,
          message: 'Solicitud pendiente de confirmacion del motor',
        };
      }

      await this.configStore.clearPendingRequest();
      this.lastError = {
        ts: Date.now(),
        message: `La solicitud ${pendingRequest.requestId} no fue confirmada por el motor`,
        pendingRequest,
      };
      this.homey.app.error(
        `Scheduler v2 request not confirmed requestId=${pendingRequest.requestId} runDate=${pendingRequest.runDate}`,
      );
    }

    if (!decision.due) {
      return decision;
    }

    if (this.preflightService) {
      const preflight = await this.preflightService.check({
        runDate: decision.runDate,
        nowTs,
      });
      this.lastPreflight = preflight;

      if (!preflight.allowed) {
        return this.handlePreflightBlock(config, decision, preflight, nowTs);
      }

      if (config.preflightBlock && this.configStore.clearPreflightBlock) {
        await this.configStore.clearPreflightBlock();
        await this.appendSchedulerEvent({
          ts: nowTs,
          status: 'PREFLIGHT_RECOVERED',
          message: `Preflight recuperado para ${decision.runDate}: ${preflight.message}`,
          runDate: decision.runDate,
          code: preflight.code,
        });
      }
    }

    const queue = buildQueue(config);
    const request = this.programRequestTrigger.createRequest(queue, { runDate: decision.runDate });
    const pendingRequest = {
      requestId: request.requestId,
      runDate: decision.runDate,
      requestedAt: request.requestedAt,
      createdTs: nowTs,
    };

    await this.configStore.markPendingRequest(pendingRequest);

    try {
      const engineMode = await this.getEngineMode();
      if (engineMode === MODE.ACTIVE_COMPAT && this.irrigationEngineService) {
        const engineResult = await this.irrigationEngineService.startProgram(request);
        if (engineResult.transaction?.accepted === false || engineResult.execution?.failed) {
          await this.configStore.clearPendingRequest();
          this.lastError = {
            ts: Date.now(),
            message: `El motor nativo rechazo la solicitud ${request.requestId}`,
            pendingRequest,
            engineResult,
          };
          return {
            ...decision,
            status: STATUS.ERROR,
            request,
            pendingRequest,
            engineResult,
            message: this.lastError.message,
          };
        }

        this.lastError = null;
        this.homey.app.log(
          `Scheduler v2 request delivered to native engine requestId=${request.requestId} runDate=${decision.runDate}; awaiting engine confirmation`,
        );

        return { ...decision, request, pendingRequest, engineResult };
      }

      await this.programRequestTrigger.triggerRequest(request);
    } catch (error) {
      await this.configStore.clearPendingRequest();
      this.lastError = {
        ts: Date.now(),
        message: `No se pudo emitir la solicitud del programador: ${error.message}`,
        pendingRequest,
      };
      throw error;
    }

    this.lastError = null;
    this.homey.app.log(
      `Scheduler v2 request emitted requestId=${request.requestId} runDate=${decision.runDate}; awaiting engine confirmation`,
    );

    return { ...decision, request, pendingRequest };
  }

  getDiagnostic() {
    return {
      lastDecision: this.lastDecision,
      lastError: this.lastError,
      lastPreflight: this.lastPreflight,
    };
  }

  async handlePreflightBlock(config, decision, preflight, nowTs) {
    const previous = config.preflightBlock?.runDate === decision.runDate
      ? config.preflightBlock
      : null;
    const firstBlockedTs = previous?.firstBlockedTs || nowTs;
    const attempts = Number(previous?.attempts || 0) + 1;
    const block = {
      runDate: decision.runDate,
      firstBlockedTs,
      lastBlockedTs: nowTs,
      attempts,
      code: preflight.code,
      message: preflight.message,
    };
    const firstOrChanged = !previous
      || previous.code !== block.code
      || previous.message !== block.message;

    if (nowTs - firstBlockedTs > PREFLIGHT_RETRY_WINDOW_MS) {
      if (this.configStore.markRunDate) {
        await this.configStore.markRunDate(decision.runDate);
      }

      const message = `Riego programado cancelado por preflight: ${preflight.message}`;
      this.lastError = {
        ts: nowTs,
        message,
        preflight,
      };
      await this.appendSchedulerEvent({
        ts: nowTs,
        status: 'PREFLIGHT_CANCELLED',
        message,
        runDate: decision.runDate,
        code: preflight.code,
      });
      this.homey.app.error(`Scheduler v2 preflight cancelled runDate=${decision.runDate} code=${preflight.code}`);
      return {
        ...decision,
        status: STATUS.ERROR,
        preflight,
        preflightBlock: block,
        message,
      };
    }

    if (this.configStore.markPreflightBlock) {
      await this.configStore.markPreflightBlock(block);
    }

    if (firstOrChanged) {
      await this.appendSchedulerEvent({
        ts: nowTs,
        status: 'PREFLIGHT_BLOCKED',
        message: `Riego programado aplazado por preflight: ${preflight.message}`,
        runDate: decision.runDate,
        code: preflight.code,
      });
      this.homey.app.log(`Scheduler v2 preflight blocked runDate=${decision.runDate} code=${preflight.code}`);
    }

    return {
      ...decision,
      preflight,
      preflightBlock: block,
      message: `Riego programado aplazado por preflight: ${preflight.message}`,
    };
  }

  async appendSchedulerEvent(event) {
    if (!this.appStateStore?.appendEvent) {
      return null;
    }

    return this.appStateStore.appendEvent({
      type: 'scheduler.event',
      ...event,
    });
  }
}

module.exports = {
  buildQueue,
  Scheduler,
  TICK_INTERVAL_MS,
  PREFLIGHT_RETRY_WINDOW_MS,
};
