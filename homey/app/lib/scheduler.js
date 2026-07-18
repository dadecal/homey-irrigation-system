'use strict';

const { STATUS } = require('./constants');
const { calculateNextRun } = require('./next-run-calculator');

const TICK_INTERVAL_MS = 30000;
const PENDING_REQUEST_TTL_MS = 10 * 60 * 1000;

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
  constructor({ homey, configStore, programRequestTrigger, motorConfirmationStore, timeZone }) {
    this.homey = homey;
    this.configStore = configStore;
    this.programRequestTrigger = programRequestTrigger;
    this.motorConfirmationStore = motorConfirmationStore;
    this.timeZone = timeZone;
    this.timer = null;
    this.evaluating = false;
    this.lastError = null;
  }

  start() {
    if (this.timer) return;

    this.timer = this.homey.setInterval(() => {
      this.evaluate().catch(error => this.homey.app.error('Scheduler tick failed', error));
    }, TICK_INTERVAL_MS);

    this.evaluate().catch(error => this.homey.app.error('Scheduler startup failed', error));
  }

  stop() {
    if (!this.timer) return;
    this.homey.clearInterval(this.timer);
    this.timer = null;
  }

  async evaluate(nowTs = Date.now()) {
    if (this.evaluating) return null;
    this.evaluating = true;

    try {
      const config = await this.configStore.getConfig();
      const decision = calculateNextRun(config, nowTs, this.timeZone);

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
            `Scheduler request confirmed requestId=${pendingRequest.requestId} runDate=${pendingRequest.runDate} reason=${confirmation.reason}`,
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
          `Scheduler request not confirmed requestId=${pendingRequest.requestId} runDate=${pendingRequest.runDate}`,
        );
      }

      if (!decision.due) {
        return decision;
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
        `Scheduler request emitted requestId=${request.requestId} runDate=${decision.runDate}; awaiting engine confirmation`,
      );

      return { ...decision, request, pendingRequest };
    } finally {
      this.evaluating = false;
    }
  }

  getDiagnostic() {
    return {
      lastError: this.lastError,
    };
  }
}

module.exports = {
  buildQueue,
  Scheduler,
  TICK_INTERVAL_MS,
};
