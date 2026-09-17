import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Pencil, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { SettingsPageHeader } from '../components/settings/SettingsPageHeader';
import { SettingsInputModal } from '../components/settings/SettingsInputModal';
import { miraHostClient } from '../api/miraHostClient';
import { RemoteHostError } from '../api/remoteHttp';
import type {
  RemoteMemoryKind,
  RemoteMemoryOverview,
  RemoteMemoryRecord,
} from '../protocol/remoteHostV1';

const kindLabels: Record<RemoteMemoryKind, string> = {
  preference: '偏好',
  fact: '事实',
  decision: '决策',
  constraint: '约束',
};

// Mirrors the Host /memory body schema: content must be 4-500 chars.
// Hard error messages intentionally mirror the Host so the user can act on
// them without translation gymnastics.
const MIN_MEMORY_CONTENT_LENGTH = 4;
const MAX_MEMORY_CONTENT_LENGTH = 500;

const errorMessage = (error: unknown): string => {
  if (error instanceof RemoteHostError) {
    if (error.code === 'REMOTE_MEMORY_ROUTE_UNAVAILABLE' || error.code === 'REMOTE_SCOPE_REQUIRED') {
      return '当前 Mira Host 尚未对移动端开放记忆能力。请在 Desktop Host 上升级并开放 Memory 远程合同后再试。';
    }
    if (error.code === 'PAIRING_REQUIRED') {
      return '此设备尚未与 Mira Host 配对，无法管理记忆。';
    }
    return error.message;
  }
  return error instanceof Error && error.message
    ? error.message
    : '无法与 Mira Host 同步记忆，请稍后重试。';
};

interface PendingEdit {
  record: RemoteMemoryRecord;
  text: string;
}

const formatKindLabel = (kind: RemoteMemoryKind): string => kindLabels[kind];

const formatOriginLabel = (origin: RemoteMemoryRecord['origin']): string =>
  origin === 'manual' ? '手动添加' : '对话中提炼';

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export function MemoryScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [overview, setOverview] = useState<RemoteMemoryOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PendingEdit | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const next = await miraHostClient.getMemoryOverview();
      setOverview(next);
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyResult = useCallback((next: RemoteMemoryOverview) => {
    setOverview(next);
    setActionError(null);
  }, []);

  const handleToggleEnabled = useCallback(
    async (nextEnabled: boolean) => {
      // Optimistic flip; rolled back on error by reload.
      if (overview) setOverview({ ...overview, enabled: nextEnabled });
      try {
        applyResult(await miraHostClient.updateMemorySettings(nextEnabled));
      } catch (error) {
        setActionError(errorMessage(error));
        void reload();
      }
    },
    [overview, applyResult, reload],
  );

  const handleCreate = useCallback(
    async (kind: RemoteMemoryKind, content: string) => {
      try {
        applyResult(await miraHostClient.createMemory(kind, content));
      } catch (error) {
        setActionError(errorMessage(error));
        // MEMORY_CREATE_UNCERTAIN means the request may have already created
        // the record on the Host while we lost the response; reload before
        // the user is allowed to try again so we do not post duplicates.
        if (
          error instanceof RemoteHostError &&
          error.code === 'MEMORY_CREATE_UNCERTAIN'
        ) {
          await reload();
        }
      }
    },
    [applyResult, reload],
  );

  const handleEdit = useCallback(
    async (id: string, kind: RemoteMemoryKind, content: string) => {
      try {
        applyResult(await miraHostClient.updateMemory(id, kind, content));
      } catch (error) {
        setActionError(errorMessage(error));
      }
    },
    [applyResult],
  );

  const requestDelete = useCallback(
    (record: RemoteMemoryRecord) => {
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
                applyResult(await miraHostClient.deleteMemory(record.id));
              } catch (error) {
                setActionError(errorMessage(error));
                // MEMORY_DELETE_UNCERTAIN means the Host may have already
                // removed the record while we lost the response; reload so
                // the list no longer offers ghost actions against it.
                if (
                  error instanceof RemoteHostError &&
                  error.code === 'MEMORY_DELETE_UNCERTAIN'
                ) {
                  await reload();
                }
              } finally {
                setPendingDeleteId(null);
              }
            },
          },
        ],
      );
    },
    [applyResult, reload],
  );

  const renderDisabled = useCallback(() => {
    const message = loadError ?? actionError;
    return (
      <View style={[styles.disabledBox, { backgroundColor: colors.status.errorBg }]}>
        <Text style={[styles.disabledTitle, { color: colors.status.error }]}>
          记忆功能暂不可用
        </Text>
        <Text style={[styles.disabledBody, { color: colors.status.error }]}>{message}</Text>
        <Pressable
          onPress={reload}
          style={({ pressed }) => [
            styles.retryButton,
            { backgroundColor: colors.bg.card },
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="重试加载记忆"
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
              记忆由 Mira Host 保管，本机不做本地副本。开启 / 关闭、添加 / 编辑 / 删除都会立即与 Host 同步。
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
              onPress={() => setCreateOpen(true)}
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
                    onPress={() => setEditTarget({ record, text: record.content })}
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
          // Default kind = preference; the user can edit later.
          void handleCreate('preference', value);
        }}
        onClose={() => setCreateOpen(false)}
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
  onSubmit: (kind: RemoteMemoryKind, content: string) => void;
}

function MemoryEditSheet({ target, onClose, onSubmit }: MemoryEditSheetProps) {
  // Reuse SettingsInputModal for the multi-line content. Changing the kind
  // is intentionally not exposed in this flow because every record the user
  // created here already starts with kind='preference'; for conversational
  // origins the kind is Host-authoritative and should not be mutated from
  // a settings UI.
  const visible = target !== null;
  const currentKind = target?.record.kind ?? 'preference';

  return (
    <SettingsInputModal
      visible={visible}
      title="编辑记忆"
      placeholder="更新这条记忆的内容"
      confirmLabel="保存"
      maxLength={MAX_MEMORY_CONTENT_LENGTH}
      multiline
      initialValue={target?.text}
      validate={value => {
        if (value.length < MIN_MEMORY_CONTENT_LENGTH) {
          return `记忆内容至少 ${MIN_MEMORY_CONTENT_LENGTH} 个字符。`;
        }
        return null;
      }}
      onSubmit={value => onSubmit(currentKind, value)}
      onClose={onClose}
    />
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