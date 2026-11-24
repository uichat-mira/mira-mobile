import {
  AGENT_EXECUTION_STRENGTHS,
  DEFAULT_AGENT_EXECUTION_STRENGTH,
  getAgentExecutionStrength,
  isAgentExecutionStrengthId,
  migrateLegacyAgentBudgetToStrength,
  resolveAgentExecutionStrength,
} from './agentExecutionStrength';

describe('agentExecutionStrength', () => {
  it('keeps the five strengths in one central table', () => {
    expect(AGENT_EXECUTION_STRENGTHS.map((strength) => [
      strength.id,
      strength.maxToolRounds,
      strength.maxDurationMinutes,
    ])).toEqual([
      ['plain', 0, null],
      ['light', 8, 5],
      ['standard', 24, 15],
      ['enhanced', 64, 40],
      ['deep', 192, 120],
    ]);
    expect(DEFAULT_AGENT_EXECUTION_STRENGTH).toBe('standard');
  });

  it('has no 64-round ceiling for deep execution', () => {
    expect(getAgentExecutionStrength('deep').maxToolRounds).toBe(192);
    expect(getAgentExecutionStrength('deep').maxToolRounds)
      .toBeGreaterThan(64);
  });

  it('offers one user-facing name per strength and no numeric label', () => {
    const labels = AGENT_EXECUTION_STRENGTHS.map((strength) => strength.label);
    expect(labels).toEqual(['纯对话', '轻量', '标准', '增强', '深度']);
    for (const label of labels) {
      expect(label).not.toMatch(/\d/);
    }
  });

  it('resolves a thread override over the global default', () => {
    expect(resolveAgentExecutionStrength('deep', 'light')).toBe('deep');
    expect(resolveAgentExecutionStrength(null, 'enhanced')).toBe('enhanced');
    expect(resolveAgentExecutionStrength(undefined, undefined)).toBe('standard');
    expect(isAgentExecutionStrengthId('standard')).toBe(true);
    expect(isAgentExecutionStrengthId('maximum')).toBe(false);
  });

  it('migrates the removed free-form budget deterministically', () => {
    expect(migrateLegacyAgentBudgetToStrength({
      maxToolRounds: 16, maxDurationMinutes: 15,
    })).toBe('standard');
    expect(migrateLegacyAgentBudgetToStrength({
      maxToolRounds: 8, maxDurationMinutes: 5,
    })).toBe('light');
    expect(migrateLegacyAgentBudgetToStrength({
      maxToolRounds: 64, maxDurationMinutes: 40,
    })).toBe('enhanced');
    expect(migrateLegacyAgentBudgetToStrength({
      maxToolRounds: 999, maxDurationMinutes: 999,
    })).toBe('deep');
    expect(migrateLegacyAgentBudgetToStrength({
      maxToolRounds: 'many', maxDurationMinutes: 15,
    })).toBe('standard');
    expect(migrateLegacyAgentBudgetToStrength(null)).toBe('standard');
  });
});
