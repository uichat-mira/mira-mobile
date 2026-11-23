/**
 * The single Local Agent execution budget contract. This is not a cost limit:
 * it bounds tool rounds and elapsed time, regardless of the Agent engine.
 */
export interface AgentExecutionBudget {
  maxToolRounds: number;
  maxDurationMinutes: number;
}

export const AGENT_ROUNDS_MIN = 1;
export const AGENT_ROUNDS_MAX = 64;
export const AGENT_DURATION_MINUTES_MIN = 1;
export const AGENT_DURATION_MINUTES_MAX = 120;

export const DEFAULT_AGENT_EXECUTION_BUDGET: AgentExecutionBudget = {
  maxToolRounds: 16,
  maxDurationMinutes: 15,
};

const normalized = (
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(max, Math.max(min, Math.round(value)))
  : fallback;

/** Fail closed on invalid serialized input without invalidating old settings. */
export const sanitizeAgentExecutionBudget = (value: unknown): AgentExecutionBudget => {
  const candidate = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    maxToolRounds: normalized(
      candidate.maxToolRounds,
      AGENT_ROUNDS_MIN,
      AGENT_ROUNDS_MAX,
      DEFAULT_AGENT_EXECUTION_BUDGET.maxToolRounds,
    ),
    maxDurationMinutes: normalized(
      candidate.maxDurationMinutes,
      AGENT_DURATION_MINUTES_MIN,
      AGENT_DURATION_MINUTES_MAX,
      DEFAULT_AGENT_EXECUTION_BUDGET.maxDurationMinutes,
    ),
  };
};
