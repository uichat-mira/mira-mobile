import type { ShiyanCaptureStageView, ShiyanCaptureTaskView } from './client/contracts';

const STAGE_LABELS: Record<string, string> = {
  upload: '上传录音',
  'verify-audio': '校验录音',
  transcribe: '语音转写',
  'persist-transcript': '保存原文',
  organize: 'AI 整理',
  'persist-ai-draft': '保存 AI 草稿',
  'pending-adjustment': '等待调整',
  review: '等待确认',
  delivery: '投递',
};

const STATUS_LABELS: Record<ShiyanCaptureStageView['status'], string> = {
  pending: '等待中',
  running: '处理中',
  succeeded: '已完成',
  failed: '需要处理',
  skipped: '已跳过',
};

const PROCESSING_LABELS: Record<string, string> = {
  upload: '正在上传录音',
  'verify-audio': '正在上传录音',
  transcribe: '正在转写',
  'persist-transcript': '正在转写',
  organize: '正在整理',
  'persist-ai-draft': '正在整理',
  'pending-adjustment': '待你确认',
  review: '待你确认',
  delivery: '正在投递',
};

export type ShiyanRetryAction = 'transcribe' | 'organize';
export type ShiyanStageRecoveryAction = ShiyanRetryAction | 'resume-upload';
export type ShiyanUserStatusTone = 'muted' | 'primary' | 'success' | 'error';

export interface ShiyanUserStatusPresentation {
  label: string;
  tone: ShiyanUserStatusTone;
}

export interface ShiyanStageRecoveryPresentation {
  title: string;
  supportingText: string;
  retryAction: ShiyanStageRecoveryAction | null;
  retryLabel: string | null;
}

export const shiyanStageLabel = (stage: string) => STAGE_LABELS[stage] ?? stage;
export const shiyanStageStatusLabel = (status: ShiyanCaptureStageView['status']) =>
  STATUS_LABELS[status];

export function currentShiyanStage(task: ShiyanCaptureTaskView): ShiyanCaptureStageView | null {
  return (
    task.stages.find((stage) => stage.stage === task.currentStage) ??
    task.stages[task.stages.length - 1] ??
    null
  );
}

export function shiyanStageUserStatus(
  stage: string,
  status: ShiyanCaptureStageView['status'],
): ShiyanUserStatusPresentation {
  if (status === 'failed') return { label: '需要处理', tone: 'error' };

  if (stage === 'review' || stage === 'pending-adjustment') {
    return { label: '待你确认', tone: 'primary' };
  }

  if (stage === 'delivery' && status === 'succeeded') {
    return { label: '已完成', tone: 'success' };
  }

  if (status === 'pending' || status === 'running') {
    return {
      label: PROCESSING_LABELS[stage] ?? '处理中',
      tone: 'primary',
    };
  }

  return { label: '可以查看', tone: 'muted' };
}

export function shiyanTaskStateUserStatus(input: {
  lifecycle: ShiyanCaptureTaskView['lifecycle'];
  currentStage: string;
  stageStatus: ShiyanCaptureStageView['status'];
}): ShiyanUserStatusPresentation {
  if (input.lifecycle === 'cancelled') return { label: '已取消', tone: 'muted' };
  if (input.stageStatus === 'failed') return { label: '需要处理', tone: 'error' };
  if (input.lifecycle === 'completed') return { label: '已完成', tone: 'success' };
  if (input.lifecycle === 'ready') return { label: '待你确认', tone: 'primary' };
  return shiyanStageUserStatus(input.currentStage, input.stageStatus);
}

export function shiyanTaskUserStatus(task: ShiyanCaptureTaskView): ShiyanUserStatusPresentation {
  const stage = currentShiyanStage(task);
  if (!stage) {
    if (task.lifecycle === 'cancelled') return { label: '已取消', tone: 'muted' };
    if (task.lifecycle === 'completed') return { label: '已完成', tone: 'success' };
    if (task.lifecycle === 'ready') return { label: '待你确认', tone: 'primary' };
    return { label: '处理中', tone: 'primary' };
  }

  return shiyanTaskStateUserStatus({
    lifecycle: task.lifecycle,
    currentStage: stage.stage,
    stageStatus: stage.status,
  });
}

export function shiyanTaskStatusText(task: ShiyanCaptureTaskView): string {
  return shiyanTaskUserStatus(task).label;
}

export function retryActionForStage(stage: ShiyanCaptureStageView): ShiyanRetryAction | null {
  if (stage.status !== 'failed' || !stage.retryable) return null;
  if (stage.stage === 'transcribe') return 'transcribe';
  if (stage.stage === 'organize') return 'organize';
  return null;
}

export function shiyanStageRecoveryPresentation(
  stage: ShiyanCaptureStageView,
): ShiyanStageRecoveryPresentation | null {
  if (stage.status !== 'failed') return null;

  const retryAction = retryActionForStage(stage);

  if (stage.stage === 'transcribe') {
    const canRetry = retryAction === 'transcribe';
    return {
      title: '转写遇到问题',
      supportingText: canRetry
        ? '原始录音仍然安全，可以只重新执行转写。'
        : '原始录音仍然安全；当前错误不支持直接重试，请查看处理详情。',
      retryAction,
      retryLabel: canRetry ? '重试转写' : null,
    };
  }

  if (stage.stage === 'organize') {
    const canRetry = retryAction === 'organize';
    return {
      title: 'AI 整理遇到问题',
      supportingText: canRetry
        ? '原文已经保存，可以只重新整理，不需要重新转写。'
        : '原文已经保存；当前错误不支持直接重试，请查看处理详情。',
      retryAction,
      retryLabel: canRetry ? '重试整理' : null,
    };
  }

  if (stage.stage === 'delivery') {
    return {
      title: '投递未完成',
      supportingText: '最终稿仍然安全，可以继续查看、编辑和再次投递。',
      retryAction: null,
      retryLabel: null,
    };
  }

  if (stage.stage === 'upload' || stage.stage === 'verify-audio') {
    const canResumeUpload = stage.retryable;
    return {
      title: '录音上传遇到问题',
      supportingText: canResumeUpload
        ? '上传没有完成；如果本机录音仍在，可以从现有提交流程继续。'
        : '上传没有完成；当前错误不支持直接重试，请查看处理详情。',
      retryAction: canResumeUpload ? 'resume-upload' : null,
      retryLabel: canResumeUpload ? '继续上传' : null,
    };
  }

  return {
    title: `${shiyanStageLabel(stage.stage)}遇到问题`,
    supportingText: '已经成功的内容仍然保留，请查看处理详情确认下一步。',
    retryAction,
    retryLabel:
      retryAction === 'transcribe' ? '重试转写' : retryAction === 'organize' ? '重试整理' : null,
  };
}

export function stageFailureText(stage: ShiyanCaptureStageView): string | null {
  if (stage.status !== 'failed') return null;
  return stage.errorMessage || stage.errorCode || '这个处理阶段没有成功完成。';
}
