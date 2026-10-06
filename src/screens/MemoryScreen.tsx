import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pencil, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../settings/SettingsPageHeader';
import { SettingsInputModal } from '../settings/SettingsInputModal';
import { SettingsChoiceModal, type SettingsChoice } from '../settings/SettingsChoiceModal';
import {
  MAX_CONTENT_LENGTH,
  MIN_CONTENT_LENGTH,
  getLocalMemoryService,
  type MemoryKind,
  type MemoryOverview,
  type MemoryOverviewRecord,
} from '../memory';

const kindLabels: Record<MemoryKind, string> = {
  preference: '偏好',
  fact: '事实',
  decision: '决策',
  constraint: '约束',
};

const kindChoices: readonly SettingsChoice<MemoryKind>[] = [
  { value: 'preference', label: '偏好' },
  { value: 'fact', label: '长期事实' },
  { value: 'decision', label: '决定' },
  { value: 'constraint', label: '约束' },
];

// Mirrors the deterministic Memory Policy content range, so the user sees the
// same constraint the kernel enforces instead of a UI-only rule.
const MIN_MEMORY_CONTENT_LENGTH = MIN_CONTENT_LENGTH;
const MAX_MEMORY_CONTENT_LENGTH = MAX_CONTENT_LENGTH;

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message
    ? error.message
    : '本机记忆不可用，请稍后重试。';

interface PendingEdit {
  record: MemoryOverviewRecord;
}

const formatKindLabel = (kind: MemoryKind): string => kindLabels[kind];

