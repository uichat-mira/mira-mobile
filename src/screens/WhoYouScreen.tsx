import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  AlertCircle,
  Cloud,
  ExternalLink,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { CloudActionButton, cloudLayout } from './CloudAccountUi';
import { resolveWhoYouWebMailboxesUrl } from '../whoYou/whoYouConfig';
import {
  useWhoYouStore,
  type WhoYouStatus,
} from '../whoYou/whoYouStore';
import type {
  WhoYouCredentialStatus,
  WhoYouMailbox,
} from '../whoYou/whoYouMcpClient';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
type StatusTone = 'success' | 'warning' | 'error' | 'neutral';

const statusCopy: Record<WhoYouStatus, string> = {
  idle: '准备读取狐邮只读邮箱。',
  loading: '正在获取狐邮只读授权…',
  ready: '以下邮箱来自狐邮当前账号的真实返回。',
  empty: '狐邮只读授权正常，但当前账号没有返回任何邮箱。',
  signed_out: '请先在 Mira Cloud 完成登录，再打开狐邮。',
  session_rejected: 'Mira Cloud 登录已失效，请重新登录。',
  unavailable: '狐邮暂时不可用，请稍后重试。',
  error: '无法读取狐邮邮箱，请稍后重试。',
};

const providerLabel = (mailbox: WhoYouMailbox): string => {
  switch (mailbox.provider) {
    case 'gmail':
      return 'Gmail';
    case 'microsoft':
      return 'Microsoft';
    case 'imap_smtp':
      return 'IMAP / SMTP';
    default:
      return 'Mira 自有域邮箱';
  }
};

const kindLabel = (mailbox: WhoYouMailbox): string =>
  mailbox.kind === 'own_domain' ? '自有域' : '第三方绑定';

const credentialLabel = (
  mailbox: WhoYouMailbox,
): { label: string; tone: StatusTone } => {
  if (mailbox.kind === 'own_domain') {
    return { label: '授权：自有域', tone: 'neutral' };
  }
  const status: WhoYouCredentialStatus | null = mailbox.credentialStatus;
  switch (status) {
    case 'active':
      return { label: '授权：已授权', tone: 'success' };
    case 'reauth_required':
      return { label: '授权：需重新授权', tone: 'warning' };
    case 'unreadable':
      return { label: '授权：凭据不可读', tone: 'error' };
    case 'revoked':
      return { label: '授权：已撤销', tone: 'error' };
    default:
      return { label: '授权：未提供状态', tone: 'neutral' };
  }
};

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: StatusTone;
}) {
  const { colors } = useTheme();
  const toneColor =
    tone === 'success'
      ? colors.status.success
      : tone === 'warning'
        ? colors.status.warning
        : tone === 'error'
          ? colors.status.error
          : colors.text.muted;
  return (
    <View style={[styles.chip, { borderColor: colors.border.default }]}>
      <View style={[styles.chipDot, { backgroundColor: toneColor }]} />
      <Text style={[styles.chipText, { color: colors.text.base }]}>{label}</Text>
    </View>
  );
}

function MailboxCard({ mailbox }: { mailbox: WhoYouMailbox }) {
  const { colors } = useTheme();
  const credential = credentialLabel(mailbox);
  return (
    <View
      style={[
        styles.mailboxCard,
        { backgroundColor: colors.bg.card, borderColor: colors.border.default },
      ]}
    >
      <View style={styles.mailboxHeader}>
        <View style={[styles.mailboxIcon, { backgroundColor: colors.bg.soft }]}>
          <Mail size={20} color={colors.primary} />
        </View>
        <View style={styles.mailboxTitleWrap}>
          <Text
            style={[styles.mailboxAddress, { color: colors.text.ink }]}
            numberOfLines={1}
          >
            {mailbox.address}
          </Text>
          <Text style={[styles.mailboxMeta, { color: colors.text.muted }]}>
            {providerLabel(mailbox)} · {kindLabel(mailbox)}
          </Text>
        </View>
      </View>
      <View style={styles.chipRow}>
        <StatusChip label={credential.label} tone={credential.tone} />
        <StatusChip
          label={`同步：服务端 ${mailbox.messageCount} 封`}
          tone="neutral"
        />
        {mailbox.status === 'disabled' ? (
          <StatusChip label="邮箱：已停用" tone="error" />
        ) : null}
      </View>
    </View>
  );
}

