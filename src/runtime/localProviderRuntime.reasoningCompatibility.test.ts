import { LocalSessionRepository } from '../local/localSessionRepository';
import type { OpenAiCompatibleClient } from '../provider/openAiCompatibleClient';
import {
  ProviderConfigStore,
  type LocalProviderConfig,
} from '../provider/providerConfigStore';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import type { RuntimeEvent } from './conversationRuntime';
import { LocalProviderRuntime } from './localProviderRuntime';

const collect = async (stream: AsyncIterable<RuntimeEvent>) => {
  const events: RuntimeEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createRuntime = async (
  config: LocalProviderConfig,
  providerEvents: RuntimeEvent[],
) => {
  const configStore = new ProviderConfigStore(new MemoryLocalKeyValueStore());
  await configStore.save([config]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(config.id, 'sk-test');
  const repository = new LocalSessionRepository(new MemoryLocalKeyValueStore());
  const client = {
    cancelActiveRun: jest.fn(),
    streamChat: jest.fn(async () =>
      (async function* () {
        for (const event of providerEvents) yield event;
      })(),
    ),
  } as unknown as OpenAiCompatibleClient;
  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    clientFactory: () => client,
  });
  const session = await runtime.createSession('Compatibility test', config.id);
  return { runtime, repository, session };
};

const baseConfig: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider.example.com',
  model: 'model-a',
  protocol: 'chat-completions',
};

describe('LocalProviderRuntime reasoning-tag compatibility', () => {
  it('filters split reasoning tags before runtime events and persisted history', async () => {
    const { runtime, repository, session } = await createRuntime(
      {
        ...baseConfig,
        compatibility: { reasoningTags: 'strip' },
      },
      [
        { type: 'text-delta', delta: '<th' },
        { type: 'text-delta', delta: 'ink>hidden' },
        { type: 'text-delta', delta: '</thi' },
        { type: 'text-delta', delta: 'nk>visible' },
        { type: 'finish', reason: 'stop' },
      ],
    );

    const stream = await runtime.sendMessage(session.id, 'hello');

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: 'visible' },
      { type: 'finish', reason: 'stop' },
    ]);
    await expect(repository.getMessages(session.id)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'hello' }),
      expect.objectContaining({ role: 'assistant', content: 'visible' }),
    ]);
  });

  it('preserves literal reasoning markup when compatibility is disabled', async () => {
    const literal = '<think>example for the user</think>';
    const { runtime, repository, session } = await createRuntime(baseConfig, [
      { type: 'text-delta', delta: literal },
      { type: 'finish', reason: 'stop' },
    ]);

    const stream = await runtime.sendMessage(session.id, 'show the tag');

    await expect(collect(stream)).resolves.toEqual([
      { type: 'text-delta', delta: literal },
      { type: 'finish', reason: 'stop' },
    ]);
    await expect(repository.getMessages(session.id)).resolves.toEqual([
      expect.objectContaining({ role: 'user', content: 'show the tag' }),
      expect.objectContaining({ role: 'assistant', content: literal }),
    ]);
  });
});
