import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  AlertCircle,
  CheckCircle2,
  Cloud,
  LogIn,
  LogOut,
  RefreshCw,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}

function ActionButton({
  label,
  onPress,
  tone = 'primary',
  disabled = false,
  icon: Icon,
}: ActionButtonProps) {
  const { colors } = useTheme();
  const background =
    tone === 'primary'
      ? colors.primary
      : tone === 'destructive'
      ? colors.status.errorBg
      : colors.bg.card;
  const foreground =
    tone === 'primary'
      ? colors.onPrimary
      : tone === 'destructive'
      ? colors.status.error
      : colors.text.ink;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        {
          backgroundColor: background,
          borderColor:
            tone === 'secondary' ? colors.border.default : background,
        },
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Icon size={18} color={foreground} />
      <Text style={[styles.actionLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

const expiryLabel = (expiresAt: string | null): string | null => {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `会话有效期至 ${year}-${month}-${day}`;
};

export function CloudAccountScreen() {
  const { colors } = useTheme();
  const status = useCloudAccountStore(state => state.status);
  const account = useCloudAccountStore(state => state.account);
  const expiresAt = useCloudAccountStore(state => state.expiresAt);
  const message = useCloudAccountStore(state => state.message);
  const busy = useCloudAccountStore(state => state.busy);
  const signIn = useCloudAccountStore(state => state.signIn);
  const cancelSignIn = useCloudAccountStore(state => state.cancelSignIn);
  const signOut = useCloudAccountStore(state => state.signOut);
  const refresh = useCloudAccountStore(state => state.refresh);

  useFocusEffect(
    useCallback(() => {
      const current = useCloudAccountStore.getState();
      if (current.initialized && current.status !== 'authorizing') {
        void current.refresh();
      }
    }, []),
  );

  const requestSignOut = () => {
    Alert.alert(
      '退出 Mira Cloud？',
      '只会清除本机 Mira Cloud 登录状态，不会删除本地模型、Remote V1 配对或推送身份。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '退出',
          style: 'destructive',
          onPress: () => void signOut(),
        },
      ],
    );
  };

  const subtitle =
    status === 'signed_in'
      ? account?.username ?? '已登录'
      : status === 'authorizing'
      ? '等待浏览器完成登录'
      : status === 'cloud_unavailable'
      ? 'Cloud 暂时不可用'
      : status === 'session_rejected'
      ? '登录已失效'
      : '可选';

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="Mira Cloud" />
      <ScrollView contentContainerStyle={styles.content}>
        <View
          style={[
            styles.hero,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View
            style={[
              styles.heroIcon,
              {
                backgroundColor:
                  status === 'signed_in'
                    ? colors.status.success
                    : status === 'session_rejected'
                    ? colors.status.error
                    : colors.bg.soft,
              },
            ]}
          >
            {status === 'signed_in' ? (
              <CheckCircle2 size={26} color={colors.onPrimary} />
            ) : status === 'session_rejected' ? (
              <AlertCircle size={26} color={colors.onPrimary} />
            ) : (
              <Cloud size={26} color={colors.primary} />
            )}
          </View>
          <Text style={[styles.heroTitle, { color: colors.text.ink }]}>
            {status === 'signed_in'
              ? '已登录 Mira Cloud'
              : status === 'authorizing'
              ? '等待浏览器登录'
              : status === 'session_rejected'
              ? 'Mira Cloud 登录已失效'
              : status === 'cloud_unavailable'
              ? 'Mira Cloud 暂时不可用'
              : 'Mira Cloud 账户'}
          </Text>
          <Text style={[styles.heroSubtitle, { color: colors.text.soft }]}>
            {subtitle}
          </Text>
          {status === 'signed_in' && expiryLabel(expiresAt) ? (
            <Text style={[styles.meta, { color: colors.text.muted }]}>
              {expiryLabel(expiresAt)}
            </Text>
          ) : null}
        </View>

        {message ? (
          <View
            style={[
              styles.notice,
              {
                borderColor:
                  status === 'session_rejected'
                    ? colors.status.error
                    : colors.border.default,
                backgroundColor: colors.bg.card,
              },
            ]}
          >
            <Text style={[styles.noticeText, { color: colors.text.base }]}>
              {message}
            </Text>
          </View>
        ) : null}

        {status === 'loading' ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.muted, { color: colors.text.soft }]}>
              正在读取设备安全存储…
            </Text>
          </View>
        ) : null}

        {status === 'signed_out' || status === 'authorizing' ? (
          <View style={styles.section}>
            <Text style={[styles.description, { color: colors.text.base }]}>
              Mira Cloud 账户是可选能力。登录后可使用 Mira
              云服务；不登录也可以继续使用本地模型和 Tailscale 直连。
            </Text>
            {status === 'authorizing' ? (
              <>
                <View style={styles.busyRow}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={[styles.muted, { color: colors.text.soft }]}>
                    在系统浏览器中完成登录后返回 Mira。
                  </Text>
                </View>
                <ActionButton
                  icon={LogOut}
                  label="取消登录"
                  tone="secondary"
                  onPress={() => void cancelSignIn()}
                  disabled={busy}
                />
              </>
            ) : (
              <ActionButton
                icon={LogIn}
                label="使用浏览器登录 Mira Cloud"
                onPress={() => void signIn()}
                disabled={busy}
              />
            )}
            <Text style={[styles.footnote, { color: colors.text.soft }]}>
              登录使用 Mira Cloud 的 OAuth 授权页；Mira Mobile
              不会接触你的账户密码。
            </Text>
          </View>
        ) : null}

        {status === 'signed_in' ? (
          <View style={styles.section}>
            <Text style={[styles.description, { color: colors.text.base }]}>
              这台设备已绑定到当前 Mira Cloud
              账户。重启应用后会从系统安全存储恢复登录状态，不需要重新输入密码。
            </Text>
            <ActionButton
              icon={RefreshCw}
              label={busy ? '正在检查…' : '检查登录状态'}
              tone="secondary"
              onPress={() => void refresh()}
              disabled={busy}
            />
            <ActionButton
              icon={LogOut}
              label="退出 Mira Cloud 登录"
              tone="destructive"
              onPress={requestSignOut}
              disabled={busy}
            />
            <Text style={[styles.footnote, { color: colors.text.soft }]}>
              退出只影响 Mira Cloud 账户，不会删除 Local Provider 密钥、Remote
              V1 配对或推送身份。
            </Text>
          </View>
        ) : null}

        {status === 'cloud_unavailable' ? (
          <View style={styles.section}>
            <Text style={[styles.description, { color: colors.text.base }]}>
              无法连接 Mira Cloud。已保存的登录状态不会被清除，本地模型和
              Tailscale 直连仍然可用。
            </Text>
            <ActionButton
              icon={RefreshCw}
              label={busy ? '正在重试…' : '重试连接'}
              tone="secondary"
              onPress={() => void refresh()}
              disabled={busy}
            />
            <ActionButton
              icon={LogIn}
              label="重新登录"
              onPress={() => void signIn()}
              disabled={busy}
            />
            <ActionButton
              icon={LogOut}
              label="尝试退出 Mira Cloud 登录"
              tone="destructive"
              onPress={requestSignOut}
              disabled={busy}
            />
          </View>
        ) : null}

        {status === 'session_rejected' ? (
          <View style={styles.section}>
            <Text style={[styles.description, { color: colors.text.base }]}>
              Mira Cloud 已拒绝这台设备的登录凭据，本机保存的 Cloud
              会话已清除。请重新登录。
            </Text>
            <ActionButton
              icon={LogIn}
              label="重新登录 Mira Cloud"
              onPress={() => void signIn()}
              disabled={busy}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.section,
    gap: spacing.lg,
  },
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  heroTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: fontSize.bodyMd,
    textAlign: 'center',
  },
  meta: {
    fontSize: fontSize.caption,
  },
  notice: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  noticeText: {
    fontSize: fontSize.button,
    lineHeight: 21,
  },
  section: {
    gap: spacing.md,
  },
  description: {
    fontSize: fontSize.bodyMd,
    lineHeight: 24,
  },
  footnote: {
    fontSize: fontSize.caption,
    lineHeight: 20,
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  muted: {
    fontSize: fontSize.button,
    flex: 1,
  },
  actionButton: {
    minHeight: sizing.touchTarget,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  actionLabel: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});
