import type { LocalProviderConfig } from '../provider/providerConfigStore';

/**
 * One configured Local Provider/model pair selectable for a conversation.
 *
 * A Local Provider configuration already binds exactly one model, so the
 * option list is the configured Provider list rather than a discovered model
 * catalogue. No credential material is exposed here.
 */
export interface LocalProviderModelOption {
  /** Stable configured Provider id persisted as the session's `providerId`. */
  providerId: string;
  /** User-authored Provider name. */
  providerName: string;
  /** Exact model id sent to the Provider. */
  model: string;
  /**
   * Host of the configured Base URL, added only when another configured
   * Provider shares the same display name so the user can tell them apart.
   */
  providerHost?: string;
  /** Whether this is the conversation's persisted current selection. */
  selected: boolean;
}

export type LocalProviderModelSelectionErrorReason =
  | 'provider-missing'
  | 'provider-unavailable'
  | 'credential-missing'
  | 'run-active';

export class LocalProviderModelSelectionError extends Error {
  readonly code = 'LOCAL_PROVIDER_MODEL_SELECTION_FAILED';

  constructor(
    readonly reason: LocalProviderModelSelectionErrorReason,
    readonly providerId?: string,
  ) {
    super(
      reason === 'provider-missing'
        ? '所选 Local Provider 已不存在，请重新选择。'
        : reason === 'provider-unavailable'
          ? '所选 Local Provider 需要先在设置中修正 Base URL 和协议。'
          : reason === 'credential-missing'
            ? '所选 Local Provider 尚未配置 API Key。'
            : '当前对话正在运行，请等待本轮结束后再切换模型。',
    );
    this.name = 'LocalProviderModelSelectionError';
  }
}

const providerHost = (baseUrl: string): string | undefined => {
  try {
    return new URL(baseUrl).host || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Projects configured Providers into selection options without changing the
 * stored configuration. The selected flag comes from the session's canonical
 * `providerId`, not from a parallel selection field.
 */
export const buildLocalProviderModelOptions = (
  configs: readonly LocalProviderConfig[],
  selectedProviderId: string | null,
): LocalProviderModelOption[] => {
  const nameCounts = new Map<string, number>();
  for (const config of configs) {
    nameCounts.set(config.name, (nameCounts.get(config.name) ?? 0) + 1);
  }

  return configs.map((config) => {
    const host =
      (nameCounts.get(config.name) ?? 0) > 1
        ? providerHost(config.baseUrl)
        : undefined;
    return {
      providerId: config.id,
      providerName: config.name,
      model: config.model,
      ...(host ? { providerHost: host } : {}),
      selected: config.id === selectedProviderId,
    };
  });
};
