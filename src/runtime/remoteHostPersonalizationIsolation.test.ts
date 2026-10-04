import { DEFAULT_PERSONALIZATION_SETTINGS } from '../screens/personalizationSettings';
import { buildLocalPersonalizationContext } from './localPersonalizationContext';
import { PairedRemoteMiraHostClient } from '../api/miraHostClient';

// MOB-049 negative contract: Mobile Personalization must never reach the
// Remote Host path. The Remote Host runtime and miraHostClient do not import
// the personalization compiler, so the request payload must be identical
// regardless of the local Personalization settings.

const stream = () => ({
  abort: jest.fn(),
  events: (async function* () {
    yield { type: 'finish', finishReason: 'stop' };
  })(),
});

const makeRemoteClient = () => {
  const sendMessage = jest.fn().mockResolvedValue(stream());
  const getMessages = jest.fn().mockResolvedValue([]);
  const remote = { getMessages, sendMessage } as never;
  return { client: new PairedRemoteMiraHostClient(remote), sendMessage };
};

const collect = async (value: AsyncIterable<string>) => {
  const chunks: string[] = [];
  for await (const chunk of value) chunks.push(chunk);
  return chunks.join('');
};

describe('MOB-049 Remote Host personalization isolation', () => {
  it('sends an identical Remote Host payload with and without Mobile Personalization', async () => {
    const withoutPersonalization = makeRemoteClient();
    await collect(
      await withoutPersonalization.client.sendMessage('thread-1', 'hello', 'user-1'),
    );

    const personalizationContext = buildLocalPersonalizationContext({
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: true, traits: ['讲话简短'], conciseFirst: true },
      instructions: '保持克制',
    });
    expect(personalizationContext).not.toBeNull();

    const withPersonalization = makeRemoteClient();
    await collect(
      await withPersonalization.client.sendMessage('thread-1', 'hello', 'user-1'),
    );

    expect(withPersonalization.sendMessage.mock.calls[0][0]).toEqual(
      withoutPersonalization.sendMessage.mock.calls[0][0],
    );
  });

  it('never embeds Mobile Personalization text in a Remote Host request payload', async () => {
    const { client, sendMessage } = makeRemoteClient();
    await collect(await client.sendMessage('thread-1', 'hello', 'user-1'));

    const payload = JSON.stringify(sendMessage.mock.calls[0][0]);
    const personalizationContext = buildLocalPersonalizationContext({
      baseStyle: { tone: 'professional' },
      characteristics: { warmth: false, traits: ['讲话简短'], conciseFirst: false },
      instructions: '保持克制',
    });

    expect(personalizationContext).not.toBeNull();
    expect(payload).not.toContain('保持克制');
    expect(payload).not.toContain('讲话简短');
    expect(payload).not.toContain('personalization');
    expect(payload).not.toContain('system');
  });

  it('keeps the default Personalization compiler output empty so nothing leaks even if passed', () => {
    expect(buildLocalPersonalizationContext(DEFAULT_PERSONALIZATION_SETTINGS)).toBeNull();
  });
});
