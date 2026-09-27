import { RemoteHostError } from '../api/remoteHttp';
import {
  getCurrentSystemNetworkState,
  type SystemNetworkState,
} from './systemNetworkMonitor';

export type RemoteConnectionDiagnosticKind =
  | 'unpaired'
  | 'mobile_offline'
  | 'credential_invalid'
  | 'permission_denied'
  | 'host_offline'
  | 'host_unreachable'
  | 'session_service_error';

export type RemoteConnectionDiagnosticAction =
  | 'retry'
  | 'connect_device'
  | 'connection_settings';

export interface RemoteConnectionDiagnostic {
  kind: RemoteConnectionDiagnosticKind;
  title: string;
  message: string;
  primaryAction: {
    kind: RemoteConnectionDiagnosticAction;
    label: string;
  };
  secondaryAction?: {
    kind: RemoteConnectionDiagnosticAction;
    label: string;
  };
  debugCode?: string;
  debugStatus?: number;
}

export interface RemoteTransportAttemptDiagnostic {
  transport: 'direct' | 'relay';
  code: string;
  status?: number;
  hostResponded: boolean;
  authoritativeHostOffline: boolean;
}

interface RemoteFailureDetails {
  transportAttempts?: RemoteTransportAttemptDiagnostic[];
}

interface DiagnosticEnvironment {
  getNetworkState?: () => Promise<SystemNetworkState | null>;
}

const transportFailureCodes = new Set([
  'NETWORK_ERROR',
  'REMOTE_ENDPOINT_UNAVAILABLE',
  'DIRECT_ENDPOINT_UNAVAILABLE',
  'RELAY_ENDPOINT_UNAVAILABLE',
]);

const transportAttemptsFrom = (
  error: RemoteHostError,
): RemoteTransportAttemptDiagnostic[] => {
  const details = error.details as RemoteFailureDetails | undefined;
  if (!Array.isArray(details?.transportAttempts)) return [];
  return details.transportAttempts.filter(
    attempt =>
      attempt != null &&
      (attempt.transport === 'direct' || attempt.transport === 'relay') &&
      typeof attempt.code === 'string' &&
      typeof attempt.hostResponded === 'boolean' &&
      typeof attempt.authoritativeHostOffline === 'boolean',
  );
};

const hasAuthoritativeHostOfflineEvidence = (error: RemoteHostError) => {
  if (error.code === 'RELAY_HOST_OFFLINE') return true;
  const attempts = transportAttemptsFrom(error);
  return (
    attempts.some(attempt => attempt.authoritativeHostOffline) &&
    !attempts.some(attempt => attempt.hostResponded)
  );
};

const isTransportFailure = (error: RemoteHostError) =>
  transportFailureCodes.has(error.code) || error.code.startsWith('RELAY_');

const createDiagnostic = (
  input: Omit<RemoteConnectionDiagnostic, 'debugCode' | 'debugStatus'>,
  error: RemoteHostError | null,
): RemoteConnectionDiagnostic => ({
  ...input,
  ...(error ? { debugCode: error.code } : {}),
  ...(error?.status === undefined ? {} : { debugStatus: error.status }),
});

export const classifySessionLoadFailure = async (
  error: unknown,
  environment: DiagnosticEnvironment = {},
): Promise<RemoteConnectionDiagnostic> => {
  const remoteError = error instanceof RemoteHostError ? error : null;

  if (remoteError?.code === 'PAIRING_REQUIRED') {
    return createDiagnostic(
      {
        kind: 'unpaired',
        title: '尚未连接 Mira Desktop',
        message: '连接桌面端后即可读取会话。',
        primaryAction: { kind: 'connect_device', label: '连接设备' },
      },
      remoteError,
    );
  }

  if (remoteError?.status === 401) {
    return createDiagnostic(
      {
        kind: 'credential_invalid',
        title: '设备连接已失效',
        message: '当前设备授权已过期、撤销或失效，请重新连接。',
        primaryAction: { kind: 'connect_device', label: '重新连接' },
      },
      remoteError,
    );
  }

  if (remoteError?.status === 403) {
    return createDiagnostic(
      {
        kind: 'permission_denied',
        title: '当前设备无权读取会话',
        message: '当前设备授权范围不足，请检查桌面端授予的 Remote 权限。',
        primaryAction: {
          kind: 'connection_settings',
          label: '查看连接设置',
        },
      },
      remoteError,
    );
  }

  if (remoteError && hasAuthoritativeHostOfflineEvidence(remoteError)) {
    return createDiagnostic(
      {
        kind: 'host_offline',
        title: 'Mira Desktop 当前离线',
        message: 'Relay 已确认当前 Host 不在线。启动 Mira Desktop 后重试。',
        primaryAction: { kind: 'retry', label: '重试' },
      },
      remoteError,
    );
  }

  if (remoteError && isTransportFailure(remoteError)) {
    const getNetworkState =
      environment.getNetworkState ?? getCurrentSystemNetworkState;
    const networkState = await getNetworkState().catch(() => null);

    if (networkState?.connected === false) {
      return createDiagnostic(
        {
          kind: 'mobile_offline',
          title: '手机当前未连接网络',
          message: '检查手机网络连接后再重试。',
          primaryAction: { kind: 'retry', label: '重试' },
        },
        remoteError,
      );
    }

    return createDiagnostic(
      {
        kind: 'host_unreachable',
        title: '暂时无法连接 Mira Desktop',
        message: '已配对，但当前没有足够证据判断 Desktop 离线。',
        primaryAction: { kind: 'retry', label: '重试' },
        secondaryAction: {
          kind: 'connection_settings',
          label: '连接设置',
        },
      },
      remoteError,
    );
  }

  return createDiagnostic(
    {
      kind: 'session_service_error',
      title: '会话加载失败',
      message: '已连接到服务，但会话数据暂时无法正确读取。',
      primaryAction: { kind: 'retry', label: '重试' },
    },
    remoteError,
  );
};
