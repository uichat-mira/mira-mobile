import { ConversationShareCoordinator } from './conversationShareCoordinator';
import type { ShareCardModel } from './shareCardModel';

const model: ShareCardModel = {
  title: 'Mira 对话',
  date: '2026.09.15',
  messages: [{ id: 'u1', role: 'user', content: '你好' }],
  totalCount: 1,
  truncated: false,
};

describe('ConversationShareCoordinator', () => {
  test('captures the branded card before opening platform share', async () => {
    const calls: string[] = [];
    const capture = jest.fn(async () => {
      calls.push('capture');
      return 'file:///tmp/card.png';
    });
    const sharePng = jest.fn(async () => {
      calls.push('share');
    });
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    await expect(coordinator.share(model)).resolves.toBe('shared');

    expect(calls).toEqual(['capture', 'share']);
    expect(capture).toHaveBeenCalledWith(model);
    expect(sharePng).toHaveBeenCalledWith('file:///tmp/card.png', 'Mira 对话');
    expect(coordinator.isActive).toBe(false);
  });

  test('rejects overlapping work without starting a second capture', async () => {
    let finishCapture: ((uri: string) => void) | undefined;
    const capture = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          finishCapture = resolve;
        }),
    );
    const sharePng = jest.fn(async () => undefined);
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    const first = coordinator.share(model);
    expect(coordinator.isActive).toBe(true);
    await expect(coordinator.share(model)).resolves.toBe('busy');
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

    await expect(coordinator.share(model)).rejects.toThrow('capture failed');
    expect(coordinator.isActive).toBe(false);
    await expect(coordinator.share(model)).resolves.toBe('shared');
    expect(capture).toHaveBeenCalledTimes(2);
  });

  test('recovers after platform share failure so the user can retry', async () => {
    const capture = jest.fn(async () => 'file:///tmp/card.png');
    const sharePng = jest
      .fn<Promise<void>, [string, string]>()
      .mockRejectedValueOnce(new Error('share failed'))
      .mockResolvedValueOnce(undefined);
    const coordinator = new ConversationShareCoordinator({ capture, sharePng });

    await expect(coordinator.share(model)).rejects.toThrow('share failed');
    expect(coordinator.isActive).toBe(false);
    await expect(coordinator.share(model)).resolves.toBe('shared');
    expect(sharePng).toHaveBeenCalledTimes(2);
  });
});
