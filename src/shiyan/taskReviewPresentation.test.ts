import type {
  ShiyanAdjustmentCandidate,
  ShiyanTaskContentView,
} from './client/contracts';
import {
  selectShiyanFinalEditorSeed,
  selectShiyanReviewResult,
} from './taskReviewPresentation';

const content = (
  overrides: Partial<ShiyanTaskContentView> = {},
): ShiyanTaskContentView => ({
  aiDraftMarkdown: 'AI draft',
  aiDraftVersion: 3,
  finalDraftMarkdown: null,
  finalDraftBaseVersion: null,
  canonicalDestinationUrl: null,
  ...overrides,
});

const candidate = (
  overrides: Partial<ShiyanAdjustmentCandidate> = {},
): ShiyanAdjustmentCandidate => ({
  markdown: 'Candidate draft',
  version: 4,
  createdAt: '2026-09-02T00:00:00.000Z',
  ...overrides,
});

describe('MOB-032 result-first review presentation', () => {
  it('shows Final Draft ahead of a newer adjustment candidate', () => {
    const result = selectShiyanReviewResult(
      content({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
      candidate(),
    );

    expect(result).toMatchObject({
      kind: 'final',
      markdown: 'Human final',
      label: '已确认最终稿',
    });
  });

  it('shows the adjustment candidate when no Final Draft exists', () => {
    expect(selectShiyanReviewResult(content(), candidate())).toMatchObject({
      kind: 'candidate',
      markdown: 'Candidate draft',
    });
  });

  it('falls back to the AI organized draft and never fabricates a result', () => {
    expect(selectShiyanReviewResult(content(), null)).toMatchObject({
      kind: 'ai',
      markdown: 'AI draft',
    });
    expect(
      selectShiyanReviewResult(
        content({ aiDraftMarkdown: null, aiDraftVersion: null }),
        null,
      ),
    ).toBeNull();
  });

  it('keeps existing Final Draft as the normal editor base', () => {
    expect(
      selectShiyanFinalEditorSeed(
        content({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
        candidate(),
      ),
    ).toEqual({ markdown: 'Human final', baseVersion: 3 });
  });

  it('only adopts a candidate into editing after an explicit user choice', () => {
    expect(
      selectShiyanFinalEditorSeed(
        content({ finalDraftMarkdown: 'Human final', finalDraftBaseVersion: 3 }),
        candidate(),
        true,
      ),
    ).toEqual({ markdown: 'Candidate draft', baseVersion: 4 });
  });
});
