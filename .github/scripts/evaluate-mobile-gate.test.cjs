'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateGate, expectedResults } = require('./evaluate-mobile-gate.cjs');

const baseNeeds = {
  quality: { result: 'success' },
  android: { result: 'success' },
  'android-release': { result: 'skipped' },
  ios: { result: 'success' },
  'publish-dev-release': { result: 'skipped' },
  'publish-prod-release': { result: 'skipped' },
};

test('pull request requires quality and platform builds while release jobs are not applicable', () => {
  const result = evaluateGate({
    eventName: 'pull_request',
    ref: 'refs/pull/42/merge',
    needs: baseNeeds,
  });
  assert.equal(result.ok, true);
});

test('test push keeps release and publication jobs explicitly not applicable', () => {
  const result = evaluateGate({
    eventName: 'push',
    ref: 'refs/heads/test',
    needs: baseNeeds,
  });
  assert.equal(result.ok, true);
});

test('dev push requires signed Android release and dev publication', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-release'].result = 'success';
  needs['publish-dev-release'].result = 'success';

  const result = evaluateGate({
    eventName: 'push',
    ref: 'refs/heads/dev',
    needs,
  });
  assert.equal(result.ok, true);
});

test('prod push requires signed Android release and production publication', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-release'].result = 'success';
  needs['publish-prod-release'].result = 'success';

  const result = evaluateGate({
    eventName: 'push',
    ref: 'refs/heads/prod',
    needs,
  });
  assert.equal(result.ok, true);
});

test('workflow dispatch requires the signed Android release job', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-release'].result = 'success';

  const result = evaluateGate({
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/feat/mob-058-mira-gate',
    needs,
  });
  assert.equal(result.ok, true);
});

test('required failure makes the gate fail', () => {
  const needs = structuredClone(baseNeeds);
  needs.quality.result = 'failure';

  const result = evaluateGate({
    eventName: 'pull_request',
    ref: 'refs/pull/42/merge',
    needs,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /quality/);
});

test('required skip is not accepted as success', () => {
  const needs = structuredClone(baseNeeds);
  needs.android.result = 'skipped';

  const result = evaluateGate({
    eventName: 'pull_request',
    ref: 'refs/pull/42/merge',
    needs,
  });
  assert.equal(result.ok, false);
});

test('a not-applicable release job unexpectedly running is rejected', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-release'].result = 'success';

  const result = evaluateGate({
    eventName: 'pull_request',
    ref: 'refs/pull/42/merge',
    needs,
  });
  assert.equal(result.ok, false);
});

test('an unclassified future dependency is required by default', () => {
  const needs = structuredClone(baseNeeds);
  needs['future-required-job'] = { result: 'failure' };

  const result = evaluateGate({
    eventName: 'pull_request',
    ref: 'refs/pull/42/merge',
    needs,
  });
  assert.equal(result.ok, false);
  assert.match(result.failures.join('\n'), /future-required-job/);
});

test('stage policy is explicit for dev and prod publication', () => {
  assert.equal(
    expectedResults('push', 'refs/heads/dev')['publish-dev-release'],
    'success',
  );
  assert.equal(
    expectedResults('push', 'refs/heads/dev')['publish-prod-release'],
    'skipped',
  );
  assert.equal(
    expectedResults('push', 'refs/heads/prod')['publish-prod-release'],
    'success',
  );
});
