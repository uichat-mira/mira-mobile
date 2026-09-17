import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { version } from '../../package.json';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader';
import { ProviderConfigStore } from '../provider/providerConfigStore';
import { useHostStore } from '../store/hostStore';
import { localKeyValueStore } from '../storage/localKeyValueStore';
import {
  buildReportDiagnostics,
  buildReportMailtoUrl,
  REPORT_FEEDBACK_EMAIL,
} from './reportDiagnostics';

const MAX_LENGTH = 2000;
const DRAFT_KEY = 'mira.report-error.draft.v1';

export function ReportErrorScreen() {
  const { colors } = useTheme();
  const [description, setDescription] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [openedHint, setOpenedHint] = useState(false);
  const remotePaired = useHostStore((state) => state.config !== null);
  const pendingEditRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadDraft = async () => {
      const value = await localKeyValueStore.get(DRAFT_KEY).catch(() => null);
      if (cancelled) return;
      if (pendingEditRef.current === null && value) setDescription(value);
      setDraftReady(true);
    };
    void loadDraft();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasDescription = description.trim().length > 0;

  const updateDescription = (value: string) => {
    pendingEditRef.current = value;
    setDescription(value);
    setOpenedHint(false);
    if (!draftReady) return;
    void localKeyValueStore.set(DRAFT_KEY, value).catch(() => undefined);
  };

  const handleSend = async () => {
    const trimmed = description.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const localProviderCount = await new ProviderConfigStore()
        .load()
        .then((configs) => configs.length)
        .catch(() => 0);
      const diagnostics = buildReportDiagnostics({
        appVersion: version,
        remotePaired,
        localProviderCount,
      });
      await Linking.openURL(buildReportMailtoUrl(trimmed, diagnostics));
      setOpenedHint(true);
    } catch {
      Alert.alert(
        '无法打开邮件客户端',
        `未找到可用的邮件应用。可手动发送邮件至 ${REPORT_FEEDBACK_EMAIL}；你填写的内容仍保留在本页。`,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.bg.canvas }]} edges={['top', 'bottom']}>
      <SettingsPageHeader title="报告错误" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.content}>
          <Text style={[styles.label, { color: colors.text.ink }]}>发生了什么？</Text>
          <View style={[styles.inputWrap, { borderColor: colors.border.default, backgroundColor: colors.bg.input }]}>
            <TextInput
              value={description}
              onChangeText={updateDescription}
              multiline
              maxLength={MAX_LENGTH}
              placeholder="请描述你遇到的问题"
              placeholderTextColor={colors.text.placeholder}
              style={[styles.input, { color: colors.text.ink }]}
              textAlignVertical="top"
            />
            <Text style={[styles.counter, { color: colors.text.soft }]}>{description.length} / {MAX_LENGTH}</Text>
          </View>
          <Text style={[styles.hint, { color: colors.text.muted }]}>
            发送时会附带设备基础信息（版本、系统、语言、连接模式），不会包含会话内容或凭据。
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={!hasDescription || sending}
            onPress={() => void handleSend()}
            style={({ pressed }) => [
              styles.sendButton,
              { backgroundColor: hasDescription && !sending ? colors.primary : colors.primaryDisabled },
              pressed && hasDescription && !sending && { backgroundColor: colors.primaryActive },
            ]}
          >
            <Text
              style={[
                styles.sendText,
                { color: hasDescription && !sending ? colors.onPrimary : colors.text.soft },
              ]}
            >
              {sending ? '正在打开邮件客户端…' : '发送'}
            </Text>
          </Pressable>
          {openedHint ? (
            <Text style={[styles.hint, styles.openedHint, { color: colors.text.muted }]}>
              已唤起邮件客户端；草稿已保留，若内容未自动填入可在邮件中手动粘贴。
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  content: { flex: 1, padding: spacing.lg, gap: spacing.md },
  label: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  inputWrap: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  input: { minHeight: 150, padding: spacing.md, fontSize: fontSize.bodyMd },
  counter: { textAlign: 'right', paddingHorizontal: spacing.md, paddingBottom: spacing.sm, fontSize: fontSize.caption },
  hint: { fontSize: fontSize.caption, lineHeight: 18 },
  openedHint: { textAlign: 'center' },
  sendButton: {
    minHeight: sizing.buttonHeight,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 'auto',
  },
  sendText: { fontSize: fontSize.button, fontWeight: '600' },
});
