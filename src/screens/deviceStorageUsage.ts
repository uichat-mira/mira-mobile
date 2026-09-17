// 设备存储占用统计：把当前 Mira Mobile 在客户端存储的真实占用按类目拆开。
//
// 这是一个纯函数模块，方便注入和测试；UI 层只负责读和呈现。
// 真实设备字节数通过 Native 模块拿，不在本模块伪造。

import type { LocalKeyValueStore } from '../storage/localKeyValueStore';
import {
  localCaptureRepository,
  type LocalCaptureMetadata,
} from '../shiyan/recording/localCaptureRepository';

export interface StorageCategoryBreakdown {
  /** 类目 id，对应 SettingsScreen → 存储 的展开行。 */
  id: string;
  /** UI 标题。 */
  label: string;
  /** 描述，便于用户在清理时知道会动哪些数据。 */
  description: string;
  /** 该类目在本地键值存储内的近似字节数（含 key 与 JSON 序列化后的 value）。 */
  keyValueBytes: number;
  /** 该类目在文件系统上的近似字节数（拾言录音文件等）。 */
  fileBytes: number;
}

export interface DeviceStorageUsage {
  /** 总字节数（键值存储 + 文件）。 */
  totalBytes: number;
  /** 按类目拆分。 */
  categories: StorageCategoryBreakdown[];
  /** 拾言录音元数据总条数（草稿 + 已提交，仅作为信息）。 */
  audioFileCount: number;
  /**
   * 本地仍存在可清理文件的已提交拾言录音条数；只有 size > 0 时才递增。
   * 提交但文件已不存在的记录会从分类中排除，但元数据保留（与 MOB-050 用例 5 一致）。
   */
  submittedAudioFileCount: number;
  /**
   * 是否所有 Native 模块都可用；false 时只展示键值存储占用与基于元数据的文件大小估算，
   * 并且不允许执行清理操作。
   */
  audioFilesAvailable: boolean;
}

interface KeyValueCategorySpec {
  id: string;
  label: string;
  description: string;
  /** 包含在这个类目下的 storage key（按当前实际数据面列出，未列出的 key 会落进 "other"）。 */
  keys: readonly string[];
}

/**
 * 客户端显式写入本地键值存储的 storage key 列表（与 src/storage/localKeyValueStore.ts、
 * src/shiyan/recording/localCaptureRepository.ts 等保持对齐）。
 *
 * 新增需要列在这里；不要让"看起来相关"的数据被误归类。
 */
const KEY_VALUE_CATEGORIES: readonly KeyValueCategorySpec[] = [
  {
    id: 'appearance',
    label: '外观与重点色',
    description: '主题模式、重点色、设备级外观偏好',
    keys: ['mira.mobile.theme.mode', 'mira.mobile.theme.accent'],
  },
  {
    id: 'personalization',
    label: '个性化',
    description: '风格、亲和度、自定义指令、特征等设备本地偏好',
    keys: ['mira.mobile.personalization.v1'],
  },
  {
    id: 'thread-state',
    label: '线程本地状态',
    description: '设备级线程置顶与未读进度（不会上传 Host）',
    keys: ['thread-pins-v1', 'thread-read-progress-v1'],
  },
  {
    id: 'local-provider',
    label: '本地 Provider 配置与会话',
    description: '本地 Provider 配置与设备侧会话（API Key 仍在设备安全存储中，不在此处）',
    keys: ['mira.local-provider.configs.v1', 'mira.local-provider.sessions.v1'],
  },
  {
    id: 'shiyan-drafts',
    label: '拾言草稿与提交记录',
    description: '本地未提交录音的元数据、提交指针与场景快照',
    keys: ['mira.shiyan.local-captures.v1', 'mira.shiyan.submissions.v1'],
  },
  {
    id: 'shiyan-cloud-config',
    label: '拾云端 API 地址',
    description: '拾言 Cloud 自定义 API Base URL',
    keys: ['mira.shiyan.api-base-url.v1'],
  },
];

const OTHER_CATEGORY: KeyValueCategorySpec = {
  id: 'other',
  label: '其它',
  description: '未在上方分类中列出的客户端存储键',
  keys: [],
};

/**
 * 自实现的 UTF-8 字节数计算，刻意不依赖全局 `TextEncoder` / `Buffer`，
 * 以保证在 Hermes、JSC 与 Node 测试环境下结果一致。
 */
export const utf8ByteLength = (value: string): number => {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    let codePoint = value.charCodeAt(i);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint =
          ((codePoint - 0xd800) * 0x400) + (next - 0xdc00) + 0x10000;
        i += 1;
      } else {
        codePoint = 0xfffd;
      }
    }
    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint < 0x10000) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
};

