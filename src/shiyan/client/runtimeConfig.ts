import { NativeModules } from 'react-native';
import { localKeyValueStore } from '../../storage/localKeyValueStore';

const API_BASE_URL_KEY = 'mira.shiyan.api-base-url.v1';
const CREDENTIAL_SERVICE = 'io.tomz.mira.mobile.shiyan-device';

export const SHIYAN_API_BASE_URL = 'https://shiyan-api.tomz.io';

const LEGACY_SHIYAN_API_BASE_URLS = new Set([
  'https://mira-shiyan-api.dangjingtao.workers.dev',
]);

interface NativeSecureCredentialModule {
  get(service: string): Promise<string | null>;
  set(service: string, value: string): Promise<void>;
  remove(service: string): Promise<void>;
}

export interface ShiyanRuntimeConfig {
  baseUrl: string;
  credential: string;
}

const secureModule = (): NativeSecureCredentialModule | null => {
  const module = NativeModules.MiraSecureCredentialStore as
    | NativeSecureCredentialModule
    | undefined;
  if (
    !module ||
    typeof module.get !== 'function' ||
    typeof module.set !== 'function' ||
    typeof module.remove !== 'function'
  ) {
    return null;
  }
  return module;
};

const normalizeBaseUrl = (value: string) => {
  const trimmed = value.trim().replace(/\/+$/u, '');
  if (!/^https:\/\//iu.test(trimmed)) {
    throw new Error('拾言 Cloud 地址必须使用 HTTPS。');
  }
  if (LEGACY_SHIYAN_API_BASE_URLS.has(trimmed.toLowerCase())) {
    return SHIYAN_API_BASE_URL;
  }
  return trimmed;
};

export async function loadShiyanRuntimeConfig(): Promise<ShiyanRuntimeConfig | null> {
  const module = secureModule();
  if (!module) return null;
  const [storedBaseUrl, credential] = await Promise.all([
    localKeyValueStore.get(API_BASE_URL_KEY),
    module.get(CREDENTIAL_SERVICE),
  ]);
  if (!storedBaseUrl || !credential) return null;
  const baseUrl = normalizeBaseUrl(storedBaseUrl);
  if (baseUrl !== storedBaseUrl) {
    await localKeyValueStore.set(API_BASE_URL_KEY, baseUrl);
  }
  return { baseUrl, credential };
}

export async function saveShiyanRuntimeConfig(config: ShiyanRuntimeConfig): Promise<void> {
  const module = secureModule();
  if (!module) {
    throw new Error('当前构建未提供安全凭证存储，不能保存拾言设备凭证。');
  }
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const credential = config.credential.trim();
  if (!credential) throw new Error('拾言设备凭证不能为空。');
  await Promise.all([
    localKeyValueStore.set(API_BASE_URL_KEY, baseUrl),
    module.set(CREDENTIAL_SERVICE, credential),
  ]);
}

export async function clearShiyanRuntimeConfig(): Promise<void> {
  const module = secureModule();
  await Promise.all([
    localKeyValueStore.remove(API_BASE_URL_KEY),
    module ? module.remove(CREDENTIAL_SERVICE) : Promise.resolve(),
  ]);
}
