'use strict';

const releaseInfo = Object.freeze({
  generation: 'branch2',
  generationLabel: 'Rama 2',
  appId: 'com.dadecal.irrigation.v2',
  appVersion: '2.0.17',
  status: 'active',
  artifactPattern: 'homey-irrigation-app-v2-2.0.17.tgz',
  contracts: {
    provides: {
      appApi: {
        name: 'irrigation-app-api',
        version: '2.0.17',
      },
    },
    requires: {
      hardwareApi: {
        name: 'irrigation-hw-api',
        range: '>=1.0.0 <2.0.0',
      },
    },
  },
});

function getReleaseInfo() {
  return releaseInfo;
}

module.exports = {
  getReleaseInfo,
  releaseInfo,
};
