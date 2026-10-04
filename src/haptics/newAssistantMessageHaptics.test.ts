import { Vibration, AppState } from 'react-native';
import type { ChatMessage } from '../types';
import type { RemoteMiraHostClient } from '../api/remoteMiraHost';
import { PairedRemoteMiraHostClient } from '../api/miraHostClient';
import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { LocalSessionRepository } from '../local/localSessionRepository';
import { LocalProviderRuntime } from '../runtime/localProviderRuntime';
import { ProviderConfigStore, type LocalProviderConfig } from '../provider/providerConfigStore';
import type { OpenAiCompatibleClient } from '../provider/openAiCompatibleClient';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import {
  AssistantMessageHapticsObserver,
  selectNewAssistantMessageIds,
} from './newAssistantMessageHaptics';

jest.mock('react-native', () => ({
  Vibration: { vibrate: jest.fn() },
  AppState: { currentState: 'active' },
}));

jest.mock('../screens/generalSettings', () => ({
  loadGeneralSettings: jest.fn(async () => ({ hapticsEnabled: true })),
}));

const { loadGeneralSettings } = jest.requireMock('../screens/generalSettings') as {
  loadGeneralSettings: jest.Mock;
};

const setAppState = (state: string) => {
  (AppState as { currentState: string }).currentState = state;
};

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const mainTime = 1700000000000;
const at = (offsetMs: number) => new Date(mainTime + offsetMs);

const config: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'chat-completions',
};

/**
 * Build a *real* Local runtime backed by the real session repository. A real
 * send appends the user message, streams the reply, and the runtime then writes
 * the canonical Assistant message into the repository — exactly the Local
 * arrival mechanism, not an array alias.
 */
const createLocalRuntime = async (replyText: string) => {
  const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
  await configStore.save([config]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(config.id, 'sk-test');
  const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    clientFactory: () =>
      ({
        cancelActiveRun: jest.fn(),
        streamChat: jest.fn(async () =>
          (async function* () {
            yield { type: 'text-delta' as const, delta: replyText };
            yield { type: 'finish' as const, reason: 'stop' };
          })(),
        ),
      } as unknown as OpenAiCompatibleClient),
  });
  return { runtime, repository };
};

/**
 * Build the *real* Remote Host client with a stubbed transport. Every canonical
 * `getMessages` republishes a snapshot to subscribers — the production Remote
 * arrival channel, not an array alias.
 */
const createRemoteClient = (
  getMessages: jest.Mock,
): { client: PairedRemoteMiraHostClient; setMessages: (messages: unknown[]) => void } => {
  let current: unknown[] = [];
  getMessages.mockImplementation(async () => current);
  const remote = {
    getMessages,
  } as unknown as RemoteMiraHostClient;
  const client = new PairedRemoteMiraHostClient(remote);
  return {
    client,
    setMessages: (messages: unknown[]) => {
      current = messages;
    },
  };
};

const remoteMessage = (
  id: string,
  role: 'user' | 'assistant' | 'tool' | 'system',
  content = id,
  createdAtMs = mainTime,
) => ({
  id,
  threadId: 'thread-1',
  role,
  content,
  parts: [{ type: 'text' as const, text: content }],
  createdAt: new Date(createdAtMs).toISOString(),
});

const message = (
  id: string,
  role: ChatMessage['role'],
  offsetMs = 0,
): ChatMessage => ({ id, role, content: id, timestamp: at(offsetMs) });

describe('selectNewAssistantMessageIds', () => {
  it('returns only newly-arrived assistant ids and ignores user/system messages', () => {
    const previous = [message('u1', 'user'), message('a1', 'assistant')];
    const next = [
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('a2', 'assistant'),
      message('s1', 'system'),
    ];

    expect(selectNewAssistantMessageIds(previous, next)).toEqual(['a2']);
  });
});

const makeObserver = () => {
  const vibrate = jest.fn();
  const observer = new AssistantMessageHapticsObserver({
    vibrate,
    readAppState: () => AppState.currentState,
  });
  return { observer, vibrate };
};

beforeEach(() => {
  jest.clearAllMocks();
  loadGeneralSettings.mockResolvedValue({ hapticsEnabled: true });
  setAppState('active');
  (Vibration.vibrate as jest.Mock).mockClear();
});

describe('AssistantMessageHapticsObserver — Local Provider real feed point', () => {
  it('vibrates exactly once when a real Local reply lands in canonical messages', async () => {
    const { runtime } = await createLocalRuntime('hello from local');
    const { observer, vibrate } = makeObserver();

    const session = await runtime.createSession('Local session', 'provider-a');
    // Baseline: opening the (empty) session history must never ring.
    observer.observe(await runtime.getMessages(session.id));
    await flush();
    expect(vibrate).not.toHaveBeenCalled();

    await drain(await runtime.sendMessage(session.id, 'ping'));

    // The canonical arrival is the post-send repository read, not the delta.
    const canonical = await runtime.getMessages(session.id);
    observer.observe(canonical);
    await flush();

    expect(canonical.some((m) => m.role === 'assistant')).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not vibrate again when the same Local reply is re-read', async () => {
    const { runtime } = await createLocalRuntime('hello again');
    const { observer, vibrate } = makeObserver();

    const session = await runtime.createSession('Local session', 'provider-a');
    observer.observe(await runtime.getMessages(session.id));
    await drain(await runtime.sendMessage(session.id, 'ping'));

    observer.observe(await runtime.getMessages(session.id));
    observer.observe(await runtime.getMessages(session.id));
    await flush();

    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not vibrate for token deltas / finish before the canonical message exists', async () => {
    const { runtime } = await createLocalRuntime('streamed only');
    const { observer, vibrate } = makeObserver();

    const session = await runtime.createSession('Local session', 'provider-a');
    observer.observe(await runtime.getMessages(session.id));

    // Only the user message is canonical while the stream is in flight.
    const stream = await runtime.sendMessage(session.id, 'ping');
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next(); // consume the text-delta
    expect((await runtime.getMessages(session.id)).some((m) => m.role === 'assistant')).toBe(false);
    await flush();
    expect(vibrate).not.toHaveBeenCalled();

    await iterator.return?.(undefined);
  });
});

