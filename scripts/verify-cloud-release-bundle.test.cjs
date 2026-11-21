'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');
const { test } = require('node:test');

const verifier = resolve(__dirname, 'verify-cloud-release-bundle.cjs');
const auth = 'https://cloud-auth.tomzlab.cn';
const relay = 'https://cloud-relay.tomz.io';

const verify = (input, args = []) =>
  spawnSync(process.execPath, [verifier, ...args], {
    input,
    encoding: 'utf8',
  });

test('accepts a real binary input containing both official Cloud origins', () => {
  const result = verify(Buffer.from(`JS header\0${auth}\0${relay}\0`, 'utf8'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /approved Cloud Auth and Cloud-only Relay/);
});

test('rejects missing Relay, even when Cloud Auth is present', () => {
  const result = verify(auth);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Official Cloud origin is missing.*cloud-relay/);
});

test('rejects a bundle still containing the retired test Cloud Auth origin', () => {
  const result = verify(`${auth}\0${relay}\0https://test.cloud-auth.tomzlab.cn`);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Obsolete test Cloud Auth origin/);
});

test('does not accept a filesystem path argument', () => {
  const result = verify(`${auth}\0${relay}`, ['/tmp/any-file']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /provide the bundled JavaScript bytes on stdin/);
});
