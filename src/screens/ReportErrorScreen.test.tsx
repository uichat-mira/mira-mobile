import React from 'react';
import { Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';
import { ReportErrorScreen } from './ReportErrorScreen';

const mockGet = jest.fn<Promise<string | null>, [string]>();
const mockSet = jest.fn<Promise<void>, [string, string]>();

jest.mock('../storage/localKeyValueStore', () => ({
  localKeyValueStore: {
    get: (key: string) => mockGet(key),
    set: (key: string, value: string) => mockSet(key, value),
  },
}));

jest.mock('../provider/providerConfigStore', () => ({
  ProviderConfigStore: class {
    load() {
      return Promise.resolve([]);
    }
  },
}));

jest.mock('../store/hostStore', () => ({
  useHostStore: (selector: (state: { config: null }) => unknown) =>
    selector({ config: null }),
}));

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#c60',
      primaryActive: '#a50',
      primaryDisabled: '#ddd',
      onPrimary: '#fff',
      bg: { canvas: '#fff', input: '#fff' },
      border: { default: '#ddd' },
      text: { ink: '#111', soft: '#777', muted: '#777', placeholder: '#999' },
      status: { error: '#c00' },
    },
  }),
}));

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderScreen = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<ReportErrorScreen />);
  });
  return tree;
};

const textValues = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Text).map((node) => node.props.children);

const descriptionInput = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.props.onChangeText === 'function')[0];

describe('ReportErrorScreen draft persistence', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockSet.mockResolvedValue(undefined);
  });

  it('flushes an edit made while the draft is still loading, including an empty value', async () => {
    let resolveLoad!: (value: string | null) => void;
    mockGet.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    const tree = await renderScreen();

    await act(async () => {
      descriptionInput(tree).props.onChangeText('');
    });
    expect(mockSet).not.toHaveBeenCalled();

    await act(async () => {
      resolveLoad('旧草稿');
      await Promise.resolve();
    });

    expect(mockSet).toHaveBeenCalledWith('mira.report-error.draft.v1', '');
    expect(descriptionInput(tree).props.value).toBe('');

    act(() => tree.unmount());
  });

  it('prefills the existing draft when the user has not typed yet', async () => {
    mockGet.mockResolvedValueOnce('已保存的草稿');

    const tree = await renderScreen();
    await flush();

    expect(descriptionInput(tree).props.value).toBe('已保存的草稿');
    expect(mockSet).not.toHaveBeenCalled();

    act(() => tree.unmount());
  });

  it('never reports the draft as retained when persisting fails', async () => {
    mockGet.mockResolvedValue(null);
    mockSet.mockRejectedValue(new Error('storage unavailable'));

    const tree = await renderScreen();
    await flush();

    await act(async () => {
      descriptionInput(tree).props.onChangeText('崩溃了');
    });
    await flush();

    const values = textValues(tree);
    expect(values).toContain('草稿未能保存到本机，离开页面后可能丢失。');
    expect(values).not.toContain(
      '已唤起邮件客户端；草稿已保留，若内容未自动填入可在邮件中手动粘贴。',
    );

    act(() => tree.unmount());
  });
});
