import { LocalSessionRepository } from '../local/localSessionRepository';
import {
  FakeXhr,
  HangingXhr,
  sse,
} from '../provider/openAiStandardClientTestSupport';
import { OpenAiStandardClient } from '../provider/openAiStandardClient';
import {
  ProviderConfigStore,
  type LocalProviderConfig,
} from '../provider/providerConfigStore';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { LocalProviderModelSelectionError } from './localProviderModelSelection';
import {
  LocalProviderRuntime,
  type LocalProviderRuntimeOptions,
} from './localProviderRuntime';

const providerA: LocalProviderConfig = {
  id: 'provider-a',
  name: 'Provider A',
  baseUrl: 'https://provider-a.example.com',
  model: 'model-a',
  protocol: 'openai-chat-completions',
};

const providerB: LocalProviderConfig = {
  id: 'provider-b',
  name: 'Provider B',
  baseUrl: 'https://provider-b.example.com/v1',
  model: 'model-b',
  protocol: 'openai-chat-completions',
};

const textFixture = (text: string) =>
  sse(
    { choices: [{ delta: { content: text } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    '[DONE]',
  );

const toolCallFixture = sse(
  {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call-1',
          function: { name: 'search', arguments: '{"q":' },
        }],
      },
    }],
  },
  {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          function: { arguments: '"mira"}' },
        }],
      },
    }],
  },
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  '[DONE]',
);

const drain = async (stream: AsyncIterable<unknown>) => {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
};

const createContext = async (configs: readonly LocalProviderConfig[] = [
  providerA,
  providerB,
]) => {
  const storage = new MemoryLocalKeyValueStore();
  const configStore = new ProviderConfigStore(storage);
  await configStore.save(configs);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save(providerA.id, 'sk-a');
  await credentialStore.save(providerB.id, 'sk-b');
  const repository = new LocalSessionRepository(storage);
  return { storage, configStore, credentialStore, repository };
};

const createRuntime = (
  context: Awaited<ReturnType<typeof createContext>>,
  options: Omit<
    LocalProviderRuntimeOptions,
    'configStore' | 'credentialStore' | 'sessionRepository'
  > = {},
) =>
  new LocalProviderRuntime({
    configStore: context.configStore,
    credentialStore: context.credentialStore,
    sessionRepository: context.repository,
    loadGlobalAgentStrength: async () => 'plain',
    ...options,
  });

const createFixtureRuntime = (
  context: Awaited<ReturnType<typeof createContext>>,
  fixtures: readonly string[],
  options: Omit<
    LocalProviderRuntimeOptions,
    'configStore' | 'credentialStore' | 'sessionRepository' | 'clientFactory'
  > = {},
) => {
  const requests: FakeXhr[] = [];
  let fixtureIndex = 0;
  const runtime = createRuntime(context, {
    ...options,
    clientFactory: (config, apiKey) =>
      new OpenAiStandardClient({
        baseUrl: config.baseUrl,
        apiKey,
        protocol: config.protocol,
        xhrFactory: () => {
          const fixture = fixtures[fixtureIndex];
          fixtureIndex += 1;
          if (fixture === undefined) {
            throw new Error('Unexpected extra Provider request');
          }
          const xhr = new FakeXhr(fixture);
          requests.push(xhr);
          return xhr as unknown as XMLHttpRequest;
        },
      }),
  });
  return { runtime, requests };
};

