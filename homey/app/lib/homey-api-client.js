'use strict';

class HomeyApiClient {
  constructor(homey) {
    this.homey = homey;
    this.api = null;
  }

  async getApi() {
    if (!this.api) {
      const { HomeyAPI } = require('homey-api');
      this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    }

    return this.api;
  }
}

module.exports = HomeyApiClient;
