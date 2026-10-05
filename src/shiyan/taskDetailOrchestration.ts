import type {
  ShiyanCaptureStageView,
  ShiyanCaptureTaskView,
  ShiyanTranscriptView,
} from './client/contracts';
import { retryActionForStage } from './taskPresentation';

/**
 * Transcript is a read-only evidence layer. A failed read keeps whatever
 * transcript was already loaded so the screen never downgrades good evidence to
 * an empty state just because a later poll failed.
 */
export type ShiyanTaskTranscriptState =
  | { status: 'not_ready'; value: null; message: null }
  | { status: 'ready'; value: ShiyanTranscriptView; message: null }
  | { status: 'error'; value: ShiyanTranscriptView | null; message: string };

export const EMPTY_SHIYAN_TRANSCRIPT: ShiyanTaskTranscriptState = {
  status: 'not_ready',
  value: null,
  message: null,
};

export const shiyanTranscriptReady = (
  value: ShiyanTranscriptView,
): ShiyanTaskTranscriptState => ({ status: 'ready', value, message: null });

export const shiyanTranscriptNotReady = (
  previous: ShiyanTaskTranscriptState,
): ShiyanTaskTranscriptState =>
  previous.value
    ? { status: 'ready', value: previous.value, message: null }
    : EMPTY_SHIYAN_TRANSCRIPT;

export const shiyanTranscriptFailure = (
  previous: ShiyanTaskTranscriptState,
  message: string,
): ShiyanTaskTranscriptState => ({
  status: 'error',
  value: previous.value,
  message,
});

/** The only stage retries the task-detail surface can trigger. */
export type ShiyanStageRetryTarget = 'transcribe' | 'organize';

export const resolveShiyanStageRetryTarget = (
  stage: ShiyanCaptureStageView,
): ShiyanStageRetryTarget | null => {
  const action = retryActionForStage(stage);
  return action === 'transcribe' || action === 'organize' ? action : null;
};

/**
 * Polling is only meaningful while the task is still active and its current
 * stage has not terminally failed. A failed stage needs an explicit retry, not
 * a background timer that keeps re-reading the same failure.
 */
export const shouldPollShiyanTask = (
  task: ShiyanCaptureTaskView | null,
  currentStage: ShiyanCaptureStageView | null,
): boolean =>
  task?.lifecycle === 'active' &&
  currentStage !== null &&
  currentStage.status !== 'failed';

/**
 * Builds the Final Draft save payload without ever sending a falsy title or a
 * base version of 0/null, which the save contract treats as "no expectation".
 */
export const buildShiyanFinalDraftSaveInput = (
  task: ShiyanCaptureTaskView | null,
  baseVersion: number | null,
): { title?: string; baseVersion?: number } => ({
  ...(task?.title ? { title: task.title } : {}),
  ...(baseVersion ? { baseVersion } : {}),
});
