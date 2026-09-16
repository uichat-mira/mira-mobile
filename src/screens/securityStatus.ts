import { deviceCredentialStore } from '../security/deviceCredentialStore';
import { desktopCredentialStore } from '../security/desktopCredentialStore';
import { providerCredentialStore } from '../security/providerCredentialStore';
import {
  loadShiyanRuntimeConfig,
  SHIYAN_API_BASE_URL,
} from '../shiyan/client/runtimeConfig';

/**
 * 只读安全状态聚合：让"设置 → 安全"页在不暴露凭据的前提下展示设备本地
 * 各类安全凭据的"是否存在 / 是否可用 / 指向什么"三类信号。页面只在聚合
 * 层调用，绝不把 Token、API Key、设备 secret 渲染到 UI。
 *
 * 设计取舍：
 * - Provider 是聚合对象，按当前 Local Provider 配置计算；新增 Provider
 *   不改变字段名。
 * - "指向什么"只展示 hostUrl / baseUrl，不展示任何凭据本身。
 * - 不读取 hostStore / runtimeRegistry 等运行时连接状态：连接是否成功是
 *   「连接」段职责，「安全」段只关心凭据本身是否安全保存。
 */

export interface SecurityDeviceCredentialStatus {
  available: boolean;
  hostUrl: string | null;
  savedAt: string | null;
}

export interface SecurityDesktopCredentialStatus {
  available: boolean;
  hostUrl: string | null;
  username: string | null;
  savedAt: string | null;
}

export interface SecurityProviderStatus {
  total: number;
  withApiKey: number;
  items: Array<{ id: string; name: string; baseUrl: string; hasApiKey: boolean }>;
}

export interface SecurityShiyanStatus {
  available: boolean;
  baseUrl: string | null;
  defaultBaseUrl: string;
}

export interface SecurityStatus {
  remoteHost: SecurityDeviceCredentialStatus;
  desktopHost: SecurityDesktopCredentialStatus;
  providers: SecurityProviderStatus;
  shiyan: SecurityShiyanStatus;
}

const readRemoteHost = async (): Promise<SecurityDeviceCredentialStatus> => {
  if (!deviceCredentialStore.isAvailable()) {
    return { available: false, hostUrl: null, savedAt: null };
  }
  try {
    const stored = await deviceCredentialStore.load();
    if (!stored) return { available: false, hostUrl: null, savedAt: null };
    return {
      available: true,
      hostUrl: stored.hostUrl,
      savedAt: stored.savedAt,
    };
  } catch {
    // Native 安全存储损坏或反序列化失败：UI 必须显示"异常"而不是"未保存"。
    // 让页面层负责展示具体含义；本聚合层只声明"凭据不可信"。
    return { available: false, hostUrl: null, savedAt: null };
  }
};

const readDesktopHost = async (): Promise<SecurityDesktopCredentialStatus> => {
  if (!desktopCredentialStore.isAvailable()) {
    return { available: false, hostUrl: null, username: null, savedAt: null };
  }
  try {
    const stored = await desktopCredentialStore.load();
    if (!stored) return { available: false, hostUrl: null, username: null, savedAt: null };
    return {
      available: true,
      hostUrl: stored.hostUrl,
      username: stored.username,
      savedAt: stored.savedAt,
    };
  } catch {
    return { available: false, hostUrl: null, username: null, savedAt: null };
  }
};

const readProviders = async (): Promise<SecurityProviderStatus> => {
  // 动态 require 避免循环依赖（ProviderConfigStore 链最终回到 security/）。
  const { ProviderConfigStore } = await import('../provider/providerConfigStore');
  let configs: ReadonlyArray<{ id: string; name: string; baseUrl: string }>;
  try {
    configs = await new ProviderConfigStore().load();
  } catch {
    return { total: 0, withApiKey: 0, items: [] };
  }

  const items: SecurityProviderStatus['items'] = [];
  let withApiKey = 0;
  for (const config of configs) {
    let hasApiKey = false;
    if (providerCredentialStore.isAvailable()) {
      try {
        const value = await providerCredentialStore.load(config.id);
        hasApiKey = typeof value === 'string' && value.length > 0;
      } catch {
        hasApiKey = false;
      }
    }
    if (hasApiKey) withApiKey += 1;
    items.push({ id: config.id, name: config.name, baseUrl: config.baseUrl, hasApiKey });
  }

  return { total: configs.length, withApiKey, items };
};

const readShiyan = async (): Promise<SecurityShiyanStatus> => {
  try {
    const config = await loadShiyanRuntimeConfig();
    if (!config) {
      return { available: false, baseUrl: null, defaultBaseUrl: SHIYAN_API_BASE_URL };
    }
    return { available: true, baseUrl: config.baseUrl, defaultBaseUrl: SHIYAN_API_BASE_URL };
  } catch {
    return { available: false, baseUrl: null, defaultBaseUrl: SHIYAN_API_BASE_URL };
  }
};

export async function loadSecurityStatus(): Promise<SecurityStatus> {
  const [remoteHost, desktopHost, providers, shiyan] = await Promise.all([
    readRemoteHost(),
    readDesktopHost(),
    readProviders(),
    readShiyan(),
  ]);
  return { remoteHost, desktopHost, providers, shiyan };
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