export function WhoYouScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const status = useWhoYouStore(state => state.status);
  const identity = useWhoYouStore(state => state.identity);
  const mailboxes = useWhoYouStore(state => state.mailboxes);
  const message = useWhoYouStore(state => state.message);
  const refresh = useWhoYouStore(state => state.refresh);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const openManagement = useCallback(() => {
    Linking.openURL(resolveWhoYouWebMailboxesUrl()).catch(() => {
      Alert.alert('无法打开狐邮', '请稍后重试，或检查系统浏览器设置。');
    });
  }, []);

  const showSignIn = status === 'signed_out' || status === 'session_rejected';
  const showMailboxes = status === 'ready' || status === 'empty';

  return (
    <SafeAreaView
      style={[cloudLayout.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="狐邮 Who You" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View
          style={[
            styles.hero,
            { backgroundColor: colors.bg.card, borderColor: colors.border.default },
          ]}
        >
          <View style={styles.heroTitleRow}>
            <Mail size={24} color={colors.primary} />
            <Text style={[styles.heroTitle, { color: colors.text.ink }]}>
              狐邮只读邮箱
            </Text>
          </View>
          <Text style={[styles.heroText, { color: colors.text.muted }]}>
            直接使用当前 Mira Cloud 账号连接狐邮，不依赖 Desktop 或 Relay。
          </Text>
          <View style={[styles.readOnlyNotice, { backgroundColor: colors.bg.soft }]}>
            <ShieldCheck size={16} color={colors.status.success} />
            <Text style={[styles.readOnlyText, { color: colors.text.base }]}>
              仅请求 whoyou.read 短期只读凭证；阅读正文需主动操作，不会发信。
            </Text>
          </View>
        </View>

        {status === 'loading' || status === 'idle' ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.stateText, { color: colors.text.muted }]}>
              {statusCopy[status]}
            </Text>
          </View>
        ) : null}

        {showSignIn ? (
          <View
            style={[
              styles.stateCard,
              { backgroundColor: colors.bg.card, borderColor: colors.border.default },
            ]}
          >
            <Cloud size={24} color={colors.text.muted} />
            <Text style={[styles.stateTitle, { color: colors.text.ink }]}>
              {status === 'session_rejected'
                ? 'Mira Cloud 登录已失效'
                : '需要先登录 Mira Cloud'}
            </Text>
            <Text style={[styles.stateText, { color: colors.text.muted }]}>
              {message ?? statusCopy[status]}
            </Text>
            <CloudActionButton
              label="前往 Mira Cloud"
              icon={Cloud}
              onPress={() => navigation.navigate('CloudAccount')}
            />
          </View>
        ) : null}

        {status === 'unavailable' || status === 'error' ? (
          <View
            style={[
              styles.stateCard,
              { backgroundColor: colors.bg.card, borderColor: colors.border.default },
            ]}
          >
            <AlertCircle size={24} color={colors.status.warning} />
            <Text style={[styles.stateTitle, { color: colors.text.ink }]}>
              {status === 'unavailable' ? '狐邮暂时不可用' : '无法读取狐邮邮箱'}
            </Text>
            <Text style={[styles.stateText, { color: colors.text.muted }]}>
              {message ?? statusCopy[status]}
            </Text>
            <CloudActionButton
              label="重试"
              icon={RefreshCw}
              onPress={() => {
                void refresh();
              }}
            />
          </View>
        ) : null}

        {showMailboxes ? (
          <>
            <View style={[styles.identityRow, { borderColor: colors.border.default }]}>
              <ShieldCheck size={18} color={colors.status.success} />
              <Text style={[styles.identityText, { color: colors.text.base }]}>
                {identity
                  ? `只读凭证已验证 · ${identity.scopes.join(', ')}`
                  : '狐邮只读授权已验证'}
              </Text>
            </View>

            {status === 'empty' ? (
              <View
                style={[
                  styles.stateCard,
                  { backgroundColor: colors.bg.card, borderColor: colors.border.default },
                ]}
              >
                <Mail size={24} color={colors.text.muted} />
                <Text style={[styles.stateTitle, { color: colors.text.ink }]}>
                  当前账号尚未绑定邮箱
                </Text>
                <Text style={[styles.stateText, { color: colors.text.muted }]}>
                  狐邮只读访问已授权，但服务端没有返回任何邮箱。可在狐邮网页中绑定或管理邮箱。
                </Text>
              </View>
            ) : (
              <View style={styles.mailboxList}>
                <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>
                  已绑定邮箱 · {mailboxes.length}
                </Text>
                {mailboxes.map(mailbox => (
                  <MailboxCard key={mailbox.mailboxId} mailbox={mailbox} />
                ))}
              </View>
            )}

            <View style={styles.actionRow}>
              <CloudActionButton
                label="刷新邮箱"
                icon={RefreshCw}
                tone="secondary"
                onPress={() => {
                  void refresh();
                }}
              />
              <CloudActionButton
                label="打开狐邮网页管理邮箱"
                icon={ExternalLink}
                onPress={openManagement}
              />
            </View>
          </>
        ) : null}

        <Text style={[styles.footerNote, { color: colors.text.soft }]}>
          Mira Mobile 展示狐邮的邮箱连接状态。邮件查询与阅读由获授权的 Agent 工具完成；邮件同步由狐邮服务端负责，授权续期和解绑在狐邮网页完成。
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  hero: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  heroText: {
    fontSize: fontSize.button,
    lineHeight: 21,
  },
  readOnlyNotice: {
    marginTop: spacing.xs,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  readOnlyText: {
    flex: 1,
    fontSize: fontSize.md,
    lineHeight: 20,
  },
  centerState: {
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xl,
  },
  stateCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  stateTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateText: {
    fontSize: fontSize.button,
    lineHeight: 21,
    textAlign: 'center',
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: spacing.md,
  },
  identityText: {
    flex: 1,
    fontSize: fontSize.md,
  },
  mailboxList: {
    gap: spacing.md,
  },
  sectionLabel: {
    fontSize: fontSize.md,
    fontWeight: '500',
  },
  mailboxCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.md,
  },
  mailboxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  mailboxIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mailboxTitleWrap: {
    flex: 1,
    gap: 2,
  },
  mailboxAddress: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  mailboxMeta: {
    fontSize: fontSize.md,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipText: {
    fontSize: fontSize.md,
  },
  actionRow: {
    gap: spacing.sm,
  },
  footerNote: {
    fontSize: fontSize.md,
    lineHeight: 19,
    textAlign: 'center',
  },
});
