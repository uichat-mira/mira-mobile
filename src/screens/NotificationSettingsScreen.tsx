import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Bell, BellRing, Settings2 } from 'lucide-react-native';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import {
  SettingsGroup,
  SettingsRow,
  SettingsSectionHeader,
} from '../settings/SettingsComponents';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, spacing } from '../theme/tokens';
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

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await getNotificationPermissionStatus());
    } catch {
      setStatus('unavailable');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus]),
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
      } else if (actionId === 'system-settings') {
        void openSystemSettings();
      }
    },
    [openSystemSettings, requestPermission, sendTest],
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
          Mira 只在你主动允许后发送系统通知。当前基础能力不包含 AI / Agent 回复完成提醒。
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
