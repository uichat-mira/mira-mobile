import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Bell, BellRing, MessageCircleMore, RefreshCcw, Settings2 } from 'lucide-react-native';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSectionHeader,
} from '../settings/SettingsComponents';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, spacing } from '../theme/tokens';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import {
  pushBindingService,
  type PushBindingRuntimeStatus,
} from '../push/pushBindingService';
import {
  getNotificationPermissionStatus,
  openNotificationSettings,
  requestNotificationPermission,
  showTestNotification,
  type NotificationPermissionStatus,
} from '../settings/notificationSettings';

const statusLabel = (status: NotificationPermissionStatus | 'loading') => {
  switch (status) {
    case 'granted':
      return '已允许';
    case 'denied':
      return '未允许';
    case 'not-determined':
      return '尚未授权';
    case 'unavailable':
      return '当前设备不可用';
    default:
      return '正在读取…';
  }
};

export function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const [status, setStatus] = useState<NotificationPermissionStatus | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [pushRuntime, setPushRuntime] = useState<PushBindingRuntimeStatus>({
    binding: null,
    lastRefreshError: null,
  });

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getNotificationPermissionStatus());
    } catch {
      setStatus('unavailable');
    }
  }, []);

  const refreshPushRuntime = useCallback(async () => {
    try {
      setPushRuntime(await pushBindingService.getRuntimeStatus());
    } catch {
      setPushRuntime({
        binding: null,
        lastRefreshError: '无法读取后台回复提醒授权状态',
      });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
      void refreshPushRuntime();
    }, [refreshPushRuntime, refreshStatus]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        void refreshStatus();
      }
    });
    return () => subscription.remove();
  }, [refreshStatus]);

  const requestPermission = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setTestResult(null);
    try {
      const next = await requestNotificationPermission();
      setStatus(next);
      if (next !== 'granted') {
        Alert.alert(
          '通知未开启',
          'Mira 没有获得系统通知权限。你可以稍后重试，或前往系统通知设置手动开启。',
          [
            { text: '取消', style: 'cancel' },
            {
              text: '系统设置',
              onPress: () => {
                void openNotificationSettings().catch(() => {
                  Alert.alert(
                    '无法打开通知设置',
                    '请在系统「设置 → 应用 → Mira → 通知」中手动管理。',
                  );
                });
              },
            },
          ],
        );
      }
    } catch {
      Alert.alert('无法请求通知权限', '请稍后重试，或前往系统通知设置手动开启。');
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [busy, refreshStatus]);

  const sendTest = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setTestResult(null);
    try {
      let current = status;
      if (current !== 'granted') {
        current = await requestNotificationPermission();
        setStatus(current);
      }
      if (current !== 'granted') {
        Alert.alert('通知未开启', '先允许 Mira 发送通知，再测试系统通知。');
        return;
      }
      await showTestNotification();
      setTestResult('测试通知已发送。收到后点它应回到 Mira。');
    } catch {
      Alert.alert('测试通知发送失败', '请检查系统通知权限和 Mira 的通知设置后重试。');
      await refreshStatus();
    } finally {
      setBusy(false);
    }
  }, [busy, refreshStatus, status]);

  const approveRemoteReplies = useCallback(
    async (sourceScope: string[]) => {
      setBusy(true);
      setTestResult(null);
      try {
        let current = status;
        if (current !== 'granted') {
          current = await requestNotificationPermission();
          setStatus(current);
        }
        if (current !== 'granted') {
          Alert.alert(
            '通知未开启',
            '先允许 Mira 发送系统通知，再启用远程回复完成提醒。',
          );
          return;
        }

        await pushBindingService.enableForSourceScope(sourceScope);
        await refreshPushRuntime();
        Alert.alert(
          '后台回复提醒已授权',
          '当前已配对 Host 只能为你刚刚批准的这些会话发送无正文的完成提醒。新增会话不会自动加入。',
        );
      } catch (error) {
        Alert.alert(
          '后台回复提醒授权失败',
          error instanceof Error
            ? error.message
            : '请检查 Mira Desktop、Broker 和系统通知能力后重试。',
        );
        await refreshPushRuntime();
      } finally {
        setBusy(false);
      }
    },
    [refreshPushRuntime, status],
  );

  const handleRemoteReplies = useCallback(async () => {
    if (busy) return;

    const currentBinding = pushRuntime.binding;
    if (currentBinding) {
      Alert.alert(
        currentBinding.status === 'active'
          ? '后台回复提醒'
          : '后台回复授权未完成',
        currentBinding.status === 'active'
          ? `当前已允许这个 Host 为 ${currentBinding.sourceScope.length} 个会话发送完成提醒。新增会话不会自动加入。`
          : 'Broker 已产生授权，但 capability handoff 没有完整收口。请先撤销这次授权，再重新启用。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '关闭提醒',
            style: 'destructive',
            onPress: () => {
              setBusy(true);
              void pushBindingService
                .revokeCurrentBinding()
                .then(refreshPushRuntime)
                .catch((error: unknown) => {
                  Alert.alert(
                    '无法撤销后台回复授权',
                    error instanceof Error
                      ? error.message
                      : 'Broker 当前不可用。为避免留下未撤销授权，本机不会假装关闭成功。',
                  );
                })
                .finally(() => setBusy(false));
            },
          },
        ],
      );
      return;
    }

    setBusy(true);
    try {
      const threads = await remoteMiraHostClient.listThreads();
      const sourceScope = threads.map(thread => thread.id);
      if (sourceScope.length === 0) {
        Alert.alert(
          '没有可授权的远程会话',
          '当前已配对 Host 没有活动会话。创建会话后再回来启用。',
        );
        return;
      }

      Alert.alert(
        '允许后台回复完成提醒？',
        `Mira 将允许当前已配对 Host 为现在这 ${sourceScope.length} 个活动会话发送“回复完成”提醒。Push 不包含消息正文；新增会话不会自动加入，之后需要重新授权。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '允许',
            onPress: () => {
              void approveRemoteReplies(sourceScope);
            },
          },
        ],
      );
    } catch (error) {
      Alert.alert(
        '无法读取远程会话',
        error instanceof Error
          ? error.message
          : '请确认手机仍与 Mira Desktop 配对并可连接。',
      );
    } finally {
      setBusy(false);
    }
  }, [approveRemoteReplies, busy, pushRuntime.binding, refreshPushRuntime]);

  const resetPushInstallation = useCallback(() => {
    if (busy) return;
    Alert.alert(
      '重置后台提醒身份？',
      '这会先撤销当前 Push Broker installation（包括现有 Host binding），再轮换本机 installation identity。完成后需要重新授权后台回复提醒。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '重置',
          style: 'destructive',
          onPress: () => {
            setBusy(true);
            void pushBindingService
              .resetInstallation()
              .then(async () => {
                await refreshPushRuntime();
                Alert.alert(
                  '已重置后台提醒身份',
                  '旧 Broker installation 已撤销。下次启用后台回复提醒时会使用新的 installation identity。',
                );
              })
              .catch((error: unknown) => {
                Alert.alert(
                  '无法安全重置',
                  error instanceof Error
                    ? error.message
                    : 'Broker 撤销未确认，本机会保留旧身份和状态以便稍后重试。',
                );
              })
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [busy, refreshPushRuntime]);

  const openSystemSettings = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setTestResult(null);
    try {
      await openNotificationSettings();
    } catch {
      Alert.alert(
        '无法打开通知设置',
        '请在系统「设置 → 应用 → Mira → 通知」中手动管理。',
      );
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleAction = useCallback(
    (actionId: string) => {
      if (actionId === 'permission') {
        void requestPermission();
      } else if (actionId === 'test-notification') {
        void sendTest();
      } else if (actionId === 'remote-replies') {
        void handleRemoteReplies();
      } else if (actionId === 'reset-push-installation') {
        resetPushInstallation();
      } else if (actionId === 'system-settings') {
        void openSystemSettings();
      }
    },
    [
      handleRemoteReplies,
      openSystemSettings,
      requestPermission,
      resetPushInstallation,
      sendTest,
    ],
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="通知" />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSectionHeader>权限</SettingsSectionHeader>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow
            icon={Bell}
            title="通知权限"
            subtitle={statusLabel(status)}
            actionId="permission"
            isFirst
            isLast
          />
        </SettingsGroup>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          Mira 只在你主动允许后发送系统通知。系统权限与远程 Host 的后台投递授权彼此独立。
        </Text>

        <SettingsSectionHeader>远程回复</SettingsSectionHeader>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow
            icon={MessageCircleMore}
            title="后台回复完成提醒"
            subtitle={
              pushRuntime.binding
                ? pushRuntime.binding.status === 'active'
                  ? `已允许 · ${pushRuntime.binding.sourceScope.length} 个当前会话`
                  : '授权未完成 · 点击撤销'
                : pushRuntime.lastRefreshError
                  ? '未启用 · 状态读取失败'
                  : '未启用 · 不包含消息正文'
            }
            actionId="remote-replies"
            isFirst
            isLast={false}
          />
          <SettingsRow
            icon={RefreshCcw}
            title="重置后台提醒身份"
            subtitle="撤销旧 Broker installation，并轮换本机 installation identity"
            actionId={busy ? undefined : 'reset-push-installation'}
            isLast
          />
        </SettingsGroup>
        <Text style={[styles.help, { color: colors.text.muted }]}>
          启用时会明确批准当前活动会话列表；新增会话不会自动获得 Push 权限。本卡只建立注册与授权，收到 Push 后的系统通知呈现仍由后续接收链路负责。
        </Text>

        <SettingsSectionHeader>测试</SettingsSectionHeader>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow
            icon={BellRing}
            title="发送测试通知"
            subtitle={busy ? '处理中…' : '验证系统通知是否可用'}
            actionId="test-notification"
            isFirst
            isLast
          />
        </SettingsGroup>
        {testResult ? (
          <Text style={[styles.help, { color: colors.text.soft }]}>{testResult}</Text>
        ) : null}

        <SettingsSectionHeader>系统</SettingsSectionHeader>
        <SettingsGroup onAction={handleAction}>
          <SettingsRow
            icon={Settings2}
            title="系统通知设置"
            subtitle="声音 · 振动 · 锁屏 · 通知类别"
            actionId="system-settings"
            isFirst
            isLast
          />
        </SettingsGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.section },
  help: {
    fontSize: fontSize.button,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
});
