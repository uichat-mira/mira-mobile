import React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { useAppUpdateStore, type AppUpdateFlow } from './appUpdateStore';

const BYTE_UNITS = ['KB', 'MB', 'GB'] as const;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${BYTE_UNITS[unitIndex]}`;
};

/**
 * Returns null when the server did not report a usable total; callers must show
 * an indeterminate state instead of a fabricated percentage.
 */
export const updateProgressRatio = (flow: AppUpdateFlow): number | null => {
  if (flow.totalBytes === null || flow.totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, flow.receivedBytes / flow.totalBytes));
};

/**
 * Global surface for the in-app update run. It is mounted next to the other
 * root-level overlays so the flow started by the startup auto-check can be shown
 * without owning any navigator state.
 */
export function AppUpdateOverlay() {
  const { colors } = useTheme();
  const flow = useAppUpdateStore((state) => state.flow);
  const cancel = useAppUpdateStore((state) => state.cancel);
  const retry = useAppUpdateStore((state) => state.retry);
  const dismiss = useAppUpdateStore((state) => state.dismiss);
  const openPermissionSettings = useAppUpdateStore(
    (state) => state.openPermissionSettings,
  );

  if (flow === null) return null;

  const busy = flow.status === 'downloading' || flow.status === 'installing';
  const ratio = updateProgressRatio(flow);
  const received = formatBytes(flow.receivedBytes);
  const total = flow.totalBytes === null ? null : formatBytes(flow.totalBytes);

  const title = (() => {
    switch (flow.status) {
      case 'downloading':
        return '正在下载更新';
      case 'installing':
        return '正在启动系统安装';
      case 'handed-off':
        return '请在系统安装界面完成安装';
      case 'permission-required':
        return '需要安装权限';
      default:
        return '更新失败';
    }
  })();

  const detail = (() => {
    switch (flow.status) {
      case 'downloading':
        return ratio === null
          ? `已下载 ${received}`
          : `已下载 ${received} / ${total}（${Math.round(ratio * 100)}%）`;
      case 'installing':
        return '下载已完成并通过校验。';
      case 'handed-off':
        return '安装完成后重新打开 Mira 即可使用新版本。';
      default:
        return flow.errorMessage ?? '请稍后重试。';
    }
  })();

  const handleRequestClose = () => {
    // Starting the update was an explicit confirmation, so abandoning a running
    // transfer must be one too: a stray backdrop tap or back press should not
    // silently discard a multi-megabyte download. The sheet's own 取消 button is
    // already a deliberate action and stays immediate.
    if (busy) {
      Alert.alert('终止下载？', '已下载的部分会被丢弃，下次需要重新下载。', [
        { text: '继续下载', style: 'cancel' },
        { text: '终止', style: 'destructive', onPress: cancel },
      ]);
      return;
    }
    dismiss();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={handleRequestClose}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="关闭更新提示"
        testID="app-update-backdrop"
        onPress={handleRequestClose}
        style={styles.backdrop}
      >
        <View
          accessibilityViewIsModal
          testID="app-update-sheet"
          // Claim the touch responder so a tap aimed at the sheet (or at one of
          // its buttons) cannot fall through to the backdrop and close the panel
          // while the user is reading progress or reaching for an action.
          onStartShouldSetResponder={() => true}
          style={[
            styles.sheet,
            { backgroundColor: colors.bg.card, borderColor: colors.border.default },
          ]}
        >
          <Text style={[styles.title, { color: colors.text.ink }]}>{title}</Text>
          <Text style={[styles.version, { color: colors.text.muted }]}>
            新版本 {flow.release.displayVersion}
          </Text>
          <Text style={[styles.detail, { color: colors.text.muted }]}>{detail}</Text>

          {flow.status === 'downloading' && (
            <View style={[styles.track, { backgroundColor: colors.bg.soft }]}>
              <View
                style={[
                  styles.fill,
                  {
                    backgroundColor: colors.primary,
                    width: `${Math.round((ratio ?? 0) * 100)}%`,
                  },
                ]}
              />
            </View>
          )}

          <View style={styles.actions}>
            {flow.status === 'failed' && (
              <Pressable
                accessibilityRole="button"
                onPress={retry}
                style={[styles.button, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                  重试
                </Text>
              </Pressable>
            )}
            {flow.status === 'permission-required' && (
              <Pressable
                accessibilityRole="button"
                onPress={openPermissionSettings}
                style={[styles.button, { backgroundColor: colors.primary }]}
              >
                <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
                  前往设置
                </Text>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              onPress={busy ? cancel : dismiss}
              style={[
                styles.button,
                styles.secondaryButton,
                { borderColor: colors.border.default },
              ]}
            >
              <Text style={[styles.buttonText, { color: colors.text.ink }]}>
                {busy ? '取消' : '关闭'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20, 20, 19, 0.45)',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  version: {
    marginTop: spacing.xs,
    fontSize: fontSize.caption,
  },
  detail: {
    marginTop: spacing.md,
    fontSize: fontSize.bodyMd,
  },
  track: {
    marginTop: spacing.lg,
    height: 6,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  fill: {
    height: 6,
    borderRadius: radius.full,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  button: {
    minHeight: 40,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.lg,
  },
  secondaryButton: {
    borderWidth: 1,
  },
  buttonText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
