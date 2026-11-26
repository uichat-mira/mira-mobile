import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationRuntime } from '../runtime/conversationRuntime';
import type { LocalProviderModelOption } from '../runtime/localProviderModelSelection';
import type { AgentExecutionStrengthId } from '../settings/agentExecutionStrength';

export function useComposerControls(
  runtime: ConversationRuntime,
  sessionId: string,
) {
  const local = runtime.kind === 'local-provider';
  const supportsStrength =
    local &&
    runtime.supportsAgent === true &&
    !!runtime.getEffectiveAgentStrength &&
    !!runtime.getAgentStrengthOverride &&
    !!runtime.setAgentStrength &&
    !!runtime.resetAgentStrength;
  const supportsModels =
    local &&
    !!runtime.listLocalProviderModels &&
    !!runtime.selectLocalProviderModel;
  const [strength, setStrength] = useState<AgentExecutionStrengthId>('plain');
  const [override, setOverride] = useState<AgentExecutionStrengthId | null>(
    null,
  );
  const [models, setModels] = useState<LocalProviderModelOption[]>([]);
  const [strengthReady, setStrengthReady] = useState(false);
  const [modelsReady, setModelsReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const mutation = useRef(false);
  const mutationPending = useCallback(() => mutation.current, []);
  const refresh = useCallback(async () => {
    if (mutation.current) return;
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    const results = await Promise.allSettled([
      supportsStrength &&
      runtime.getEffectiveAgentStrength &&
      runtime.getAgentStrengthOverride
        ? Promise.all([
            runtime.getEffectiveAgentStrength(sessionId),
            runtime.getAgentStrengthOverride(sessionId),
          ])
        : Promise.resolve(null),
      supportsModels && runtime.listLocalProviderModels
        ? runtime.listLocalProviderModels(sessionId)
        : Promise.resolve([]),
    ] as const);
    if (generation.current !== version) return;
    const [s, m] = results;
    setStrengthReady(s.status === 'fulfilled' && s.value !== null);
    if (s.status === 'fulfilled' && s.value) {
      setStrength(s.value[0]);
      setOverride(s.value[1]);
    }
    setModelsReady(m.status === 'fulfilled');
    setModels(m.status === 'fulfilled' ? m.value : []);
    if (s.status === 'rejected' || m.status === 'rejected')
      setError('暂时无法读取对话设置');
    setLoading(false);
  }, [runtime, sessionId, supportsStrength, supportsModels]);

  useEffect(() => {
    mutation.current = false;
    setSaving(false);
    setStrength('plain');
    setStrengthReady(false);
    setModels([]);
    setModelsReady(false);
    void refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);

  const change = useCallback(async (operation: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true;
    const version = ++generation.current;
    setLoading(false);
    setSaving(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      if (generation.current === version)
        setError(cause instanceof Error ? cause.message : '无法保存对话设置');
    } finally {
      if (generation.current === version) {
        mutation.current = false;
        setSaving(false);
      }
    }
  }, []);

  const chooseStrength = useCallback(
    async (next: AgentExecutionStrengthId | null) => {
      if (!supportsStrength) return;
      await change(async () => {
        const version = generation.current;
        if (
          !runtime.resetAgentStrength ||
          !runtime.setAgentStrength ||
          !runtime.getEffectiveAgentStrength
        )
          return;
        if (next === null) await runtime.resetAgentStrength(sessionId);
        else await runtime.setAgentStrength(sessionId, next);
        const effective = await runtime.getEffectiveAgentStrength(sessionId);
        if (generation.current !== version) return;
        setStrength(effective);
        setOverride(next);
        setStrengthReady(true);
      });
    },
    [change, runtime, sessionId, supportsStrength],
  );

  const chooseModel = useCallback(
    async (providerId: string) => {
      if (!supportsModels) return;
      await change(async () => {
        const version = generation.current;
        if (!runtime.selectLocalProviderModel) return;
        const selected = await runtime.selectLocalProviderModel(
          sessionId,
          providerId,
        );
        if (generation.current !== version) return;
        setModels(previous =>
          previous.map(option =>
            option.providerId === selected.providerId
              ? selected
              : { ...option, selected: false },
          ),
        );
      });
    },
    [change, runtime, sessionId, supportsModels],
  );

  return {
    supportsStrength,
    supportsModels,
    strength,
    setStrength,
    override,
    models,
    strengthReady,
    modelsReady,
    loading,
    saving,
    mutationPending,
    error,
    refresh,
    chooseStrength,
    chooseModel,
  };
}
