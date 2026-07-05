'use strict';

const { randomUUID } = require('node:crypto');

function createProgramRequest(queue, now = Date.now()) {
  if (!Array.isArray(queue) || queue.length === 0 || queue.length > 6) {
    throw new Error('La solicitud debe contener entre 1 y 6 sectores');
  }

  const sectors = new Set();
  const normalizedQueue = queue.map((item, index) => {
    const sector = Number(item?.sector);
    const duration = Number(item?.duration);

    if (!Number.isInteger(sector) || sector < 1 || sector > 6) {
      throw new Error(`queue.${index}.sector debe estar entre 1 y 6`);
    }

    if (sectors.has(sector)) {
      throw new Error(`El sector ${sector} aparece mas de una vez`);
    }

    if (!Number.isInteger(duration) || duration < 1 || duration > 30) {
      throw new Error(`queue.${index}.duration debe estar entre 1 y 30`);
    }

    sectors.add(sector);
    return { sector, duration };
  });

  return {
    version: 1,
    requestId: randomUUID(),
    requestedAt: now,
    source: 'SCHEDULER',
    queue: normalizedQueue,
  };
}

function serializeProgramRequest(request) {
  return JSON.stringify(request);
}

module.exports = {
  createProgramRequest,
  serializeProgramRequest,
};
