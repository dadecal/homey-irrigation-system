'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getReleaseInfo } = require('../lib/release-info');

test('identifies the app as Rama 2', () => {
  const release = getReleaseInfo();

  assert.equal(release.generation, 'branch2');
  assert.equal(release.appId, 'com.dadecal.irrigation.v2');
  assert.equal(release.appVersion, '2.0.17');
  assert.equal(release.status, 'active');
});

test('keeps Rama 2 artifact names separate from Rama 1', () => {
  const release = getReleaseInfo();

  assert.match(release.artifactPattern, /v2/);
  assert.match(release.artifactPattern, /2\.0\.17/);
});
