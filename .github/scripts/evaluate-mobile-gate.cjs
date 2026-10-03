'use strict';

const KNOWN_JOBS = [
  'quality',
  'android',
  'android-release',
  'ios',
  'publish-dev-release',
  'publish-prod-release',
];

function expectedResults(eventName, ref) {
  const isReleaseBranch =
    ref === 'refs/heads/dev' || ref === 'refs/heads/prod';
  const androidReleaseRequired =
    isReleaseBranch &&
    (eventName === 'push' || eventName === 'workflow_dispatch');

  return {
    quality: 'success',
    android: 'success',
    'android-release': androidReleaseRequired ? 'success' : 'skipped',
    ios: 'success',
    'publish-dev-release':
      eventName === 'push' && ref === 'refs/heads/dev' ? 'success' : 'skipped',
    'publish-prod-release':
      eventName === 'push' && ref === 'refs/heads/prod' ? 'success' : 'skipped',
  };
}

function evaluateGate({ eventName, ref, needs }) {
  const expected = expectedResults(eventName, ref);
  const checks = [];
  const failures = [];

  for (const job of KNOWN_JOBS) {
    const actual = needs[job]?.result ?? 'missing';
    const wanted = expected[job];
    const ok = actual === wanted;
    checks.push({ job, expected: wanted, actual, ok });
    if (!ok) {
      failures.push(`${job}: expected ${wanted}, got ${actual}`);
    }
  }

  // Any future dependency added to Mira Gate is required by default.
  // Optional jobs must be deliberately classified above instead of becoming
  // an accidental green skip.
  for (const [job, value] of Object.entries(needs)) {
    if (KNOWN_JOBS.includes(job)) continue;
    const actual = value?.result ?? 'missing';
    const ok = actual === 'success';
    checks.push({ job, expected: 'success', actual, ok });
    if (!ok) {
      failures.push(`${job}: expected success, got ${actual}`);
    }
  }

  return { ok: failures.length === 0, checks, failures };
}

function runCli() {
  let needs;
  try {
    needs = JSON.parse(process.env.MIRA_GATE_NEEDS || '{}');
  } catch (error) {
    console.error('Mira Gate could not parse MIRA_GATE_NEEDS JSON.');
    console.error(error);
    process.exitCode = 1;
    return;
  }

  const result = evaluateGate({
    eventName: process.env.MIRA_GATE_EVENT || '',
    ref: process.env.MIRA_GATE_REF || '',
    needs,
  });

  console.log(
    `Mira Gate policy: event=${process.env.MIRA_GATE_EVENT || '<missing>'} ref=${process.env.MIRA_GATE_REF || '<missing>'}`,
  );
  for (const check of result.checks) {
    console.log(
      `${check.ok ? 'PASS' : 'FAIL'} ${check.job}: expected=${check.expected} actual=${check.actual}`,
    );
  }

  if (!result.ok) {
    console.error('Mira Gate failed:');
    for (const failure of result.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

if (require.main === module) runCli();

module.exports = { evaluateGate, expectedResults };
