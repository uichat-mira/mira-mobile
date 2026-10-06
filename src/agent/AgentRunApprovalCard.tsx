import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AgentRunAction } from './remoteAgentApproval';
import { shouldDisplayAgentRun } from './remoteAgentApproval';
import type { RemoteAgentRun } from '../protocol/remoteHostV1';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, shadows, spacing } from '../theme/tokens';

interface AgentRunApprovalCardProps {
  runId: string | null;
  run: RemoteAgentRun | null;
  loading: boolean;
  error: string | null;
  actionInFlight: AgentRunAction | null;
  onAction: (action: AgentRunAction) => void;
  onRetry: () => void;
}

const getStatusLabel = (run: RemoteAgentRun | null) => {
  switch (run?.status) {
    case 'queued':
      return 'Agent 正在排队';
    case 'running':
      return 'Agent 正在运行';
    case 'waiting_approval':
      return '需要你的批准';
    case 'waiting_user':
      return 'Agent 正在等待你的输入';
    default:
      return 'Agent 状态';
  }
};

export function AgentRunApprovalCard({
  runId,
  run,
  loading,
  error,
  actionInFlight,
  onAction,
  onRetry,
}: AgentRunApprovalCardProps) {
  const { colors } = useTheme();
  if (!runId) return null;
  if (!loading && !error && !shouldDisplayAgentRun(run)) return null;

  const waitingApproval = run?.status === 'waiting_approval' && run.pendingApproval;
  const cancellable = run?.status === 'queued' || run?.status === 'running';
  const disabled = actionInFlight !== null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bg.card,
          borderColor: colors.border.default,
        },
      ]}
      accessibilityLabel="Agent 运行状态"
    >
      <View style={styles.headingRow}>
        <Text style={[styles.title, { color: colors.text.ink }]}>Agent</Text>
        {loading && !run ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>

      <Text style={[styles.status, { color: colors.text.muted }]}>
        {getStatusLabel(run)}
      </Text>

      {waitingApproval ? (
        <View style={styles.details}>
          <Text style={[styles.tool, { color: colors.text.ink }]} numberOfLines={1}>
            {waitingApproval.toolId}
          </Text>
          <Text style={[styles.reason, { color: colors.text.muted }]}>
            {waitingApproval.reason}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorRow}>
          <Text style={[styles.errorText, { color: colors.status.error }]}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新读取 Agent 状态"
            onPress={onRetry}
            disabled={disabled || loading}
            style={({ pressed }) => [
              styles.retryButton,
              pressed && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.retryText, { color: colors.primary }]}>重试</Text>
          </Pressable>
        </View>
      ) : null}

      {waitingApproval ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="拒绝 Agent 操作"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onAction('reject')}
            style={({ pressed }) => [
              styles.secondaryButton,
              { borderColor: colors.border.default },
              pressed && !disabled && { backgroundColor: colors.bg.soft },
              disabled && styles.disabled,
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.text.ink }]}>拒绝</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="批准 Agent 操作"
            accessibilityState={{ disabled }}
            disabled={disabled}
            onPress={() => onAction('approve')}
            style={({ pressed }) => [
              styles.primaryButton,
              {
                backgroundColor: pressed ? colors.primaryActive : colors.primary,
              },
              disabled && styles.disabled,
            ]}
          >
            {actionInFlight === 'approve' ? (
              <ActivityIndicator size="small" color={colors.onPrimary} />
            ) : (
              <Text style={[styles.primaryText, { color: colors.onPrimary }]}>批准</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {cancellable ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="取消 Agent 运行"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => onAction('cancel')}
          style={({ pressed }) => [
            styles.cancelButton,
            { borderColor: colors.border.default },
            pressed && !disabled && { backgroundColor: colors.bg.soft },
            disabled && styles.disabled,
          ]}
        >
          {actionInFlight === 'cancel' ? (
            <ActivityIndicator size="small" color={colors.text.ink} />
          ) : (
            <Text style={[styles.secondaryText, { color: colors.text.ink }]}>取消运行</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.xs,
    ...shadows.composer,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: fontSize.bodyMd, fontWeight: '700' },
  status: { fontSize: fontSize.sm, lineHeight: 18 },
  details: { gap: 2, paddingTop: spacing.xs },
  tool: { fontSize: fontSize.sm, fontWeight: '600' },
  reason: { fontSize: fontSize.sm, lineHeight: 18 },
  errorRow: { gap: spacing.xs, paddingTop: spacing.xs },
  errorText: { fontSize: fontSize.sm, lineHeight: 18 },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 4, paddingRight: spacing.sm },
  retryText: { fontSize: fontSize.sm, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  primaryButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButton: {
    flex: 1,
    minHeight: 40,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    minHeight: 40,
    marginTop: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: fontSize.button, fontWeight: '700' },
  secondaryText: { fontSize: fontSize.button, fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
