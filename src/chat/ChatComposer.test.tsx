import React, { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { TextInput, StyleSheet } from 'react-native';
import { themePresets } from '../theme/palette';
import Slider from '@react-native-community/slider';
import { ChatComposer } from './ChatComposer';
import { useComposerControls } from './useComposerControls';
import { LocalProviderRuntime } from '../runtime/localProviderRuntime';
import { LocalSessionRepository } from '../local/localSessionRepository';
import { ProviderConfigStore } from '../provider/providerConfigStore';
import { MemoryProviderCredentialStore } from '../security/providerCredentialStore';
import { MemoryLocalKeyValueStore } from '../storage/localKeyValueStore';
import { OpenAiStandardClient } from '../provider/openAiStandardClient';
import { FakeXhr, sse } from '../provider/openAiStandardClientTestSupport';

jest.mock('lucide-react-native', () => ({
  ArrowUp: () => null,
  Camera: () => null,
  Check: () => null,
  File: () => null,
  Gauge: () => null,
  Image: () => null,
  Layers: () => null,
  Plus: () => null,
  Square: () => null,
}));
jest.mock('@react-native-community/slider', () => 'MockSlider');
let mockDarkTheme = false;
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors:
      require('../theme/palette').themePresets.default[
        mockDarkTheme ? 'dark' : 'light'
      ],
  }),
}));

const button = (tree: ReactTestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    node =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === 'function',
  )[0]!;
const press = async (
  tree: ReactTestRenderer.ReactTestRenderer,
  label: string,
) => {
  const target = button(tree, label);
  expect(target).toBeDefined();
  expect(target.props.disabled).not.toBe(true);
  await act(async () => {
    target.props.onPress();
  });
};
const focus = async (tree: ReactTestRenderer.ReactTestRenderer) => {
  await act(async () => {
    tree.root.findByType(TextInput).props.onFocus();
  });
};
const createRuntime = async () => {
  const store = new MemoryLocalKeyValueStore();
  const configStore = new ProviderConfigStore(store);
  await configStore.save([
    {
      id: 'a',
      name: 'Provider A',
      model: 'model-a',
      baseUrl: 'https://a.example.com/v1',
      protocol: 'openai-chat-completions',
    },
    {
      id: 'b',
      name: 'Provider B',
      model: 'model-b',
      baseUrl: 'https://b.example.com/v1',
      protocol: 'openai-chat-completions',
    },
  ]);
  const credentialStore = new MemoryProviderCredentialStore();
  await credentialStore.save('a', 'fixture-a');
  await credentialStore.save('b', 'fixture-b');
  const repository = new LocalSessionRepository(store);
  const requests: FakeXhr[] = [];
  const runtime = new LocalProviderRuntime({
    configStore,
    credentialStore,
    sessionRepository: repository,
    loadGlobalAgentStrength: async () => 'light',
    toolGateway: {
      listTools: async () => [],
      callTool: async () => ({ content: 'ok' }),
    },
    clientFactory: (config, apiKey) =>
      new OpenAiStandardClient({
        baseUrl: config.baseUrl,
        protocol: config.protocol,
        apiKey,
        xhrFactory: () => {
          const xhr = new FakeXhr(
            sse(
              { choices: [{ delta: { content: 'done' } }] },
              { choices: [{ delta: {}, finish_reason: 'stop' }] },
              '[DONE]',
            ),
          );
          requests.push(xhr);
          return xhr as unknown as XMLHttpRequest;
        },
      }),
  });
  const session = await runtime.createSession('Test', 'a');
  return { runtime, repository, session, requests };
};

