import type { ChatMessage } from '../types';
import { ConversationShareCoordinator } from './conversationShareCoordinator';
import type { ShareCardModel } from './shareCardModel';

const messages: ChatMessage[] = [
  {
    id: 'u1',
    role: 'user',
    content: '你好',
    timestamp: new Date('2026-09-15T00:00:00Z'),
  },
  {
    id: 'a1',
    role: 'assistant',
    content: '你好，我是 Mira。',
    timestamp: new Date('2026-09-15T00:00:01Z'),
  },
];

describe('ConversationShareCoordinator', () => {
  test('builds the branded model, captures it, then opens platform share', async () => {
    const calls: string[] = [];
    const capture = jest.fn(async (model: ShareCardModel) => {
      calls.push('capture');
      expect(model.title).toBe('Mira 对话');
      expect(model.messages).toEqual([
        { id: 'u1', role: 'user', content: '你好' },
        { id: 'a1', role: 'assistant', content: '你好，我是 Mira。' },
      ]);
      return 'file:///tmp/card.png';
    });
    const sharePng = jest.fn(async () => {
      calls.push('share');
    });
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    await expect(coordinator.share(messages, 'Mira 对话')).resolves.toBe('shared');

    expect(calls).toEqual(['capture', 'share']);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(sharePng).toHaveBeenCalledWith('file:///tmp/card.png', 'Mira 对话');
    expect(coordinator.isActive).toBe(false);
  });

  test('returns empty without capture or platform share for an unshareable conversation', async () => {
    const capture = jest.fn(async () => 'file:///tmp/card.png');
    const sharePng = jest.fn(async () => undefined);
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });
    const emptyMessages: ChatMessage[] = [
      {
        id: 'system-1',
        role: 'system',
        content: 'hidden instruction',
        timestamp: new Date('2026-09-15T00:00:00Z'),
      },
    ];

    await expect(coordinator.share(emptyMessages, '空会话')).resolves.toBe('empty');
    expect(capture).not.toHaveBeenCalled();
    expect(sharePng).not.toHaveBeenCalled();
    expect(coordinator.isActive).toBe(false);
  });

  test('guards overlapping work without starting a second capture', async () => {
    let finishCapture: ((uri: string) => void) | undefined;
    const capture = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finishCapture = resolve;
        }),
    );
    const sharePng = jest.fn(async () => undefined);
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    const first = coordinator.share(messages, 'Mira 对话');
    expect(coordinator.isActive).toBe(true);
    await expect(coordinator.share(messages, 'Mira 对话')).resolves.toBe('busy');
    expect(capture).toHaveBeenCalledTimes(1);

    finishCapture?.('file:///tmp/card.png');
    await expect(first).resolves.toBe('shared');
    expect(sharePng).toHaveBeenCalledTimes(1);
    expect(coordinator.isActive).toBe(false);
  });

  test('recovers after capture failure so the user can retry', async () => {
    const capture = jest
      .fn<Promise<string>, [ShareCardModel]>()
      .mockRejectedValueOnce(new Error('capture failed'))
      .mockResolvedValueOnce('file:///tmp/card.png');
    const sharePng = jest.fn(async () => undefined);
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    await expect(coordinator.share(messages, 'Mira 对话')).rejects.toThrow(
      'capture failed',
    );
    expect(coordinator.isActive).toBe(false);
    await expect(coordinator.share(messages, 'Mira 对话')).resolves.toBe('shared');
    expect(capture).toHaveBeenCalledTimes(2);
  });

  test('recovers after platform share failure so the user can retry', async () => {
    const capture = jest.fn(async () => 'file:///tmp/card.png');
    const sharePng = jest
      .fn<Promise<void>, [string, string]>()
      .mockRejectedValueOnce(new Error('share failed'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    await expect(coordinator.share(messages, 'Mira 对话')).rejects.toThrow(
      'share failed',
    );
    expect(coordinator.isActive).toBe(false);
    await expect(coordinator.share(messages, 'Mira 对话')).resolves.toBe('shared');
    expect(sharePng).toHaveBeenCalledTimes(2);
  });
});
