import {
  currentShiyanStage,
  retryActionForStage,
  shiyanStageRecoveryPresentation,
  shiyanStageUserStatus,
  shiyanTaskStatusText,
  shiyanTaskUserStatus,
  stageFailureText,
} from './taskPresentation';
import type { ShiyanCaptureTaskView } from './client/contracts';

const task = (stage: ShiyanCaptureTaskView['stages'][number]): ShiyanCaptureTaskView => ({
  id: 'task-1',
  deviceId: 'device-1',
  userId: null,
  title: 'Review',
  sceneId: 'meeting',
  lifecycle: 'active',
  currentStage: stage.stage,
  createdAt: '2026-08-29T00:00:00.000Z',
  updatedAt: '2026-08-29T00:00:00.000Z',
  stages: [stage],
});

const stage = (overrides: Partial<ShiyanCaptureTaskView['stages'][number]> = {}) => ({
  stage: 'transcribe',
  status: 'failed' as const,
  retryable: true,
  retryCount: 1,
  errorCode: 'provider_timeout',
  errorMessage: 'STT provider timed out',
  startedAt: null,
  finishedAt: null,
  updatedAt: '2026-08-29T00:00:00.000Z',
  ...overrides,
});

describe('Shiyan task presentation', () => {
  it('uses product language for processing stages', () => {
    expect(shiyanStageUserStatus('upload', 'running').label).toBe('正在上传录音');
    expect(shiyanStageUserStatus('transcribe', 'running').label).toBe('正在转写');
    expect(shiyanStageUserStatus('persist-transcript', 'running').label).toBe('正在转写');
    expect(shiyanStageUserStatus('organize', 'running').label).toBe('正在整理');
    expect(shiyanStageUserStatus('persist-ai-draft', 'running').label).toBe('正在整理');
    expect(shiyanStageUserStatus('review', 'pending').label).toBe('待你确认');
  });

  it('keeps the failure scoped to the current stage', () => {
    const value = task(stage());
    expect(shiyanTaskStatusText(value)).toBe('需要处理');
    expect(shiyanTaskUserStatus(value)).toEqual({ label: '需要处理', tone: 'error' });
    expect(stageFailureText(currentShiyanStage(value)!)).toBe('STT provider timed out');
  });

  it('exposes only stage retries backed by the Cloud contract', () => {
    expect(retryActionForStage(stage())).toBe('transcribe');
    expect(retryActionForStage(stage({ stage: 'organize' }))).toBe('organize');
    expect(retryActionForStage(stage({ stage: 'delivery' }))).toBeNull();
    expect(retryActionForStage(stage({ retryable: false }))).toBeNull();
  });

  it('describes what remains safe for a recoverable stage failure', () => {
    expect(shiyanStageRecoveryPresentation(stage())).toMatchObject({
      title: '转写遇到问题',
      supportingText: '原始录音仍然安全，可以只重新执行转写。',
      retryAction: 'transcribe',
      retryLabel: '重试转写',
    });
    expect(shiyanStageRecoveryPresentation(stage({ stage: 'organize' }))).toMatchObject({
      title: 'AI 整理遇到问题',
      supportingText: '原文已经保存，可以只重新整理，不需要重新转写。',
      retryAction: 'organize',
      retryLabel: '重试整理',
    });
    expect(shiyanStageRecoveryPresentation(stage({ stage: 'delivery' }))).toMatchObject({
      title: '投递未完成',
      retryAction: null,
    });
  });

  it('routes retryable upload failures through the existing local submission flow', () => {
    expect(shiyanStageRecoveryPresentation(stage({ stage: 'upload' }))).toMatchObject({
      title: '录音上传遇到问题',
      retryAction: 'resume-upload',
      retryLabel: '继续上传',
    });
    expect(shiyanStageRecoveryPresentation(stage({ stage: 'verify-audio' }))).toMatchObject({
      retryAction: 'resume-upload',
      retryLabel: '继续上传',
    });
  });

  it('does not promise retry when the failed stage is not retryable', () => {
    expect(shiyanStageRecoveryPresentation(stage({ retryable: false }))).toMatchObject({
      supportingText: '原始录音仍然安全；当前错误不支持直接重试，请查看处理详情。',
      retryAction: null,
      retryLabel: null,
    });
    expect(
      shiyanStageRecoveryPresentation(stage({ stage: 'organize', retryable: false })),
    ).toMatchObject({
      supportingText: '原文已经保存；当前错误不支持直接重试，请查看处理详情。',
      retryAction: null,
      retryLabel: null,
    });
    expect(
      shiyanStageRecoveryPresentation(stage({ stage: 'upload', retryable: false })),
    ).toMatchObject({
      supportingText: '上传没有完成；当前错误不支持直接重试，请查看处理详情。',
      retryAction: null,
      retryLabel: null,
    });
  });

  it('does not let ready/completed lifecycle hide a failed current stage', () => {
    expect(shiyanTaskStatusText({ ...task(stage()), lifecycle: 'ready' })).toBe('需要处理');
    expect(shiyanTaskStatusText({ ...task(stage()), lifecycle: 'completed' })).toBe('需要处理');
  });

  it('uses concise ready and completed labels when no stage is failed', () => {
    const succeeded = stage({ status: 'succeeded', retryable: false, errorCode: null, errorMessage: null });
    expect(shiyanTaskStatusText({ ...task(succeeded), lifecycle: 'ready' })).toBe('待你确认');
    expect(shiyanTaskStatusText({ ...task(succeeded), lifecycle: 'completed' })).toBe('已完成');
  });
});