const formatOriginLabel = (origin: MemoryOverviewRecord['origin']): string =>
  origin === 'manual' ? '手动添加' : '对话中提炼';

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export function MemoryScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const service = getLocalMemoryService();
  const [overview, setOverview] = useState<MemoryOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<MemoryKind>('preference');
  const [kindPickerForCreate, setKindPickerForCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<PendingEdit | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await service.getOverview();
      setOverview(next);
      setLoadError(null);
    } catch (error) {
      // Corrupt or unreadable local storage must surface as an explicit,
      // non-destructive failure rather than being silently overwritten.
      setLoadError(errorMessage(error));
    } finally {
      setHydrated(true);
    }
  }, [service]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyResult = useCallback((next: MemoryOverview) => {
    setOverview(next);
    setActionError(null);
  }, []);

  const handleToggleEnabled = useCallback(
    async (nextEnabled: boolean) => {
      // Optimistic flip; rolled back on error by reload.
      if (overview) setOverview({ ...overview, enabled: nextEnabled });
      try {
        applyResult(await service.setEnabled(nextEnabled));
      } catch (error) {
        setActionError(errorMessage(error));
        void reload();
      }
    },
    [overview, service, applyResult, reload],
  );

  const handleCreate = useCallback(
    async (kind: MemoryKind, content: string) => {
      try {
        applyResult(await service.createManual({ kind, content }));
      } catch (error) {
        setActionError(errorMessage(error));
      }
    },
    [service, applyResult],
  );

  const handleEdit = useCallback(
    async (id: string, kind: MemoryKind, content: string) => {
      try {
        const next = await service.updateManual(id, { kind, content });
        if (next) {
          applyResult(next);
        } else {
          // The target vanished underneath us; reload so the list is truthful.
          await reload();
        }
      } catch (error) {
        setActionError(errorMessage(error));
      }
    },
    [service, applyResult, reload],
  );

  const requestDelete = useCallback(
    (record: MemoryOverviewRecord) => {
      setActionError(null);
      Alert.alert(
        '删除记忆？',
        `确定要删除这条「${formatKindLabel(record.kind)}」吗？删除后 Mira 将不再使用它。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除',
            style: 'destructive',
            onPress: async () => {
              setPendingDeleteId(record.id);
              try {
                const next = await service.deleteManual(record.id);
                if (next) {
                  applyResult(next);
                } else {
                  await reload();
                }
              } catch (error) {
                setActionError(errorMessage(error));
              } finally {
                setPendingDeleteId(null);
              }
            },
          },
        ],
      );
    },
    [service, applyResult, reload],
  );

  const renderDisabled = useCallback(() => {
    const message = loadError ?? actionError;
    return (
      <View style={[styles.disabledBox, { backgroundColor: colors.status.errorBg }]}>
        <Text style={[styles.disabledTitle, { color: colors.status.error }]}>
          本机记忆暂不可用
        </Text>
        <Text style={[styles.disabledBody, { color: colors.status.error }]}>{message}</Text>
        <Text style={[styles.disabledBody, { color: colors.status.error }]}>
          为避免覆盖你可能已有的记忆，本机记忆不会自动重置。请重试或检查设备存储。
        </Text>
        <Pressable
          onPress={reload}
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: colors.bg.card },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="重试加载本机记忆"
        >
          <Text style={[styles.retryLabel, { color: colors.text.ink }]}>重试</Text>
        </Pressable>
      </View>
    );
  }, [loadError, actionError, colors, reload]);

  if (!hydrated) {
    return (
      <SafeAreaView
        style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
        edges={['top', 'bottom']}
      >
        <SettingsPageHeader title="记忆" onConfirm={() => navigation.goBack()} />
      </SafeAreaView>
    );
  }

  const records = overview?.records ?? [];
  const disabled = loadError !== null;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <SettingsPageHeader title="记忆" onConfirm={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {disabled ? (
          renderDisabled()
        ) : (
          <>
            <View style={[styles.surface, { backgroundColor: colors.bg.card }]}>
              <View style={styles.flex}>
                <Text style={[styles.title, { color: colors.text.ink }]}>启用记忆</Text>
                <Text style={[styles.subtitle, { color: colors.text.muted }]}>
                  关闭后 Mira 将不会使用已有记忆回答问题。
                </Text>
              </View>
              <Switch
                value={overview?.enabled ?? false}
                onValueChange={handleToggleEnabled}
                trackColor={{ false: colors.border.default, true: colors.primary }}
                thumbColor={colors.bg.elevated}
              />
            </View>
            <Text style={[styles.help, { color: colors.text.muted }]}>
              这些记忆仅保存在本机，供手机直连的 Local Provider 使用；不会上传到 Mira Host，也不与远程记忆同步。
            </Text>

            {actionError ? (
              <Text style={[styles.help, { color: colors.status.error }]}>{actionError}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.surface,
                { backgroundColor: colors.bg.card },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => {
                setCreateKind('preference');
                setCreateOpen(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="添加记忆"
            >
              <View style={styles.flex}>
                <Text style={[styles.title, { color: colors.text.ink }]}>添加记忆</Text>
                <Text style={[styles.subtitle, { color: colors.text.muted }]}>
                  手动写入一条将被 Mira 长期记住的信息
                </Text>
              </View>
            </Pressable>

            <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>
              {`已有 ${records.length} 条`}
            </Text>

            {records.map(record => (
              <View
                key={record.id}
                style={[styles.surface, { backgroundColor: colors.bg.card }]}
              >
                <View style={styles.flex}>
                  <Text style={[styles.title, { color: colors.text.ink }]}>
                    {formatKindLabel(record.kind)} · {formatOriginLabel(record.origin)}
                  </Text>
                  <Text style={[styles.subtitle, { color: colors.text.muted }]}>
                    {record.content}
                  </Text>
                  <Text style={[styles.meta, { color: colors.text.soft }]}>
                    更新于 {formatTimestamp(record.updatedAt)}
                  </Text>
                </View>
                <View style={styles.rowActions}>
                  <Pressable
                    onPress={() => setEditTarget({ record })}
                    style={({ pressed }) => [
                      styles.iconButton,
                      pressed && { opacity: 0.6 },
                    ]}
                    hitSlop={8}
                    disabled={pendingDeleteId === record.id}
                    accessibilityRole="button"
                    accessibilityLabel={`编辑记忆 ${formatKindLabel(record.kind)}`}
                  >
                    <Pencil size={18} color={colors.text.muted} />
                  </Pressable>
                  <Pressable
                    onPress={() => requestDelete(record)}
                    style={({ pressed }) => [
                      styles.iconButton,
                      pressed && { opacity: 0.6 },
                    ]}
                    hitSlop={8}
                    disabled={pendingDeleteId === record.id}
                    accessibilityRole="button"
                    accessibilityLabel={`删除记忆 ${formatKindLabel(record.kind)}`}
                  >
                    <X size={18} color={colors.status.error} />
                  </Pressable>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <SettingsInputModal
        visible={createOpen}
        title="添加记忆"
        placeholder="例如：用户习惯使用 Markdown"
        confirmLabel="添加"
        maxLength={MAX_MEMORY_CONTENT_LENGTH}
        multiline
        validate={value => {
          if (value.length < MIN_MEMORY_CONTENT_LENGTH) {
            return `记忆内容至少 ${MIN_MEMORY_CONTENT_LENGTH} 个字符。`;
          }
          return null;
        }}
        onSubmit={value => {
          void handleCreate(createKind, value);
        }}
        onClose={() => setCreateOpen(false)}
        footer={
          <Pressable
            onPress={() => setKindPickerForCreate(true)}
            style={({ pressed }) => [
              styles.kindRow,
              { borderColor: colors.border.default },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="选择记忆类型"
          >
            <Text style={[styles.kindRowLabel, { color: colors.text.muted }]}>类型</Text>
            <Text style={[styles.kindRowValue, { color: colors.text.ink }]}>
              {formatKindLabel(createKind)}
            </Text>
          </Pressable>
        }
      />

      <SettingsChoiceModal
        visible={kindPickerForCreate}
        value={createKind}
        options={kindChoices}
        onChange={setCreateKind}
        onClose={() => setKindPickerForCreate(false)}
      />

      <MemoryEditSheet
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={(kind, content) => {
          if (!editTarget) return;
          const id = editTarget.record.id;
          setEditTarget(null);
          void handleEdit(id, kind, content);
        }}
      />
    </SafeAreaView>
  );
}

interface MemoryEditSheetProps {
  target: PendingEdit | null;
  onClose: () => void;
  onSubmit: (kind: MemoryKind, content: string) => void;
}

function MemoryEditSheet({ target, onClose, onSubmit }: MemoryEditSheetProps) {
  // Editing always goes through the same Memory Service / Policy path as
  // create, so a manual edit can never bypass the kernel and touch storage.
  const { colors } = useTheme();
  const [draftKind, setDraftKind] = useState<MemoryKind>('preference');
  const [kindPickerOpen, setKindPickerOpen] = useState(false);

  useEffect(() => {
    if (target) {
      setDraftKind(target.record.kind);
      setKindPickerOpen(false);
    }
  }, [target]);

  const visible = target !== null;

  return (
    <>
      <SettingsInputModal
        visible={visible}
        title="编辑记忆"
        placeholder="更新这条记忆的内容"
        confirmLabel="保存"
        maxLength={MAX_MEMORY_CONTENT_LENGTH}
        multiline
        initialValue={target?.record.content}
        validate={value => {
          if (value.length < MIN_MEMORY_CONTENT_LENGTH) {
            return `记忆内容至少 ${MIN_MEMORY_CONTENT_LENGTH} 个字符。`;
          }
          return null;
        }}
        onSubmit={value => onSubmit(draftKind, value)}
        onClose={onClose}
        footer={
          <Pressable
            onPress={() => setKindPickerOpen(true)}
            style={({ pressed }) => [
              styles.kindRow,
              { borderColor: colors.border.default },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="更改记忆类型"
          >
            <Text style={[styles.kindRowLabel, { color: colors.text.muted }]}>类型</Text>
            <Text style={[styles.kindRowValue, { color: colors.text.ink }]}>
              {formatKindLabel(draftKind)}
            </Text>
          </Pressable>
        }
      />
      <SettingsChoiceModal
        visible={kindPickerOpen}
        value={draftKind}
        options={kindChoices}
        onChange={setDraftKind}
        onClose={() => setKindPickerOpen(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.section, gap: spacing.md },
  surface: {
    minHeight: 62,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: { flex: 1 },
  title: { fontSize: fontSize.bodyMd, fontWeight: '500' },
  subtitle: { fontSize: fontSize.button, marginTop: spacing.xs },
  meta: { fontSize: fontSize.caption, marginTop: spacing.xs },
  help: { fontSize: fontSize.button, lineHeight: 20 },
  sectionLabel: { fontSize: fontSize.button, marginTop: spacing.sm },
  kindRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  kindRowLabel: { fontSize: fontSize.button },
  kindRowValue: { fontSize: fontSize.button, fontWeight: '600' },
  rowActions: { flexDirection: 'row', gap: spacing.sm },
  iconButton: {
    width: sizing.iconButton,
    height: sizing.iconButton,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledBox: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  disabledTitle: { fontSize: fontSize.titleMd, fontWeight: '700' },
  disabledBody: { fontSize: fontSize.button, lineHeight: 20 },
  retryButton: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  retryLabel: { fontSize: fontSize.button, fontWeight: '600' },
});
