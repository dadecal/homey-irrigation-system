'use strict';

class LogicVariableStore {
  constructor({ homey, apiClient = null, logic = null }) {
    this.homey = homey;
    this.apiClient = apiClient;
    this.logic = logic;
  }

  async getLogic() {
    if (this.logic) {
      return this.logic;
    }

    if (this.homey.logic?.getVariables) {
      return this.homey.logic;
    }

    const api = await this.apiClient.getApi();
    return api.logic;
  }

  async getVariables() {
    const logic = await this.getLogic();
    return logic.getVariables();
  }

  async getVariable(name) {
    const variables = await this.getVariables();
    return Object.values(variables).find(variable => variable.name === name) || null;
  }

  async getValue(name, fallback = null) {
    const variable = await this.getVariable(name);
    return variable ? variable.value : fallback;
  }

  async setValue(name, value, type) {
    const logic = await this.getLogic();
    const variable = await this.getVariable(name);

    if (!variable) {
      await logic.createVariable({ variable: { name, type, value } });
      return;
    }

    if (variable.value === value) {
      return;
    }

    await logic.updateVariable({ id: variable.id, variable: { value } });
  }

  async ensureVariable(name, value, type) {
    if (await this.getVariable(name)) {
      return;
    }

    const logic = await this.getLogic();
    await logic.createVariable({ variable: { name, type, value } });
  }
}

module.exports = LogicVariableStore;
