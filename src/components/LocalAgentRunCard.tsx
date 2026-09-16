import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ToolApprovalDecision } from '../tools/toolGatewayClient';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';

export type LocalAgentActivityStatus =
  | 'requested'
  | 'running'
  | 'awaiting-approval'
  | 'approved'
  | 'rejected'
  | 'completed'
  | 'truncated';

export interface LocalAgentActivity {
  callId: string;
  name: string;
  status: LocalAgentActivityStatus;
  detail?: string;
}

export type LocalAgentRunPhase =
  | 'idle'
  | 'thinking'
  | 'waiting-approval'
  | 'running-tool'
  | 'continuing'
  | 'completed'
  | 'paused'
  | 'error';

export type LocalAgentPauseReason =
  | 'app-suspended'
  | 'timeout'
  | 'cancelled'
  | 'approval-rejected';

export interface LocalAgentApprovalView {
  invocationId: string;
  callId: string;
  name: string;
  message: string;
  scope?: string;
}

interface Props {
  phase: LocalAgentRunPhase;
  pauseReason: LocalAgentPauseReason | null;
  activities: readonly LocalAgentActivity[];
  approval: LocalAgentApprovalView | null;
  approvalAction: ToolApprovalDecision | null;
  error: string | null;
  onApproval: (decision: ToolApprovalDecision) => void;
}

const phaseLabel: Record<LocalAgentRunPhase, string> = {
  idle: '待命',
  thinking: '正在思考',
  'waiting-approval': '等待你的批准',
  'running-tool': '正在执行工具',
  continuing: '工具完成，继续生成',
  completed: '本轮完成',
  paused: '本轮已暂停',
  error: '运行失败',
};

const activityLabel: Record<LocalAgentActivityStatus, string> = {
  requested: '请求调用',
  running: '执行中',
  'awaiting-approval': '待批准',
  approved: '已批准',
  rejected: '已拒绝',
  completed: '已完成',
  truncated: '结果已截断',
};

const pauseLabel: Record<LocalAgentPauseReason, string> = {
  'app-suspended': 'App 已进入后台。本轮不会伪装成继续运行，可重新发送后再执行。',
  timeout: '本轮运行已超时，可重新发送。',
  cancelled: '你已停止本轮运行。',
  'approval-rejected': '该工具调用已拒绝，本轮已停止。',
};

const preview = (value: string) => {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 120 ? compact.slice(0, 117) + '…' : compact;
};

export function LocalAgentRunCard({
  phase,
  pauseReason,
  activities,
  approval,
  approvalAction,
  error,
  onApproval,
}: Props) {
  const { colors } = useTheme();
  if (
    phase === 'idle' &&
    activities.length === 0 &&
    !approval &&
    !error
  ) {
    return null;
  }

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.bg.card,
          borderColor: colors.border.default,
        },
      ]}
      accessibilityLabel="本地 Agent 运行状态"
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text.ink }]}>Agent</Text>
        <Text style={[styles.phase, { color: colors.text.muted }]}>
          {phaseLabel[phase]}
        </Text>
      </View>

      {activities.slice(-4).map(activity => (
        <View key={activity.callId} style={styles.activityRow}>
          <Text style={[styles.activityState, { color: colors.text.muted }]}>
            {activityLabel[activity.status]}
          </Text>
          <View style={styles.activityBody}>
            <Text
              style={[styles.activityName, { color: colors.text.ink }]}
              numberOfLines={1}
            >
              {activity.name}
            </Text>
            {activity.detail ? (
              <Text
                style={[styles.detail, { color: colors.text.soft }]}
                numberOfLines={2}
              >
                {preview(activity.detail)}
              </Text>
            ) : null}
          </View>
        </View>
      ))}

      {approval ? (
        <View
          style={[
            styles.approvalBox,
            {
              backgroundColor: colors.bg.soft,
              borderColor: colors.border.default,
            },
          ]}
        >
          <Text style={[styles.approvalTitle, { color: colors.text.ink }]}>
            这个工具需要你的批准
          </Text>
          <Text style={[styles.approvalMessage, { color: colors.text.muted }]}>
            {approval.message}
          </Text>
          {approval.scope ? (
            <Text style={[styles.scope, { color: colors.text.soft }]}>
              范围：{approval.scope}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="拒绝工具调用"
              disabled={approvalAction !== null}
              onPress={() => onApproval('rejected')}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: colors.border.default },
                pressed && { backgroundColor: colors.bg.canvas },
                approvalAction !== null && styles.disabled,
              ]}
            >
              <Text style={[styles.secondaryText, { color: colors.text.ink }]}>
                {approvalAction === 'rejected' ? '正在拒绝…' : '拒绝'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="批准工具调用"
              disabled={approvalAction !== null}
              onPress={() => onApproval('approved')}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: pressed
                    ? colors.primaryActive
                    : colors.primary,
                },
                approvalAction !== null && styles.disabled,
              ]}
            >
              <Text style={[styles.primaryText, { color: colors.onPrimary }]}>
                {approvalAction === 'approved' ? '正在批准…' : '批准'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {pauseReason ? (
        <Text style={[styles.notice, { color: colors.text.muted }]}>
          {pauseLabel[pauseReason]}
        </Text>
      ) : null}

      {error ? (
        <Text style={[styles.notice, { color: colors.status.error }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  phase: {
    fontSize: fontSize.caption,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  activityState: {
    width: 54,
    paddingTop: 1,
    fontSize: fontSize.caption,
  },
  activityBody: {
    flex: 1,
    gap: spacing.xs,
  },
  activityName: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  detail: {
    fontSize: fontSize.caption,
    lineHeight: 18,
  },
  approvalBox: {
    marginTop: spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  approvalTitle: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  approvalMessage: {
    fontSize: fontSize.button,
    lineHeight: 20,
  },
  scope: {
    fontSize: fontSize.caption,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  secondaryButton: {
    minWidth: 76,
    height: sizing.buttonHeight,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  primaryButton: {
    minWidth: 76,
    height: sizing.buttonHeight,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  secondaryText: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
  primaryText: {
    fontSize: fontSize.button,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
  notice: {
    fontSize: fontSize.caption,
    lineHeight: 18,
  },
});
