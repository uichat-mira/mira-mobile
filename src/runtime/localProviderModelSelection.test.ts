import type { LocalProviderConfig } from '../provider/providerConfigStore';
import { buildLocalProviderModelOptions } from './localProviderModelSelection';

const config = (
  overrides: Partial<LocalProviderConfig> &
    Pick<LocalProviderConfig, 'id' | 'name' | 'baseUrl' | 'model'>,
): LocalProviderConfig => ({
  protocol: 'openai-chat-completions',
  ...overrides,
});

describe('buildLocalProviderModelOptions', () => {
  it('lists only configured Provider/model pairs with the persisted selection', () => {
    const configs = [
      config({
        id: 'provider-a',
        name: 'Work',
        baseUrl: 'https://work.example.com',
        model: 'model-a',
      }),
      config({
        id: 'provider-b',
        name: 'Personal',
        baseUrl: 'https://personal.example.com/v1',
        model: 'model-b',
      }),
    ];

    expect(buildLocalProviderModelOptions(configs, 'provider-b')).toEqual([
      {
        providerId: 'provider-a',
        providerName: 'Work',
        model: 'model-a',
        selected: false,
      },
      {
        providerId: 'provider-b',
        providerName: 'Personal',
        model: 'model-b',
        selected: true,
      },
    ]);
  });

  it('adds the Base URL host only when Provider names collide', () => {
    const configs = [
      config({
        id: 'provider-a',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        model: 'gpt-a',
      }),
      config({
        id: 'provider-b',
        name: 'OpenAI',
        baseUrl: 'https://gateway.example.com/v1',
        model: 'gpt-b',
      }),
    ];

    expect(buildLocalProviderModelOptions(configs, 'provider-a')).toEqual([
      {
        providerId: 'provider-a',
        providerName: 'OpenAI',
        model: 'gpt-a',
        providerHost: 'api.openai.com',
        selected: true,
      },
      {
        providerId: 'provider-b',
        providerName: 'OpenAI',
        model: 'gpt-b',
        providerHost: 'gateway.example.com',
        selected: false,
      },
    ]);
  });

  it('marks nothing selected when the conversation Provider is no longer configured', () => {
    const options = buildLocalProviderModelOptions(
      [
        config({
          id: 'provider-b',
          name: 'Personal',
          baseUrl: 'https://personal.example.com',
          model: 'model-b',
        }),
      ],
      'provider-a',
    );

    expect(options).toEqual([
      expect.objectContaining({ providerId: 'provider-b', selected: false }),
    ]);
  });
});
