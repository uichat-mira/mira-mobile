#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');

// The release workflow supplies the bundle via stdin. Never accept a
// filesystem path from command-line arguments in CI or agent workflows.
if (process.argv.length > 2) {
  console.error('Usage: provide the bundled JavaScript bytes on stdin');
  process.exit(2);
}

const bundle = readFileSync(0);
const requiredOrigins = [
  'https://cloud-auth.tomzlab.cn',
  'https://cloud-relay.tomz.io',
];
const obsoleteTestOrigin = 'https://test.cloud-auth.tomzlab.cn';

let failed = false;
for (const origin of requiredOrigins) {
  if (!bundle.includes(Buffer.from(origin, 'utf8'))) {
    console.error(`Official Cloud origin is missing from bundled app: ${origin}`);
    failed = true;
  }
}
if (bundle.includes(Buffer.from(obsoleteTestOrigin, 'utf8'))) {
  console.error('Obsolete test Cloud Auth origin is still bundled');
  failed = true;
}

if (failed) {
  process.exitCode = 1;
} else {
  console.log('Bundled app includes the approved Cloud Auth and Cloud-only Relay origins');
}
