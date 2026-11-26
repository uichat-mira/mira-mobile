/**
 * The single Local Agent execution-strength contract.
 *
 * A strength bounds tool rounds and elapsed time; it is not a model reasoning
 * effort, a cost target or a guarantee that every allowed round is used.
 * Concrete numbers are internal calibration points and must stay in this table.
 */
export type AgentExecutionStrengthId =
  | 'plain'
  | 'light'
  | 'standard'
  | 'enhanced'
  | 'deep';

export interface AgentExecutionStrength {
  id: AgentExecutionStrengthId;
  /** The only user-facing name. Numeric limits are never shown in settings. */
  label: string;
  description: string;
  maxToolRounds: number;
  /** null means the ordinary model request timeout, not an Agent deadline. */
  maxDurationMinutes: number | null;
}

export const AGENT_EXECUTION_STRENGTHS: readonly AgentExecutionStrength[] = [
  {
    id: 'plain',
    label: '纯对话',
    description: '不提供工具，沿用普通模型请求。',
    maxToolRounds: 0,
    maxDurationMinutes: null,
  },
  {
    id: 'light',
    label: '轻量',
    description: '适合简短任务和少量工具步骤。',
    maxToolRounds: 8,
    maxDurationMinutes: 5,
  },
  {
    id: 'standard',
    label: '标准',
    description: '默认强度，适合大多数日常任务。',
    maxToolRounds: 24,
    maxDurationMinutes: 15,
  },
  {
    id: 'enhanced',
    label: '增强',
    description: '适合需要更多工具步骤或多轮核对的任务。',
    maxToolRounds: 64,
    maxDurationMinutes: 40,
  },
  {
    id: 'deep',
    label: '深度',
    description: '适合长链路任务；仍受运行时间和取消操作约束。',
    maxToolRounds: 192,
    maxDurationMinutes: 120,
  },
];

export const DEFAULT_AGENT_EXECUTION_STRENGTH: AgentExecutionStrengthId = 'standard';

const STRENGTH_BY_ID = new Map(
  AGENT_EXECUTION_STRENGTHS.map((strength) => [strength.id, strength]),
);

export const isAgentExecutionStrengthId = (
  value: unknown,
): value is AgentExecutionStrengthId =>
  typeof value === 'string' && STRENGTH_BY_ID.has(value as AgentExecutionStrengthId);

export const getAgentExecutionStrength = (
  id: AgentExecutionStrengthId,
): AgentExecutionStrength =>
  STRENGTH_BY_ID.get(id) ??
  (STRENGTH_BY_ID.get(DEFAULT_AGENT_EXECUTION_STRENGTH) as AgentExecutionStrength);

/**
 * A thread override always wins. A missing or invalid global value falls back
 * to the default strength instead of weakening the saved thread choice.
 */
export const resolveAgentExecutionStrength = (
  override: AgentExecutionStrengthId | null | undefined,
  global: AgentExecutionStrengthId | null | undefined,
): AgentExecutionStrengthId => {
  if (isAgentExecutionStrengthId(override)) return override;
  if (isAgentExecutionStrengthId(global)) return global;
  return DEFAULT_AGENT_EXECUTION_STRENGTH;
};

const LEGACY_ROUNDS_MIN = 1;
const LEGACY_ROUNDS_MAX = 64;
const LEGACY_DURATION_MINUTES_MIN = 1;
const LEGACY_DURATION_MINUTES_MAX = 120;

const legacyNumber = (
  value: unknown,
  min: number,
  max: number,
): number | null => typeof value === 'number' && Number.isFinite(value)
  ? Math.min(max, Math.max(min, Math.round(value)))
  : null;

/**
 * Deterministic migration for the removed free-form budget.
 *
 * Legacy values are first bounded by the old stored contract (1–64 rounds,
 * 1–120 minutes), then mapped to the closest non-plain strength using the sum
 * of relative rounds/time distance. Ties prefer the lower strength in table
 * order, so the same stored record always migrates to the same strength.
 */
export const migrateLegacyAgentBudgetToStrength = (
  value: unknown,
): AgentExecutionStrengthId => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_AGENT_EXECUTION_STRENGTH;
  }
  const candidate = value as Record<string, unknown>;
  const rounds = legacyNumber(
    candidate.maxToolRounds,
    LEGACY_ROUNDS_MIN,
    LEGACY_ROUNDS_MAX,
  );
  const minutes = legacyNumber(
    candidate.maxDurationMinutes,
    LEGACY_DURATION_MINUTES_MIN,
    LEGACY_DURATION_MINUTES_MAX,
  );
  if (rounds === null || minutes === null) {
    return DEFAULT_AGENT_EXECUTION_STRENGTH;
  }

  let best = getAgentExecutionStrength(DEFAULT_AGENT_EXECUTION_STRENGTH);
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const strength of AGENT_EXECUTION_STRENGTHS) {
    if (strength.maxToolRounds === 0 || strength.maxDurationMinutes === null) {
      continue;
    }
    const distance =
      Math.abs(rounds - strength.maxToolRounds) / strength.maxToolRounds +
      Math.abs(minutes - strength.maxDurationMinutes) /
        strength.maxDurationMinutes;
    if (distance < bestDistance) {
      best = strength;
      bestDistance = distance;
    }
  }
  return best.id;
};
