import { miraHostClient } from '../api/miraHostClient';
import { useDesktopConnectionStore } from '../connectivity/desktopConnectionAuthority';
import { RemoteHostRuntime } from './remoteHostRuntime';

jest.mock('../api/miraHostClient', () => ({
  miraHostClient: {
    listSessions: jest.fn(),
    getMessages: jest.fn(),
    createSession: jest.fn(),
    sendMessage: jest.fn(),
    deleteSession: jest.fn(),
    cancelCurrentSend: jest.fn(),
  },
}));

const runtime = new RemoteHostRuntime();
const client = miraHostClient as unknown as {
  sendMessage: jest.Mock;
  deleteSession: jest.Mock;
};

describe('RemoteHostRuntime active transport gate', () => {
  beforeEach(() => {
    client.sendMessage.mockReset();
    client.deleteSession.mockReset();
    client.sendMessage.mockResolvedValue(
      (async function* () {
        yield 'reply';
      })(),
    );
    client.deleteSession.mockResolvedValue(undefined);
  });

  it('rejects new paired mutations while no Desktop transport is active', async () => {
    useDesktopConnectionStore.setState({ mode: 'none', hydrated: true });

    await expect(
      runtime.sendMessage('thread-1', 'hello'),
    ).rejects.toMatchObject({ code: 'DESKTOP_CONNECTION_INACTIVE' });
    await expect(runtime.deleteSession('thread-1')).rejects.toMatchObject({
      code: 'DESKTOP_CONNECTION_INACTIVE',
    });
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(client.deleteSession).not.toHaveBeenCalled();
  });

  it('rejects paired mutations while Cloud is the active transport', async () => {
    useDesktopConnectionStore.setState({ mode: 'cloud', hydrated: true });

    await expect(
      runtime.sendMessage('thread-1', 'hello'),
    ).rejects.toMatchObject({ code: 'DESKTOP_CONNECTION_INACTIVE' });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });

  it('allows paired mutations while Direct is active', async () => {
    useDesktopConnectionStore.setState({ mode: 'direct', hydrated: true });

    const events = await runtime.sendMessage('thread-1', 'hello', {
      messageId: 'stable',
    });
    const seen: unknown[] = [];
    for await (const event of events) seen.push(event);

    expect(client.sendMessage).toHaveBeenCalledWith(
      'thread-1',
      'hello',
      'stable',
    );
    expect(seen).toEqual([
      { type: 'text-delta', delta: 'reply' },
      { type: 'finish', reason: 'stop' },
    ]);
    await runtime.deleteSession('thread-1');
    expect(client.deleteSession).toHaveBeenCalledWith('thread-1');
  });
});
