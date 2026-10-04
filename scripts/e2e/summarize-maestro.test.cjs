'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSummary, parseJUnit } = require('./summarize-maestro.cjs');

test('parses pass, fail and skip flow results from JUnit', () => {
  const xml = [
    '<testsuite>',
    '<testcase name="Startup &amp; list" />',
    '<testcase name="Open thread"><failure message="boom"/></testcase>',
    '<testcase name="Optional"><skipped/></testcase>',
    '</testsuite>',
  ].join('');

  assert.deepEqual(parseJUnit(xml), [
    { name: 'Startup & list', status: 'PASS' },
    { name: 'Open thread', status: 'FAIL' },
    { name: 'Optional', status: 'SKIP' },
  ]);
});

test('summary binds flow results to tested SHA, emulator identity and APK digest', () => {
  const summary = buildSummary({
    junitXml: '<testsuite><testcase name="Settings navigation"/></testsuite>',
    maestroExitCode: '0',
    env: {
      GITHUB_SHA: 'abc123',
      MIRA_E2E_ANDROID_API: '34',
      MIRA_E2E_DEVICE_MODEL: 'Pixel_6',
      MIRA_E2E_DEVICE_SERIAL: 'emulator-5554',
      MIRA_E2E_MAESTRO_VERSION: '2.11.0',
      MIRA_E2E_APK_SHA256: 'deadbeef',
    },
  });

  assert.match(summary, /abc123/u);
  assert.match(summary, /Android API: `34`/u);
  assert.match(summary, /PASS — Settings navigation/u);
  assert.match(summary, /deadbeef/u);
});
