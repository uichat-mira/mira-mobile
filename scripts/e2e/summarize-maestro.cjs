'use strict';

const fs = require('node:fs');

const decodeXml = (value) => value
  .replaceAll('&quot;', '"')
  .replaceAll('&apos;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&amp;', '&');

const readAttribute = (attributes, name) => {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : '';
};

const parseJUnit = (xml) => {
  const cases = [];
  const pattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gu;
  for (const match of xml.matchAll(pattern)) {
    const attributes = match[1] || '';
    const body = match[2] || '';
    const failed = /<(?:failure|error)\b/u.test(body);
    const skipped = /<skipped\b/u.test(body);
    cases.push({
      name: readAttribute(attributes, 'name') || 'unnamed flow',
      status: failed ? 'FAIL' : skipped ? 'SKIP' : 'PASS',
    });
  }
  return cases;
};

const buildSummary = ({ junitXml, maestroExitCode, env = process.env }) => {
  const cases = junitXml ? parseJUnit(junitXml) : [];
  const lines = [
    '# Android Maestro critical smoke',
    '',
    `- tested commit SHA: \`${env.GITHUB_SHA || 'unknown'}\``,
    `- Android API: \`${env.MIRA_E2E_ANDROID_API || 'unknown'}\``,
    `- device: \`${env.MIRA_E2E_DEVICE_MODEL || 'unknown'}\``,
    `- device serial: \`${env.MIRA_E2E_DEVICE_SERIAL || 'unknown'}\``,
    `- Maestro: \`${env.MIRA_E2E_MAESTRO_VERSION || 'unknown'}\``,
    `- APK SHA-256: \`${env.MIRA_E2E_APK_SHA256 || 'unknown'}\``,
    '- APK source: `uichat-mira-mobile-android-debug` from the same workflow/SHA',
    `- Maestro exit code: \`${maestroExitCode}\``,
    '',
    '## Flows',
    '',
  ];

  if (cases.length === 0) {
    lines.push('- REPORT_UNAVAILABLE: no JUnit testcase entries were produced.');
  } else {
    for (const item of cases) {
      lines.push(`- ${item.status} — ${item.name}`);
    }
  }
  lines.push('');
  return lines.join('\n');
};

if (require.main === module) {
  const [, , inputPath, outputPath, exitCode = 'unknown'] = process.argv;
  if (!outputPath) {
    console.error('Usage: summarize-maestro.cjs <junit.xml> <summary.md> [maestro-exit-code]');
    process.exit(2);
  }
  const junitXml = inputPath && fs.existsSync(inputPath)
    ? fs.readFileSync(inputPath, 'utf8')
    : '';
  fs.writeFileSync(
    outputPath,
    buildSummary({ junitXml, maestroExitCode: exitCode }),
    'utf8',
  );
}

module.exports = { buildSummary, parseJUnit };
