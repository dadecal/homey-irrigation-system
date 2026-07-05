'use strict';

const { calculateNextRun } = require('./next-run-calculator');

const TICK_INTERVAL_MS = 30000;

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
  constructor({ homey, configStore, programRequestTrigger, timeZone }) {
    this.homey = homey;
    this.configStore = configStore;
    this.programRequestTrigger = programRequestTrigger;
    this.timeZone = timeZone;
    this.timer = null;
    this.evaluating = false;
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

      if (!decision.due) {
        return decision;
      }

      const queue = buildQueue(config);
      await this.configStore.markRunDate(decision.runDate);
      const request = await this.programRequestTrigger.trigger(queue);
      this.homey.app.log(
        `Scheduler request emitted requestId=${request.requestId} runDate=${decision.runDate}`,
      );

      return { ...decision, request };
    } finally {
      this.evaluating = false;
    }
  }
}

module.exports = {
  buildQueue,
  Scheduler,
  TICK_INTERVAL_MS,
};