const readKeyOrNull = async (
  store: LocalKeyValueStore,
  key: string,
): Promise<string | null> => {
  // 读取失败必须向上抛：UI 层需要进入读取失败 / 重试状态，而不是把"读不到"当成"不存在"。
  const value = await store.get(key);
  return typeof value === 'string' ? value : null;
};

export interface DeviceStorageUsageOptions {
  store?: LocalKeyValueStore;
  /** 当前已知的 storage key 列表；用于识别"其它"类目。 */
  knownKeys?: readonly string[];
  /** 注入的拾言录音元数据，便于在无 Native 模块时测试。 */
  captures?: readonly LocalCaptureMetadata[];
  /**
   * 注入的文件大小（captureId → bytes）。Native 探测成功后传真实值；
   * Native 不可用时省略，让调用方在 `includeAudioFiles=false` 下走元数据估算分支。
   */
  fileSizesByCaptureId?: ReadonlyMap<string, number>;
  /** 是否启用拾言文件占用统计；native 不可用时必须传 false。 */
  includeAudioFiles: boolean;
}

export async function computeDeviceStorageUsage(
  options: DeviceStorageUsageOptions,
): Promise<DeviceStorageUsage> {
  const store = options.store;
  if (!store) {
    throw new Error('computeDeviceStorageUsage requires a LocalKeyValueStore');
  }

  const categories: StorageCategoryBreakdown[] = [];
  let totalKeyValue = 0;
  let totalFile = 0;

  for (const spec of KEY_VALUE_CATEGORIES) {
    let keyValueBytes = 0;
    for (const key of spec.keys) {
      const value = await readKeyOrNull(store, key);
      if (value == null) continue;
      keyValueBytes += utf8ByteLength(key) + utf8ByteLength(value);
    }
    totalKeyValue += keyValueBytes;
    categories.push({
      id: spec.id,
      label: spec.label,
      description: spec.description,
      keyValueBytes,
      fileBytes: 0,
    });
  }

  const knownByCategory = new Set<string>();
  for (const spec of KEY_VALUE_CATEGORIES) {
    for (const key of spec.keys) knownByCategory.add(key);
  }
  const knownKeys = options.knownKeys ?? [];
  let otherKeyValueBytes = 0;
  for (const key of knownKeys) {
    if (knownByCategory.has(key)) continue;
    const value = await readKeyOrNull(store, key);
    if (value == null) continue;
    otherKeyValueBytes += utf8ByteLength(key) + utf8ByteLength(value);
  }
  totalKeyValue += otherKeyValueBytes;
  categories.push({
    id: OTHER_CATEGORY.id,
    label: OTHER_CATEGORY.label,
    description: OTHER_CATEGORY.description,
    keyValueBytes: otherKeyValueBytes,
    fileBytes: 0,
  });

  let audioFileCount = 0;
  let submittedAudioFileCount = 0;
  let submittedAudioBytes = 0;
  let audioFilesAvailable = false;

  if (options.includeAudioFiles) {
    audioFilesAvailable = true;
    const captures = options.captures ?? (await localCaptureRepository.listAll());
    for (const capture of captures) {
      audioFileCount += 1;
      if (capture.status !== 'submitted') continue;
      // 先解析实际文件大小：0 / 缺失时不计入可清理数量与字节数，但仍保留元数据。
      const resolvedSize = options.fileSizesByCaptureId?.get(capture.id);
      const size =
        typeof resolvedSize === 'number' && resolvedSize > 0
          ? resolvedSize
          : 0;
      if (size <= 0) continue;
      submittedAudioFileCount += 1;
      submittedAudioBytes += size;
    }
    totalFile = submittedAudioBytes;
    if (submittedAudioFileCount > 0) {
      categories.push({
        id: 'shiyan-submitted-audio',
        label: '已提交拾言原始录音',
        description: '提交后保留在本地的原始录音文件；可在下方清理，云端 R2 归档不受影响',
        keyValueBytes: 0,
        fileBytes: submittedAudioBytes,
      });
    }
  }

  return {
    totalBytes: totalKeyValue + totalFile,
    categories,
    audioFileCount,
    submittedAudioFileCount,
    audioFilesAvailable,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  // 1024 B → 1 KB (显示整数)；1536 B → 1.5 KB。
  let formatted: string;
  if (unitIndex === 0) {
    formatted = Math.round(value).toString();
  } else if (value >= 100) {
    formatted = Math.round(value).toString();
  } else if (value >= 10) {
    formatted = Math.round(value).toString();
  } else if (Number.isInteger(value)) {
    formatted = value.toString();
  } else {
    formatted = value.toFixed(1);
  }
  return `${formatted} ${units[unitIndex]}`;
}