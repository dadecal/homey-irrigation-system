'use strict';

const { normalizeEngine } = require('./engine-state-source');

const CONFIRMATION_GRACE_MS = 60 * 1000;

class MotorConfirmationStore {
  constructor(homeyOrOptions) {
    const options = homeyOrOptions?.homey ? homeyOrOptions : { homey: homeyOrOptions };
    this.homey = options.homey;
    this.appStateStore = options.appStateStore || null;
  }

  async getConfirmation(pendingRequest) {
    if (!pendingRequest) {
      return { confirmed: false, reason: 'NO_PENDING_REQUEST' };
    }

    const minStartTs = pendingRequest.requestedAt - CONFIRMATION_GRACE_MS;
    const snapshot = await this.getEngineSnapshot();
    const state = snapshot.state;
    const source = snapshot.source;
    const startTs = Number(snapshot.startTs || 0);

    if (state === 'RUNNING' && source === 'SCHEDULER' && startTs >= minStartTs) {
      return {
        confirmed: true,
        reason: 'ENGINE_RUNNING',
        startTs,
        sourceStore: snapshot.sourceStore,
      };
    }

    const history = Array.isArray(snapshot.history) ? snapshot.history : [];
    const matchingEntry = history.find(entry =>
      entry?.source === 'SCHEDULER' && Number(entry.startTs || 0) >= minStartTs);

    if (matchingEntry) {
      return {
        confirmed: true,
        reason: 'HISTORY_RECORDED',
        startTs: Number(matchingEntry.startTs || 0),
        historyId: matchingEntry.id,
        sourceStore: snapshot.sourceStore,
      };
    }

    return { confirmed: false, reason: 'NOT_CONFIRMED', sourceStore: snapshot.sourceStore };
  }

  async getEngineSnapshot() {
    const engine = typeof this.appStateStore?.getEngineState === 'function'
      ? await this.appStateStore.getEngineState()
      : (await this.appStateStore?.getState?.())?.engine;
    return {
      ...normalizeEngine(engine),
      sourceStore: 'appStateV2.engine',
    };
  }
}

module.exports = MotorConfirmationStore;
