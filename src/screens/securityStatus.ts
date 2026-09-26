import { deviceCredentialStore } from '../security/deviceCredentialStore';
import { desktopCredentialStore } from '../security/desktopCredentialStore';
import { providerCredentialStore } from '../security/providerCredentialStore';
import { ProviderConfigStore } from '../provider/providerConfigStore';
import {
  loadShiyanRuntimeConfig,
  SHIYAN_API_BASE_URL,
} from '../shiyan/client/runtimeConfig';

/**
 * 只读安全状态聚合：让"设置 → 安全"页在不暴露凭据的前提下展示设备本地
 * 各类安全凭据的"是否存在 / 是否可用 / 指向什么"三类信号。页面只在聚合
 * 层调用，绝不把 Token、API Key、设备 secret 渲染到 UI。
 *
 * 三态必须区分（AGENTS.md §3「失败时给出明确、可操作的错误信息」）：
 * - `supported === false`：当前构建没有可用的安全存储，谈不上保存；
 * - `error === true`：读取抛错，凭据可能仍存在，页面必须提示并允许重试，
 *   不能伪装成"尚未保存"；
 * - 其余情况才是真正的"未保存"或"已保存"。
 */

export interface SecurityDeviceCredentialStatus {
  available: boolean;
  supported: boolean;
  error: boolean;
  hostUrl: string | null;
  savedAt: string | null;
}

export interface SecurityDesktopCredentialStatus {
  available: boolean;
  supported: boolean;
  error: boolean;
  hostUrl: string | null;
  username: string | null;
  savedAt: string | null;
}

export interface SecurityProviderStatus {
  total: number;
  withApiKey: number;
  supported: boolean;
  /** Provider 配置列表本身读取失败。 */
  error: boolean;
  /** 单独某个 Provider 的 API Key 读取失败次数（不影响其它 Provider）。 */
  keyReadErrors: number;
  items: Array<{ id: string; name: string; baseUrl: string; hasApiKey: boolean }>;
}

export interface SecurityShiyanStatus {
  available: boolean;
  supported: boolean;
  error: boolean;
  baseUrl: string | null;
  defaultBaseUrl: string;
}

export interface SecurityStatus {
  remoteHost: SecurityDeviceCredentialStatus;
  desktopHost: SecurityDesktopCredentialStatus;
  providers: SecurityProviderStatus;
  shiyan: SecurityShiyanStatus;
  /** 任一读取失败即 true，供页面展示统一的错误横幅与重试入口。 */
  hasError: boolean;
}

const readRemoteHost = async (): Promise<SecurityDeviceCredentialStatus> => {
  const empty: SecurityDeviceCredentialStatus = {
    available: false,
    supported: true,
    error: false,
    hostUrl: null,
    savedAt: null,
  };
  if (!deviceCredentialStore.isAvailable()) {
    return { ...empty, supported: false };
  }
  try {
    const stored = await deviceCredentialStore.load();
    if (!stored) return empty;
    return {
      available: true,
      supported: true,
      error: false,
      hostUrl: stored.hostUrl,
      savedAt: stored.savedAt,
    };
  } catch {
    // 读取失败与"未保存"必须区分：凭据可能仍存在，只是本次读不出来。
    return { ...empty, error: true };
  }
};

const readDesktopHost = async (): Promise<SecurityDesktopCredentialStatus> => {
  const empty: SecurityDesktopCredentialStatus = {
    available: false,
    supported: true,
    error: false,
    hostUrl: null,
    username: null,
    savedAt: null,
  };
  if (!desktopCredentialStore.isAvailable()) {
    return { ...empty, supported: false };
  }
  try {
    const stored = await desktopCredentialStore.load();
    if (!stored) return empty;
    return {
      available: true,
      supported: true,
      error: false,
      hostUrl: stored.hostUrl,
      username: stored.username,
      savedAt: stored.savedAt,
    };
  } catch {
    return { ...empty, error: true };
  }
};

const readProviders = async (): Promise<SecurityProviderStatus> => {
  const supported = providerCredentialStore.isAvailable();
  let configs: ReadonlyArray<{ id: string; name: string; baseUrl: string }>;
  try {
    configs = await new ProviderConfigStore().load();
  } catch {
    return { total: 0, withApiKey: 0, supported, error: true, keyReadErrors: 0, items: [] };
  }

  const items: SecurityProviderStatus['items'] = [];
  let withApiKey = 0;
  let keyReadErrors = 0;
  for (const config of configs) {
    let hasApiKey = false;
    if (supported) {
      try {
        const value = await providerCredentialStore.load(config.id);
        hasApiKey = typeof value === 'string' && value.length > 0;
      } catch {
        // 单个 Provider 的 Key 读不出来时不能谎报"已保存"，单独计数交由页面提示。
        keyReadErrors += 1;
      }
    }
    if (hasApiKey) withApiKey += 1;
    items.push({ id: config.id, name: config.name, baseUrl: config.baseUrl, hasApiKey });
  }

  return { total: configs.length, withApiKey, supported, error: false, keyReadErrors, items };
};

const readShiyan = async (): Promise<SecurityShiyanStatus> => {
  const base: SecurityShiyanStatus = {
    available: false,
    supported: true,
    error: false,
    baseUrl: null,
    defaultBaseUrl: SHIYAN_API_BASE_URL,
  };
  try {
    const config = await loadShiyanRuntimeConfig();
    if (!config) return base;
    return { ...base, available: true, baseUrl: config.baseUrl };
  } catch {
    return { ...base, error: true };
  }
};

export async function loadSecurityStatus(): Promise<SecurityStatus> {
  const [remoteHost, desktopHost, providers, shiyan] = await Promise.all([
    readRemoteHost(),
    readDesktopHost(),
    readProviders(),
    readShiyan(),
  ]);
  const hasError =
    remoteHost.error ||
    desktopHost.error ||
    providers.error ||
    providers.keyReadErrors > 0 ||
    shiyan.error;
  return { remoteHost, desktopHost, providers, shiyan, hasError };
}

/**
 * 把"上次保存时间"渲染成"X 天前 / X 小时前"。失败 / 无值时返回 null。
 * 仅用于纯 UI 文本，不参与任何安全判断。
 */
export function formatSavedAt(savedAt: string | null, now: Date = new Date()): string | null {
  if (!savedAt) return null;
  const parsed = new Date(savedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const diffMs = now.getTime() - parsed.getTime();
  if (diffMs < 60_000) return '刚刚保存';
  if (diffMs < 60 * 60_000) {
    const minutes = Math.round(diffMs / 60_000);
    return `${minutes} 分钟前保存`;
  }
  if (diffMs < 24 * 60 * 60_000) {
    const hours = Math.round(diffMs / (60 * 60_000));
    return `${hours} 小时前保存`;
  }
  const days = Math.round(diffMs / (24 * 60 * 60_000));
  if (days < 30) return `${days} 天前保存`;
  const months = Math.round(days / 30);
  return `${months} 个月前保存`;
}
