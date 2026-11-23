import { getLocalAgentActivityLabel } from './LocalAgentRunCard';

describe('LocalAgentRunCard activity status', () => {
  it.each(['error', 'paused', 'completed', 'degraded'] as const)(
    'does not show an in-flight tool as running after the Agent is %s',
    (phase) => {
      expect(getLocalAgentActivityLabel('running', phase)).toBe('结果未确认');
    },
  );

  it('preserves the running status while execution is still active', () => {
    expect(getLocalAgentActivityLabel('running', 'running-tool')).toBe('执行中');
    expect(getLocalAgentActivityLabel('running', 'continuing')).toBe('执行中');
  });

  it('keeps confirmed tool outcomes truthful after a later provider failure', () => {
    expect(getLocalAgentActivityLabel('completed', 'error')).toBe('已完成');
    expect(getLocalAgentActivityLabel('truncated', 'error')).toBe('结果已截断');
    expect(getLocalAgentActivityLabel('rejected', 'paused')).toBe('已拒绝');
  });
});
