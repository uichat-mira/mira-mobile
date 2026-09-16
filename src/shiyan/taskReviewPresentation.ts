import type {
  ShiyanAdjustmentCandidate,
  ShiyanTaskContentView,
} from './client/contracts';

export type ShiyanReviewResultKind = 'final' | 'candidate' | 'ai';

export interface ShiyanReviewResult {
  kind: ShiyanReviewResultKind;
  markdown: string;
  label: string;
  supportingText: string;
}

export interface ShiyanFinalEditorSeed {
  markdown: string;
  baseVersion: number | null;
}

const nonEmpty = (value: string | null | undefined) => value?.trim() || null;

export function selectShiyanReviewResult(
  content: ShiyanTaskContentView | null,
  candidate: ShiyanAdjustmentCandidate | null,
): ShiyanReviewResult | null {
  const finalMarkdown = nonEmpty(content?.finalDraftMarkdown);
  if (finalMarkdown) {
    return {
      kind: 'final',
      markdown: finalMarkdown,
      label: '已确认最终稿',
      supportingText: '这是当前已保存的最终版本。',
    };
  }

  const candidateMarkdown = nonEmpty(candidate?.markdown);
  if (candidateMarkdown && candidate) {
    return {
      kind: 'candidate',
      markdown: candidateMarkdown,
      label: 'AI 调整候选',
      supportingText: '这是新的候选结果，保存前不会成为最终稿。',
    };
  }

  const aiDraftMarkdown = nonEmpty(content?.aiDraftMarkdown);
  if (aiDraftMarkdown) {
    return {
      kind: 'ai',
      markdown: aiDraftMarkdown,
      label: 'AI 整理稿',
      supportingText: '可以继续 AI 调整，也可以进入最终编辑。',
    };
  }

  return null;
}

export function selectShiyanFinalEditorSeed(
  content: ShiyanTaskContentView | null,
  candidate: ShiyanAdjustmentCandidate | null,
  preferCandidate = false,
): ShiyanFinalEditorSeed {
  if (preferCandidate && candidate?.markdown.trim()) {
    return {
      markdown: candidate.markdown,
      baseVersion: candidate.version,
    };
  }

  if (content?.finalDraftMarkdown?.trim()) {
    return {
      markdown: content.finalDraftMarkdown,
      baseVersion: content.finalDraftBaseVersion ?? content.aiDraftVersion ?? null,
    };
  }

  if (candidate?.markdown.trim()) {
    return {
      markdown: candidate.markdown,
      baseVersion: candidate.version,
    };
  }

  return {
    markdown: content?.aiDraftMarkdown ?? '',
    baseVersion: content?.aiDraftVersion ?? null,
  };
}