describe('LocalProviderRuntime model selection', () => {
  it('lists configured Provider/model pairs and persists the conversation selection', async () => {
    const context = await createContext();
    const runtime = createRuntime(context);
    const session = await runtime.createSession('Switch me', providerA.id);
    const other = await runtime.createSession('Other thread', providerA.id);
    await context.repository.appendMessages(session.id, [
      {
        id: 'user-1',
        role: 'user',
        content: 'history stays',
        timestamp: new Date('2026-11-24T00:00:00Z'),
      },
    ]);
    await runtime.setAgentStrength(session.id, 'deep');

    await expect(runtime.listLocalProviderModels(session.id)).resolves.toEqual([
      expect.objectContaining({
        providerId: providerA.id,
        providerName: 'Provider A',
        model: 'model-a',
        selected: true,
      }),
      expect.objectContaining({
        providerId: providerB.id,
        providerName: 'Provider B',
        model: 'model-b',
        selected: false,
      }),
    ]);
    await expect(runtime.getSelectedLocalProviderModel(session.id)).resolves.toMatchObject({
      providerId: providerA.id,
      selected: true,
    });

    await expect(
      runtime.selectLocalProviderModel(session.id, providerB.id),
    ).resolves.toEqual(
      expect.objectContaining({
        providerId: providerB.id,
        model: 'model-b',
        selected: true,
      }),
    );

    await expect(context.repository.get(session.id)).resolves.toMatchObject({
      id: session.id,
      title: 'Switch me',
    });
    await expect(context.repository.getMessages(session.id)).resolves.toMatchObject([
      { id: 'user-1', content: 'history stays' },
    ]);
    await expect(context.repository.getAgentStrengthOverride(session.id)).resolves.toBe('deep');
    await expect(context.repository.getProviderId(other.id)).resolves.toBe(providerA.id);
    await expect(runtime.getSelectedLocalProviderModel(other.id)).resolves.toMatchObject({
      providerId: providerA.id,
    });
    await expect(context.configStore.load()).resolves.toEqual([
      providerA,
      providerB,
    ]);

    const restarted = createRuntime(context);
    await expect(restarted.getSelectedLocalProviderModel(session.id)).resolves.toMatchObject({
      providerId: providerB.id,
      model: 'model-b',
    });
    await expect(restarted.listLocalProviderModels(session.id)).resolves.toEqual([
      expect.objectContaining({ providerId: providerA.id, selected: false }),
      expect.objectContaining({ providerId: providerB.id, selected: true }),
    ]);
  });

  it('serializes concurrent selections so the latest request wins deterministically', async () => {
    const context = await createContext();
    const runtime = createRuntime(context);
    const session = await runtime.createSession('Concurrent switch', providerA.id);

    await Promise.all([
      runtime.selectLocalProviderModel(session.id, providerB.id),
      runtime.selectLocalProviderModel(session.id, providerA.id),
    ]);

    await expect(context.repository.getProviderId(session.id)).resolves.toBe(
      providerA.id,
    );
    await expect(runtime.getSelectedLocalProviderModel(session.id)).resolves.toMatchObject({
      providerId: providerA.id,
      selected: true,
    });
  });

  it('uses the selected endpoint, model, and credential on the next real chat request', async () => {
    const context = await createContext();
    const first = createFixtureRuntime(context, [textFixture('reply-b')]);
    const session = await first.runtime.createSession('Chat', providerA.id);
    await first.runtime.selectLocalProviderModel(session.id, providerB.id);

    await expect(
      drain(await first.runtime.sendMessage(session.id, 'hello')),
    ).resolves.toEqual([
      { type: 'text-delta', delta: 'reply-b' },
      { type: 'finish', reason: 'stop' },
    ]);

    expect(first.requests).toHaveLength(1);
    expect(first.requests[0].requestUrl).toBe(
      'https://provider-b.example.com/v1/chat/completions',
    );
    expect(JSON.parse(first.requests[0].requestBody ?? '{}')).toMatchObject({
      model: 'model-b',
      stream: true,
    });
    expect(first.requests[0].headers.Authorization).toBe('Bearer sk-b');
    await expect(context.repository.getMessages(session.id)).resolves.toMatchObject([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'reply-b' },
    ]);

    // A restarted runtime resolves the same persisted selection rather than the
    // global/first configured Provider.
    const second = createFixtureRuntime(context, [textFixture('reply-b-again')]);
    await drain(await second.runtime.sendMessage(session.id, 'again'));
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0].requestUrl).toBe(
      'https://provider-b.example.com/v1/chat/completions',
    );
    expect(JSON.parse(second.requests[0].requestBody ?? '{}')).toMatchObject({
      model: 'model-b',
    });
    expect(second.requests[0].headers.Authorization).toBe('Bearer sk-b');
  });

  it('keeps Pi Core Agent model rounds on the selected Provider and model', async () => {
    const context = await createContext();
    const { runtime, requests } = createFixtureRuntime(
      context,
      [toolCallFixture, textFixture('agent-b-done')],
      {
        loadGlobalAgentStrength: async () => 'standard',
        toolGateway: {
          listTools: async () => [{
            name: 'search',
            description: 'Search',
            parameters: { type: 'object' },
          }],
          callTool: async () => ({ content: '{"result":"ok"}' }),
        },
      },
    );
    const session = await runtime.createSession('Agent', providerA.id);
    await runtime.selectLocalProviderModel(session.id, providerB.id);

    const events = await drain(
      await runtime.sendMessage(session.id, 'find'),
    );

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool-result', callId: 'call-1' }),
      { type: 'text-delta', delta: 'agent-b-done' },
    ]));
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.requestUrl).toBe(
        'https://provider-b.example.com/v1/chat/completions',
      );
      expect(JSON.parse(request.requestBody ?? '{}')).toMatchObject({
        model: 'model-b',
      });
      expect(request.headers.Authorization).toBe('Bearer sk-b');
    }
  });

  it('refuses to switch while a run is active and leaves the selection unchanged', async () => {
    const context = await createContext();
    const requests: HangingXhr[] = [];
    const runtime = createRuntime(context, {
      clientFactory: (config, apiKey) =>
        new OpenAiStandardClient({
          baseUrl: config.baseUrl,
          apiKey,
          protocol: config.protocol,
          xhrFactory: () => {
            const xhr = new HangingXhr();
            requests.push(xhr);
            return xhr as unknown as XMLHttpRequest;
          },
        }),
    });
    const session = await runtime.createSession('Running', providerA.id);
    await runtime.selectLocalProviderModel(session.id, providerB.id);
    await runtime.selectLocalProviderModel(session.id, providerA.id);
    const stream = await runtime.sendMessage(session.id, 'hello');
    const iterator = stream[Symbol.asyncIterator]();
    const pending = iterator.next().then(
      (result) => result,
      (error: unknown) => error,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await expect(
      runtime.selectLocalProviderModel(session.id, providerB.id),
    ).rejects.toMatchObject({
      code: 'LOCAL_PROVIDER_MODEL_SELECTION_FAILED',
      reason: 'run-active',
    });
    await expect(context.repository.getProviderId(session.id)).resolves.toBe(
      providerA.id,
    );

    runtime.cancelActiveRun();
    await expect(pending).resolves.toMatchObject({ code: 'REQUEST_ABORTED' });
    expect(requests[0].aborted).toBe(true);
  });

  it('refuses to switch under a prepared send that has not started', async () => {
    const context = await createContext();
    const { runtime } = createFixtureRuntime(context, [textFixture('unused')]);
    const session = await runtime.createSession('Prepared', providerA.id);
    await runtime.sendMessage(session.id, 'hello');

    await expect(
      runtime.selectLocalProviderModel(session.id, providerB.id),
    ).rejects.toMatchObject({ reason: 'run-active' });
    await expect(context.repository.getProviderId(session.id)).resolves.toBe(
      providerA.id,
    );

    runtime.cancelActiveRun();
    await expect(
      runtime.selectLocalProviderModel(session.id, providerB.id),
    ).resolves.toMatchObject({ providerId: providerB.id, selected: true });
  });

  it('reports missing, unavailable, and credential-less selections without falling back', async () => {
    const unavailable: LocalProviderConfig = {
      id: 'provider-c',
      name: 'Needs review',
      baseUrl: 'http://provider-c.example.com',
      model: 'model-c',
      protocol: 'openai-chat-completions',
      requiresStandardProtocolReview: true,
    };
    const context = await createContext([providerA, providerB, unavailable]);
    const runtime = createRuntime(context);
    const session = await runtime.createSession('Validate', providerA.id);

    await expect(
      runtime.selectLocalProviderModel(session.id, 'provider-missing'),
    ).rejects.toBeInstanceOf(LocalProviderModelSelectionError);
    await expect(
      runtime.selectLocalProviderModel(session.id, 'provider-missing'),
    ).rejects.toMatchObject({ reason: 'provider-missing' });
    await expect(
      runtime.selectLocalProviderModel(session.id, unavailable.id),
    ).rejects.toMatchObject({ reason: 'provider-unavailable' });

    await context.credentialStore.clear(providerB.id);
    await expect(
      runtime.selectLocalProviderModel(session.id, providerB.id),
    ).rejects.toMatchObject({ reason: 'credential-missing' });

    await context.configStore.remove(providerB.id);
    await expect(
      runtime.selectLocalProviderModel(session.id, providerB.id),
    ).rejects.toMatchObject({ reason: 'provider-missing' });

    await expect(context.repository.getProviderId(session.id)).resolves.toBe(
      providerA.id,
    );
  });

  it('rechecks deletion scope when a concurrent model switch changes Provider ownership', async () => {
    const context = await createContext();
    const runtime = createRuntime(context, {
      stageSessionReferenceRemoval: async () => ({
        commit: jest.fn(),
        rollback: jest.fn(async () => undefined),
      }),
    });
    const session = await runtime.createSession('Keep this thread', providerA.id);
    await runtime.setAgentStrength(session.id, 'deep');
    await context.repository.appendMessages(session.id, [{
      id: 'user-race', role: 'user', content: 'keep history', timestamp: new Date(),
    }]);
    let entered!: () => void;
    const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const load = context.credentialStore.load.bind(context.credentialStore);
    jest.spyOn(context.credentialStore, 'load').mockImplementationOnce(async (id) => {
      entered();
      await gate;
      return load(id);
    });
    const switching = runtime.selectLocalProviderModel(session.id, providerB.id);
    await enteredPromise;
    const deleting = runtime.deleteProvider(providerB.id, 0);
    const deletionAssertion = expect(deleting).rejects.toMatchObject({
      name: 'LocalProviderDeletionScopeChangedError',
    });
    release();
    await expect(switching).resolves.toMatchObject({ providerId: providerB.id });
    await deletionAssertion;
    await expect(context.repository.getProviderId(session.id)).resolves.toBe(providerB.id);
    await expect(context.repository.getAgentStrengthOverride(session.id)).resolves.toBe('deep');
    await expect(context.repository.getMessages(session.id)).resolves.toMatchObject([
      { id: 'user-race', content: 'keep history' },
    ]);
    await expect(context.credentialStore.load(providerB.id)).resolves.toBe('sk-b');
  });

  it('moves Provider deletion ownership with the conversation selection', async () => {
    const context = await createContext();
    const runtime = createRuntime(context, {
      stageSessionReferenceRemoval: async () => ({
        commit: jest.fn(),
        rollback: jest.fn(async () => undefined),
      }),
    });
    const switched = await runtime.createSession('Switched', providerA.id);
    const staysWithA = await runtime.createSession('Stays with A', providerA.id);
    await runtime.selectLocalProviderModel(switched.id, providerB.id);

    await expect(runtime.deleteProvider(providerA.id, 1)).resolves.toMatchObject({
      sessionCount: 1,
      deletedSessionIds: [staysWithA.id],
    });
    await expect(context.repository.getProviderId(switched.id)).resolves.toBe(
      providerB.id,
    );

    await expect(runtime.deleteProvider(providerB.id, 1)).resolves.toMatchObject({
      sessionCount: 1,
      deletedSessionIds: [switched.id],
    });
    await expect(context.repository.get(switched.id)).rejects.toThrow('not found');
  });
});
