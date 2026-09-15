import type { ChatMessage } from '../types';
import {
  buildShareCardModel,
  MAX_SHARE_CARD_MESSAGE_CHARS,
  MAX_SHARE_CARD_MESSAGES,
} from './shareCardModel';

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

describe('buildShareCardModel', () => {
  it('keeps user and assistant order while filtering system and empty messages', () => {
    const model = buildShareCardModel(
      [
        message('system-1', 'system', 'internal'),
        message('user-1', 'user', '  帮我写快速排序  '),
        message('assistant-1', 'assistant', '核心是分区'),
        message('system-2', 'system', 'tool output'),
        message('user-empty', 'user', '   '),
      ],
      '算法对话',
      new Date('2026-09-08T08:00:00Z'),
    );

    expect(model).toEqual({
      title: '算法对话',
      date: '2026.09.08',
      messages: [
        { id: 'user-1', role: 'user', content: '帮我写快速排序' },
        { id: 'assistant-1', role: 'assistant', content: '核心是分区' },
      ],
      totalCount: 2,
      truncated: false,
    });
  });

  it('falls back to assistant text parts when canonical content is empty', () => {
    const assistant: ChatMessage = {
      ...message('assistant-1', 'assistant', '   '),
      parts: [
        { type: 'text', text: '  第一段  ' },
        { type: 'text', text: '第二段' },
      ],
    };

    const model = buildShareCardModel(
      [message('user-1', 'user', '问题'), assistant],
      undefined,
      new Date('2026-09-08T08:00:00Z'),
    );

    expect(model?.messages).toEqual([
      { id: 'user-1', role: 'user', content: '问题' },
      { id: 'assistant-1', role: 'assistant', content: '第一段  \n第二段' },
    ]);
  });

  it('returns null when there is nothing shareable', () => {
    expect(
      buildShareCardModel([message('system-1', 'system', 'internal')], '标题'),
    ).toBeNull();
    expect(buildShareCardModel([], '标题')).toBeNull();
  });

  it('derives the title from the first user message when no title is given', () => {
    const model = buildShareCardModel(
      [
        message('assistant-1', 'assistant', '你好'),
        message('user-1', 'user', '  帮我写一个\n快速排序算法，并解释复杂度  '),
      ],
      undefined,
      new Date('2026-09-08T08:00:00Z'),
    );

    expect(model?.title).toBe('帮我写一个 快速排序算法，并解释复杂度');
  });

  it('caps the card at the first MAX_SHARE_CARD_MESSAGES messages', () => {
    const messages = Array.from({ length: MAX_SHARE_CARD_MESSAGES + 7 }, (_, index) =>
      message(`m-${index}`, index % 2 === 0 ? 'user' : 'assistant', `消息 ${index}`),
    );

    const model = buildShareCardModel(
      messages,
      undefined,
      new Date('2026-09-08T08:00:00Z'),
    );

    expect(model?.messages).toHaveLength(MAX_SHARE_CARD_MESSAGES);
    expect(model?.messages[0]?.id).toBe('m-0');
    expect(model?.totalCount).toBe(MAX_SHARE_CARD_MESSAGES + 7);
    expect(model?.truncated).toBe(true);
  });

  it('caps an oversized message within the limit and preserves emoji boundaries', () => {
    const prefix = '长'.repeat(MAX_SHARE_CARD_MESSAGE_CHARS - 2);
    const model = buildShareCardModel(
      [message('user-1', 'user', `${prefix}😀后续内容`)],
      '标题',
      new Date('2026-09-08T08:00:00Z'),
    );

    const content = model?.messages[0]?.content ?? '';
    expect(content).toBe(`${prefix}😀…`);
    expect(Array.from(content)).toHaveLength(MAX_SHARE_CARD_MESSAGE_CHARS);
    expect(content).not.toContain('\uFFFD');
    expect(model?.truncated).toBe(false);
  });

  it('truncates a long explicit title within thirty characters without splitting emoji', () => {
    const prefix = '标'.repeat(28);
    const model = buildShareCardModel(
      [message('user-1', 'user', 'hello')],
      `${prefix}😀后续标题`,
      new Date('2026-09-08T08:00:00Z'),
    );

    expect(model?.title).toBe(`${prefix}😀…`);
    expect(Array.from(model?.title ?? '')).toHaveLength(30);
  });
});
