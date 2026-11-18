'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');

const verifier = resolve(__dirname, 'verify-cloud-release-bundle.cjs');
const auth = 'https://cloud-auth.tomzlab.cn';
const relay = 'https://cloud-relay.tomz.io';

const withFixture = (contents, check) => {
  const directory = mkdtempSync(join(tmpdir(), 'mira-cloud-bundle-'));
  const bundle = join(directory, 'index.android.bundle');
  try {
    writeFileSync(bundle, contents);
    check(bundle);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test('accepts a bundled candidate containing both approved Cloud origins', () => {
  withFixture(Buffer.from(`JS header\0${auth}\0${relay}\0`, 'utf8'), bundle => {
    assert.match(
      execFileSync(process.execPath, [verifier, bundle], { encoding: 'utf8' }),
      /approved Cloud Auth and Cloud-only Relay/,
    );
  });
});

test('rejects missing Relay, even when Cloud Auth is present', () => {
  withFixture(auth, bundle => {
    const result = spawnSync(process.execPath, [verifier, bundle], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Official Cloud origin is missing.*cloud-relay/);
  });
});

test('rejects a bundle still containing the retired test Cloud Auth origin', () => {
  withFixture(`${auth}\0${relay}\0https://test.cloud-auth.tomzlab.cn`, bundle => {
    const result = spawnSync(process.execPath, [verifier, bundle], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Obsolete test Cloud Auth origin/);
  });
});
