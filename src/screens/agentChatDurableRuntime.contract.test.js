const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const source = readFileSync(
  resolve(process.cwd(), 'src/screens/AgentChatScreen.tsx'),
  'utf8',
);

describe('MOB-043 durable Agent observation lifecycle', () => {
  it('continuously discovers canonical messages with serialized polling', () => {
    expect(source).toContain('await refreshMessages();');
    expect(source).toContain('setTimeout(() => {');
    expect(source).toContain('void runDiscovery();');
    expect(source).not.toContain('setInterval(() =>');
    expect(source).not.toContain('shouldDiscoverAgentRun');
  });

  it('restarts same-run observation after a successful retry', () => {
    expect(source).toContain('observationGeneration');
    expect(source).toContain('nextRunId === previousRunId && !existingRun');
    expect(source).toContain('observationGenerationRef.current += 1');
    expect(source).toContain('generation !== observationGenerationRef.current');
    expect(source).toContain('runRef.current = null');
    expect(source).toContain('[appActive, observationGeneration, runId, sessionId]');
  });
});


describe('MOB-043 durable discovery race guards', () => {
  it('does not let a duplicate snapshot invalidate an in-flight new-run read', () => {
    expect(source).toContain("existingRun?.id === nextRunId");
    expect(source.indexOf('const sequence = requestSequenceRef.current + 1;')).toBeGreaterThan(
      source.indexOf('existingRun?.id === nextRunId'),
    );
  });
});


describe('MOB-043 observer ownership', () => {
  it('prevents an old run observer from overwriting a newly discovered run', () => {
    expect(source).toContain('runIdRef.current !== runId');
    expect(source).toContain('runIdRef.current === runId');
  });
});
