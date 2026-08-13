'use strict';

const {
  createProgramRequest,
  serializeProgramRequest,
} = require('./program-request');

class ProgramRequestTrigger {
  constructor(homey) {
    this.card = homey.flow.getTriggerCard('program_requested');
  }

  createRequest(queue, metadata = {}) {
    return createProgramRequest(queue, Date.now(), metadata);
  }

  async triggerRequest(request) {
    await this.card.trigger({
      request: serializeProgramRequest(request),
    });
    return request;
  }

  async trigger(queue, metadata = {}) {
    return this.triggerRequest(this.createRequest(queue, metadata));
  }
}

module.exports = ProgramRequestTrigger;
