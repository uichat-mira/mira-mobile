'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateGate, expectedResults } = require('./evaluate-mobile-gate.cjs');

const baseNeeds = {
  quality: { result: 'success' },
  android: { result: 'success' },
  'android-maestro': { result: 'skipped' },
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

test('test push requires Android Maestro while release jobs stay not applicable', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-maestro'].result = 'success';

  const result = evaluateGate({
    eventName: 'push',
    ref: 'refs/heads/test',
    needs,
  });
  assert.equal(result.ok, true);
});

test('test push fails when Android Maestro is skipped or fails', () => {
  const skipped = evaluateGate({
    eventName: 'push',
    ref: 'refs/heads/test',
    needs: baseNeeds,
  });
  assert.equal(skipped.ok, false);
  assert.match(skipped.failures.join('\n'), /android-maestro/);

  const needs = structuredClone(baseNeeds);
  needs['android-maestro'].result = 'failure';
  const failed = evaluateGate({
    eventName: 'push',
    ref: 'refs/heads/test',
    needs,
  });
  assert.equal(failed.ok, false);
  assert.match(failed.failures.join('\n'), /android-maestro/);
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

test('workflow dispatch on a non-release branch requires Android Maestro', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-maestro'].result = 'success';

  const result = evaluateGate({
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/feat/mob-059-android-maestro',
    needs,
  });
  assert.equal(result.ok, true);
});

test('workflow dispatch on dev requires signed Android release and Android Maestro but not publication', () => {
  const needs = structuredClone(baseNeeds);
  needs['android-release'].result = 'success';
  needs['android-maestro'].result = 'success';

  const result = evaluateGate({
    eventName: 'workflow_dispatch',
    ref: 'refs/heads/dev',
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
  assert.equal(
    expectedResults('workflow_dispatch', 'refs/heads/dev')['publish-dev-release'],
    'skipped',
  );
  assert.equal(
    expectedResults('push', 'refs/heads/test')['android-maestro'],
    'success',
  );
  assert.equal(
    expectedResults('push', 'refs/heads/dev')['android-maestro'],
    'skipped',
  );
  assert.equal(
    expectedResults('workflow_dispatch', 'refs/heads/dev')['android-maestro'],
    'success',
  );
});


test('workflow graph keeps Maestro out of dev publishing while Mira Gate observes it', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', 'workflows', 'mobile-ci.yml'),
    'utf8',
  );

  const publishDev = workflow.slice(
    workflow.indexOf('  publish-dev-release:'),
    workflow.indexOf('  publish-prod-release:'),
  );
  assert.doesNotMatch(publishDev, /\n\s+- android-maestro\s*\n/u);

  const miraGate = workflow.slice(workflow.indexOf('  mira-gate:'));
  assert.match(miraGate, /\n\s+- android-maestro\s*\n/u);
});
