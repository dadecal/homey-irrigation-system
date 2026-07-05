'use strict';

const {
  createProgramRequest,
  serializeProgramRequest,
} = require('./program-request');

class ProgramRequestTrigger {
  constructor(homey) {
    this.card = homey.flow.getTriggerCard('program_requested');
  }

  async trigger(queue) {
    const request = createProgramRequest(queue);
    await this.card.trigger({
      request: serializeProgramRequest(request),
    });
    return request;
  }
}

module.exports = ProgramRequestTrigger;