describe('AssistantMessageHapticsObserver — Remote Host real feed point', () => {
  it('vibrates exactly once when a Remote reply lands through a real snapshot', async () => {
    const getMessages = jest.fn();
    const { client, setMessages } = createRemoteClient(getMessages);
    const { observer, vibrate } = makeObserver();

    const unsubscribe = client.subscribeMessageSnapshots((snapshot) => {
      observer.observe(snapshot.messages);
    });

    // Baseline snapshot (history) must not ring.
    setMessages([remoteMessage('u1', 'user')]);
    await client.getMessages('thread-1');
    await flush();
    expect(vibrate).not.toHaveBeenCalled();

    // A canonical Assistant reply arrives; the canonical read republishes it.
    setMessages([
      remoteMessage('u1', 'user'),
      remoteMessage('a1', 'assistant', 'hi from host', 1000),
    ]);
    await client.getMessages('thread-1');
    await flush();

    expect(vibrate).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not vibrate again when Remote republishes the same message via refresh', async () => {
    const getMessages = jest.fn();
    const { client, setMessages } = createRemoteClient(getMessages);
    const { observer, vibrate } = makeObserver();
    client.subscribeMessageSnapshots((snapshot) => observer.observe(snapshot.messages));

    setMessages([remoteMessage('u1', 'user')]);
    await client.getMessages('thread-1');
    setMessages([
      remoteMessage('u1', 'user'),
      remoteMessage('a1', 'assistant', 'hi from host', 1000),
    ]);
    await client.getMessages('thread-1');
    // Repeated snapshots / discovery-poll refreshes of the identical canonical set.
    await client.getMessages('thread-1');
    await client.getMessages('thread-1');
    await flush();

    expect(vibrate).toHaveBeenCalledTimes(1);
  });

  it('ignores snapshots for other sessions', async () => {
    const getMessages = jest.fn();
    const { client, setMessages } = createRemoteClient(getMessages);
    const { observer, vibrate } = makeObserver();
    client.subscribeMessageSnapshots((snapshot) => {
      if (snapshot.sessionId !== 'thread-1') return;
      observer.observe(snapshot.messages);
    });

    setMessages([remoteMessage('u1', 'user')]);
    await client.getMessages('thread-1');
    setMessages([
      remoteMessage('u1', 'user'),
      remoteMessage('a1', 'assistant'),
    ]);
    await client.getMessages('thread-other');
    await flush();

    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('AssistantMessageHapticsObserver — contract', () => {
  it('fires once per new Assistant message, not once per batch', () => {
    const { observer, vibrate } = makeObserver();

    observer.observe([message('u1', 'user')]);
    const fired = observer.observe([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('a2', 'assistant', 1000),
      message('a3', 'assistant', 2000),
    ]);

    expect(fired).toEqual(['a1', 'a2', 'a3']);
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  it('does not vibrate for user messages only', () => {
    const { observer, vibrate } = makeObserver();

    observer.observe([]);
    observer.observe([message('u1', 'user')]);

    expect(vibrate).not.toHaveBeenCalled();
  });

  it('never vibrates on the baseline history read', () => {
    const { observer, vibrate } = makeObserver();

    observer.observe([message('u1', 'user'), message('a1', 'assistant'), message('a2', 'assistant')]);

    expect(vibrate).not.toHaveBeenCalled();
  });

  it('does not vibrate while backgrounded or inactive', () => {
    const { observer, vibrate } = makeObserver();

    observer.observe([message('u1', 'user')]);
    setAppState('background');
    observer.observe([message('u1', 'user'), message('a1', 'assistant')]);
    expect(vibrate).not.toHaveBeenCalled();

    setAppState('inactive');
    observer.observe([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('a2', 'assistant', 1000),
    ]);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('uses the real Vibration path and respects hapticsEnabled', async () => {
    loadGeneralSettings.mockResolvedValue({ hapticsEnabled: false });
    const disabled = new AssistantMessageHapticsObserver();
    disabled.observe([message('u1', 'user')]);
    disabled.observe([message('u1', 'user'), message('a1', 'assistant')]);
    await flush();
    expect(Vibration.vibrate).not.toHaveBeenCalled();

    loadGeneralSettings.mockResolvedValue({ hapticsEnabled: true });
    const enabled = new AssistantMessageHapticsObserver();
    enabled.observe([message('u1', 'user')]);
    enabled.observe([message('u1', 'user'), message('a1', 'assistant')]);
    await flush();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });
});

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ignored of stream) {
    void _ignored;
  }
}
