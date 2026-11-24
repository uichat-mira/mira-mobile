import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  remoteMiraHostClient,
  type PendingPairing,
} from '../api/remoteMiraHost';
import {
  REMOTE_DEVICE_SCOPES,
  type RemoteDeviceScope,
} from '../protocol/remoteHostV1';
import type { PairingDescriptorV1 } from '../protocol/remotePairingV1';

export type RemotePairingPhase =
  | 'idle'
  | 'blocked'
  | 'claiming'
  | 'waiting_approval'
  | 'paired'
  | 'rejected'
  | 'expired'
  | 'error';

export interface RemotePairingViewState {
  phase: RemotePairingPhase;
  pending: PendingPairing | null;
  deviceId: string | null;
  scopes: RemoteDeviceScope[];
  message: string | null;
}

const INITIAL_STATE: RemotePairingViewState = {
  phase: 'idle',
  pending: null,
  deviceId: null,
  scopes: [],
  message: null,
};

const POLL_INTERVAL_MS = 1_500;

const pairingStartErrorMessage = (error: unknown): string => {
  if (error instanceof Error && 'code' in error) {
    switch (error.code) {
      case 'PAIRING_DIRECT_HOST_REQUIRED':
        return '配对链接缺少 Tailscale Direct 地址，请在 Mira Desktop 重新生成包含直连地址的二维码。';
      case 'PAIRING_DIRECT_UNREACHABLE':
        return '无法通过 Tailscale 直连 Mira Desktop。请确认手机已加入同一 Tailscale 网络且 Mira Desktop 正在运行，然后重试。';
      case 'PAIRING_DIRECT_NOT_MIRA_HOST':
        return 'Tailscale 地址已连接，但目标不是 Mira Desktop。请在桌面端重新生成正确的配对二维码。';
      default:
        break;
    }
  }
  return error instanceof Error ? error.message : '提交配对申请失败';
};

export const useRemotePairing = (descriptor: PairingDescriptorV1 | null) => {
  const [state, setState] = useState<RemotePairingViewState>(INITIAL_STATE);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollingGeneration = useRef(0);

  const stopPolling = useCallback(() => {
    pollingGeneration.current += 1;
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    setState(INITIAL_STATE);
  }, [stopPolling]);

  useEffect(() => {
    reset();
  }, [descriptor?.challengeId, descriptor?.hostUrl, reset]);

  useEffect(() => stopPolling, [stopPolling]);

  const beginPolling = useCallback(
    (pending: PendingPairing) => {
      const generation = ++pollingGeneration.current;

      const pollOnce = async () => {
        if (generation !== pollingGeneration.current) return;

        try {
          const result = await remoteMiraHostClient.pollPairing(pending);
          if (generation !== pollingGeneration.current) return;

          if (result.credential && result.deviceId) {
            stopPolling();
            setState({
              phase: 'paired',
              pending,
              deviceId: result.deviceId,
              scopes: result.scopes,
              message: '桌面已批准，设备凭证已安全保存。',
            });
            return;
          }

          if (result.status === 'rejected') {
            stopPolling();
            setState({
              phase: 'rejected',
              pending,
              deviceId: null,
              scopes: [],
              message: '桌面已拒绝此设备请求。',
            });
            return;
          }

          if (result.status === 'expired') {
            stopPolling();
            setState({
              phase: 'expired',
              pending,
              deviceId: null,
              scopes: [],
              message: '一次性配对请求已过期，请在桌面重新生成。',
            });
            return;
          }

          if (result.status === 'delivered') {
            stopPolling();
            setState({
              phase: 'error',
              pending,
              deviceId: result.deviceId,
              scopes: result.scopes,
              message: '设备凭证已被领取，但本机没有完成保存，请重新配对。',
            });
            return;
          }

          setState(current => ({
            ...current,
            phase: 'waiting_approval',
            pending,
            message: '已通过 Tailscale 直连提交设备申请，等待桌面确认。',
          }));
          pollTimer.current = setTimeout(pollOnce, POLL_INTERVAL_MS);
        } catch (error) {
          if (generation !== pollingGeneration.current) return;
          stopPolling();
          setState({
            phase: 'error',
            pending,
            deviceId: null,
            scopes: [],
            message:
              error instanceof Error ? error.message : '配对状态检查失败',
          });
        }
      };

      void pollOnce();
    },
    [stopPolling],
  );

  const start = useCallback(async () => {
    if (!descriptor) {
      setState({
        ...INITIAL_STATE,
        phase: 'blocked',
        message: '请先从桌面打开有效的 Mira 配对链接。',
      });
      return;
    }
    if (!remoteMiraHostClient.isSecureStorageAvailable()) {
      setState({
        ...INITIAL_STATE,
        phase: 'blocked',
        message: '当前构建没有可用的系统安全存储，未领取一次性凭证。',
      });
      return;
    }

    if (state.pending) {
      setState(current => ({
        ...current,
        phase: 'waiting_approval',
        message: '正在重新检查桌面确认状态。',
      }));
      beginPolling(state.pending);
      return;
    }

    stopPolling();
    const generation = pollingGeneration.current;
    setState({
      ...INITIAL_STATE,
      phase: 'claiming',
      message: '正在通过 Tailscale 直连桌面并提交设备申请。',
    });

    try {
      const claim = await remoteMiraHostClient.claimPairing(descriptor, {
        name: `Mira Mobile (${Platform.OS})`,
        platform: Platform.OS,
        requestedScopes: [...REMOTE_DEVICE_SCOPES],
      });
      if (generation !== pollingGeneration.current) return;

      const pending: PendingPairing = {
        descriptor,
        transport: claim.transport,
        claimId: claim.claimId,
        pollToken: claim.pollToken,
        expiresAt: claim.expiresAt,
      };
      setState({
        phase: 'waiting_approval',
        pending,
        deviceId: null,
        scopes: [],
        message: '已通过 Tailscale 直连提交设备申请，等待桌面确认。',
      });
      beginPolling(pending);
    } catch (error) {
      if (generation !== pollingGeneration.current) return;
      if (error instanceof Error && 'code' in error && error.code === 'PAIRING_CLAIM_UNCERTAIN') {
        setState({
          ...INITIAL_STATE,
          phase: 'error',
          message: '设备申请状态不确定，请回到 Mira Desktop 确认是否已收到申请；不要通过另一条通道重新提交。',
        });
        return;
      }
      setState({
        ...INITIAL_STATE,
        phase: 'error',
        message: pairingStartErrorMessage(error),
      });
    }
  }, [beginPolling, descriptor, state.pending, stopPolling]);

  return {
    state,
    start,
    reset,
    stopPolling,
    secureStorageAvailable: remoteMiraHostClient.isSecureStorageAvailable(),
  };
};
