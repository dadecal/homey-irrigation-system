'use strict';

const HomeyApiClient = require('./homey-api-client');

const CONFIRMATION_GRACE_MS = 60 * 1000;

const VAR = {
  state: 'Irrigation.State',
  source: 'Irrigation.Source',
  startTs: 'Irrigation.StartTimestamp',
  history: 'Irrigation.History',
};

class MotorConfirmationStore {
  constructor(homey, apiClient = null) {
    this.homey = homey;
    this.apiClient = apiClient || new HomeyApiClient(homey);
  }

  async getVariablesByName() {
    const variables = await this.getLogicVariables();
    return Object.values(variables).reduce((acc, variable) => {
      acc[variable.name] = variable;
      return acc;
    }, {});
  }

  async getLogicVariables() {
    if (this.homey.logic?.getVariables) {
      return this.homey.logic.getVariables();
    }

    const api = await this.apiClient.getApi();
    return api.logic.getVariables();
  }

  async getConfirmation(pendingRequest) {
    if (!pendingRequest) {
      return { confirmed: false, reason: 'NO_PENDING_REQUEST' };
    }

    const variables = await this.getVariablesByName();
    const minStartTs = pendingRequest.requestedAt - CONFIRMATION_GRACE_MS;
    const state = variables[VAR.state]?.value;
    const source = variables[VAR.source]?.value;
    const startTs = Number(variables[VAR.startTs]?.value || 0);

    if (state === 'RUNNING' && source === 'SCHEDULER' && startTs >= minStartTs) {
      return {
        confirmed: true,
        reason: 'ENGINE_RUNNING',
        startTs,
      };
    }

    const history = this.parseHistory(variables[VAR.history]?.value);
    const matchingEntry = history.find(entry =>
      entry?.source === 'SCHEDULER' && Number(entry.startTs || 0) >= minStartTs);

    if (matchingEntry) {
      return {
        confirmed: true,
        reason: 'HISTORY_RECORDED',
        startTs: Number(matchingEntry.startTs || 0),
        historyId: matchingEntry.id,
      };
    }

    return { confirmed: false, reason: 'NOT_CONFIRMED' };
  }

  parseHistory(raw) {
    if (!raw || typeof raw !== 'string') {
      return [];
    }

    try {
      const history = JSON.parse(raw);
      return Array.isArray(history) ? history : [];
    } catch (error) {
      this.homey.app.error('Scheduler confirmation history parse failed', error);
      return [];
    }
  }
}

module.exports = MotorConfirmationStore;
