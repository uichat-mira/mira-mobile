import type { ChatMessage } from '../types';
import { MAX_SHARE_CARD_MESSAGES } from './shareCardModel';
import {
  buildShareSelectionRows,
  countSelected,
  defaultShareSelection,
  selectedExceedsCardCap,
  selectedShareMessageIds,
  toggleShareSelection,
} from './shareSelection';

const message = (
  id: string,
  role: ChatMessage['role'],
  content: string,
): ChatMessage => ({
  id,
  role,
  content,
  timestamp: new Date('2026-09-08T08:00:00Z'),
});

describe('share selection', () => {
  it('offers user and assistant messages in order and drops system/empty ones', () => {
    const rows = buildShareSelectionRows([
      message('s-1', 'system', 'internal'),
      message('u-1', 'user', '  问题一  '),
      message('a-1', 'assistant', '回答一'),
      message('u-empty', 'user', '   '),
    ]);

    expect(rows).toEqual([
      { id: 'u-1', role: 'user', content: '问题一' },
      { id: 'a-1', role: 'assistant', content: '回答一' },
    ]);
  });

  it('falls back to assistant text parts for the preview when content is empty', () => {
    const assistant: ChatMessage = {
      ...message('a-1', 'assistant', '   '),
      parts: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    };

    expect(buildShareSelectionRows([assistant])).toEqual([
      { id: 'a-1', role: 'assistant', content: '第一段\n第二段' },
    ]);
  });

  it('defaults to every offered message selected', () => {
    const rows = buildShareSelectionRows([
      message('u-1', 'user', 'a'),
      message('a-1', 'assistant', 'b'),
    ]);

    expect([...defaultShareSelection(rows)]).toEqual(['u-1', 'a-1']);
  });

  it('toggles a single message without touching the others', () => {
    const rows = buildShareSelectionRows([
      message('u-1', 'user', 'a'),
      message('a-1', 'assistant', 'b'),
    ]);

    const removed = toggleShareSelection(defaultShareSelection(rows), 'u-1');
    expect(removed.has('u-1')).toBe(false);
    expect(removed.has('a-1')).toBe(true);

    const restored = toggleShareSelection(removed, 'u-1');
    expect(restored.has('u-1')).toBe(true);
  });

  it('returns selected ids in conversation order, not click order', () => {
    const rows = buildShareSelectionRows([
      message('u-1', 'user', 'a'),
      message('a-1', 'assistant', 'b'),
      message('u-2', 'user', 'c'),
    ]);

    const selected = new Set(['u-2', 'u-1']);
    expect(selectedShareMessageIds(rows, selected)).toEqual(['u-1', 'u-2']);
    expect(countSelected(rows, selected)).toBe(2);
  });

  it('flags a selection that exceeds the card cap', () => {
    const many = Array.from({ length: MAX_SHARE_CARD_MESSAGES + 1 }, (_, index) =>
      message(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', `内容 ${index}`),
    );
    const rows = buildShareSelectionRows(many);
    expect(selectedExceedsCardCap(rows, defaultShareSelection(rows))).toBe(true);

    const within = buildShareSelectionRows(many.slice(0, MAX_SHARE_CARD_MESSAGES));
    expect(selectedExceedsCardCap(within, defaultShareSelection(within))).toBe(false);
  });
});