describe('MOB-104 ChatComposer', () => {
  it('uses one input across focus, preserves draft and shows exactly three UI-only attachment entries', async () => {
    const send = jest.fn();
    const stop = jest.fn();
    function Harness({ running = false }: { running?: boolean }) {
      const [value, setValue] = useState('draft');
      return (
        <ChatComposer
          value={value}
          onChangeText={setValue}
          placeholder="给 Mira 发消息"
          editable={!running}
          running={running}
          onSend={send}
          onStop={stop}
          followsGlobal
          strengthReady={false}
          modelsReady={false}
          busy={false}
          error={null}
          onRefresh={jest.fn()}
          onStrength={jest.fn()}
          onModel={jest.fn()}
        />
      );
    }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<Harness />);
    });
    expect(
      tree.root.findAllByProps({ testID: 'composer-compact' }).length,
    ).toBeGreaterThan(0);
    await focus(tree);
    expect(
      tree.root.findAllByProps({ testID: 'composer-expanded' }).length,
    ).toBeGreaterThan(0);
    await act(async () => {
      tree.root
        .findByType(TextInput)
        .props.onChangeText('long draft\nsecond line');
    });
    await press(tree, '添加附件');
    const menu = tree.root.findAllByProps({
      testID: 'composer-popup-attachments',
    })[0];
    expect([
      ...new Set(
        menu
          .findAll(
            node =>
              node.props.accessibilityRole === 'button' &&
              typeof node.props.onPress === 'function',
          )
          .map(node => node.props.accessibilityLabel),
      ),
    ]).toEqual(['图片', '拍照', '文件']);
    await press(tree, '关闭输入框菜单');
    expect(
      tree.root.findAllByProps({ testID: 'composer-popup-attachments' }),
    ).toHaveLength(0);
    await press(tree, '添加附件');
    await press(tree, '图片');
    expect(
      tree.root.findAllByProps({ testID: 'composer-popup-attachments' }),
    ).toHaveLength(0);
    await act(async () => {
      tree.root.findByType(TextInput).props.onBlur();
    });
    expect(tree.root.findByType(TextInput).props.value).toBe(
      'long draft\nsecond line',
    );
    expect(button(tree, '选择模型：未选择')).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    await press(tree, '发送消息');
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.update(<Harness running />);
    });
    await press(tree, '停止生成');
    expect(stop).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  it('uses the dark theme, exposes empty model state and prevents sending while settings are busy', async () => {
    const send = jest.fn();
    const model = jest.fn();
    const render = (busy: boolean) => (
      <ChatComposer
        value="draft"
        onChangeText={jest.fn()}
        placeholder="给 Mira 发消息"
        editable
        running={false}
        onSend={send}
        onStop={jest.fn()}
        strength="standard"
        followsGlobal
        strengthReady
        models={[]}
        modelsReady
        busy={busy}
        error={null}
        onRefresh={jest.fn()}
        onStrength={jest.fn()}
        onModel={model}
      />
    );
    mockDarkTheme = true;
    let tree!: ReactTestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        tree = ReactTestRenderer.create(render(false));
      });
      const shell = tree.root.findAllByProps({ testID: 'composer-compact' })[0];
      expect(StyleSheet.flatten(shell.props.style).backgroundColor).toBe(
        themePresets.default.dark.bg.input,
      );
      await press(tree, '选择模型：未选择');
      expect(
        tree.root.findAll(node => node.props.children === '暂无已配置模型')
          .length,
      ).toBeGreaterThan(0);
      await press(tree, '关闭输入框菜单');
      await act(async () => tree.update(render(true)));
      expect(button(tree, '发送消息').props.disabled).toBe(true);
      expect(button(tree, '选择模型：未选择').props.disabled).toBe(true);
      expect(model).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally {
      mockDarkTheme = false;
      if (tree) await act(async () => tree.unmount());
    }
  });

  it('persists slider and model changes independently through the actual runtime and sends with the chosen model', async () => {
    const { runtime, repository, session, requests } = await createRuntime();
    const sent: Promise<void>[] = [];
    function Harness() {
      const controls = useComposerControls(runtime, session.id);
      const [value, setValue] = useState('preserved draft');
      return (
        <ChatComposer
          value={value}
          onChangeText={setValue}
          placeholder="给 Mira 发消息"
          editable
          running={false}
          onSend={() => {
            sent.push(
              (async () => {
                const stream = await runtime.sendMessage(session.id, value);
                const events = [];
                for await (const event of stream) events.push(event);
                expect(events).toContainEqual({
                  type: 'finish',
                  reason: 'stop',
                });
              })(),
            );
          }}
          onStop={jest.fn()}
          strength={controls.strength}
          followsGlobal={controls.override === null}
          strengthReady={controls.strengthReady}
          models={controls.models}
          modelsReady={controls.modelsReady}
          busy={controls.loading || controls.saving}
          error={controls.error}
          onRefresh={() => {
            void controls.refresh();
          }}
          onStrength={next => {
            void controls.chooseStrength(next);
          }}
          onModel={id => {
            void controls.chooseModel(id);
          }}
        />
      );
    }
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = ReactTestRenderer.create(<Harness />);
    });
    await focus(tree);
    await press(tree, '执行强度：轻量');
    const slider = tree.root.findByType(Slider);
    expect(slider.props.maximumValue).toBe(4);
    await act(async () => {
      slider.props.onSlidingComplete(4);
    });
    await expect(repository.getAgentStrengthOverride(session.id)).resolves.toBe(
      'deep',
    );
    await press(tree, '关闭输入框菜单');
    await press(tree, '选择模型：model-a');
    await press(tree, 'model-b，Provider B');
    await expect(repository.getProviderId(session.id)).resolves.toBe('b');
    await expect(repository.getAgentStrengthOverride(session.id)).resolves.toBe(
      'deep',
    );
    expect(tree.root.findByType(TextInput).props.value).toBe('preserved draft');
    await press(tree, '关闭输入框菜单');
    await press(tree, '执行强度：深度');
    await press(tree, '跟随全局');
    await expect(
      repository.getAgentStrengthOverride(session.id),
    ).resolves.toBeNull();
    await expect(runtime.getEffectiveAgentStrength(session.id)).resolves.toBe(
      'light',
    );
    await press(tree, '关闭输入框菜单');
    await press(tree, '发送消息');
    await Promise.all(sent);
    expect(requests[0].requestUrl).toBe(
      'https://b.example.com/v1/chat/completions',
    );
    expect(JSON.parse(requests[0].requestBody ?? '{}')).toMatchObject({
      model: 'model-b',
    });
    expect(requests[0].headers.Authorization).toBe('Bearer fixture-b');
    await act(async () => tree.unmount());
  });
});
