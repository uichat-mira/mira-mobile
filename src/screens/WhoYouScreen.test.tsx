import React from 'react';
import { Linking, Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';
import { WhoYouScreen } from './WhoYouScreen';
import type {
  WhoYouIdentity,
  WhoYouMailbox,
} from '../whoYou/whoYouMcpClient';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const react = jest.requireActual<typeof import('react')>('react');
    react.useEffect(callback, [callback]);
  },
}));

jest.mock('../settings/SettingsPageHeader', () => ({
  SettingsPageHeader: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#f5f4ed', card: '#faf9f5', soft: '#e8e6dc' },
      border: { default: '#e8e6dc', soft: '#f0eee6' },
      text: {
        ink: '#141413',
        base: '#3d3d3a',
        muted: '#5e5d59',
        soft: '#87867f',
      },
      primary: '#c96442',
      onPrimary: '#fff',
      status: {
        success: '#5db872',
        warning: '#d4a017',
        error: '#c64545',
        errorBg: '#fce8e8',
      },
    },
  }),
}));

type MockWhoYouState = {
  status:
    | 'idle'
    | 'loading'
    | 'ready'
    | 'empty'
    | 'signed_out'
    | 'session_rejected'
    | 'unavailable'
    | 'error';
  identity: WhoYouIdentity | null;
  mailboxes: WhoYouMailbox[];
  message: string | null;
  refresh: jest.Mock;
  invalidate: jest.Mock;
};

let mockState: MockWhoYouState;

jest.mock('../whoYou/whoYouStore', () => ({
  useWhoYouStore: (selector: (state: MockWhoYouState) => unknown) =>
    selector(mockState),
}));

const identity: WhoYouIdentity = {
  accountId: 'account-1',
  consumerId: 'account-1',
  scopes: ['whoyou.read'],
};

const gmail: WhoYouMailbox = {
  mailboxId: 'mailbox-gmail-1',
  address: 'alice@example.test',
  kind: 'third_party',
  provider: 'gmail',
  status: 'active',
  credentialStatus: 'active',
  quotaBytes: 1000,
  bytesUsed: 20,
  messageCount: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const ownDomain: WhoYouMailbox = {
  mailboxId: 'mailbox-own-1',
  address: 'alice@tomlab.cn',
  kind: 'own_domain',
  provider: null,
  status: 'active',
  credentialStatus: null,
  quotaBytes: 1000,
  bytesUsed: 0,
  messageCount: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const render = async (state: Partial<MockWhoYouState>) => {
  mockState = {
    status: 'idle',
    identity: null,
    mailboxes: [],
    message: null,
    refresh: jest.fn(async () => undefined),
    invalidate: jest.fn(),
    ...state,
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<WhoYouScreen />);
  });
  return tree;
};

const renderedStrings = (tree: ReactTestRenderer): string[] =>
  tree.root.findAllByType(Text).map(node =>
    Array.isArray(node.props.children)
      ? node.props.children.join('')
      : String(node.props.children),
  );

const actionLabels = (tree: ReactTestRenderer): string[] =>
  tree.root
    .findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        typeof node.props.accessibilityLabel === 'string',
    )
    .map(node => node.props.accessibilityLabel as string);

describe('WhoYouScreen', () => {
  it('shows a true empty state and only read-only actions', async () => {
    const tree = await render({
      status: 'empty',
      identity,
      message: null,
    });
    const strings = renderedStrings(tree);
    const labels = actionLabels(tree);

    expect(strings).toContain('当前账号尚未绑定邮箱');
    expect(strings.some(value => value.includes('whoyou.read'))).toBe(true);
    expect(labels).toEqual(
      expect.arrayContaining(['刷新邮箱', '打开狐邮网页管理邮箱']),
    );
    expect(labels.some(label => /发送|写信|草稿|同步邮箱/u.test(label))).toBe(
      false,
    );
  });

  it('distinguishes provider authorization from the server-side mail count', async () => {
    const tree = await render({
      status: 'ready',
      identity,
      mailboxes: [gmail, ownDomain],
    });
    const strings = renderedStrings(tree);

    expect(strings).toContain('alice@example.test');
    expect(strings).toContain('Gmail · 第三方绑定');
    expect(strings).toContain('授权：已授权');
    expect(strings).toContain('同步：服务端 0 封');
    expect(strings).toContain('alice@tomlab.cn');
    expect(strings).toContain('授权：自有域');
    expect(strings).toContain('同步：服务端 3 封');
  });

  it('surfaces reauthorization and disabled mailbox facts without inventing a sync button', async () => {
    const tree = await render({
      status: 'ready',
      identity,
      mailboxes: [
        {
          ...gmail,
          credentialStatus: 'reauth_required',
          status: 'disabled',
          messageCount: 5,
        },
      ],
    });
    const strings = renderedStrings(tree);
    const labels = actionLabels(tree);

    expect(strings).toContain('授权：需重新授权');
    expect(strings).toContain('邮箱：已停用');
    expect(strings).toContain('同步：服务端 5 封');
    expect(labels.some(label => /同步/u.test(label))).toBe(false);
  });

  it('routes login failures to the Cloud account screen instead of showing stale mailboxes', async () => {
    const tree = await render({
      status: 'session_rejected',
      message: 'Mira Cloud 登录已失效，请重新登录。',
      mailboxes: [gmail],
    });
    const strings = renderedStrings(tree);

    expect(strings).toContain('Mira Cloud 登录已失效');
    expect(strings).not.toContain('alice@example.test');
    const action = tree.root.find(
      node =>
        node.props.accessibilityLabel === '前往 Mira Cloud' &&
        typeof node.props.onPress === 'function',
    );
    await act(async () => {
      action.props.onPress();
    });
    expect(mockNavigate).toHaveBeenCalledWith('CloudAccount');
  });

  it('opens only the approved Who You mailbox management page', async () => {
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(true);
    const tree = await render({ status: 'empty', identity });
    const action = tree.root.find(
      node =>
        node.props.accessibilityLabel === '打开狐邮网页管理邮箱' &&
        typeof node.props.onPress === 'function',
    );
    await act(async () => {
      action.props.onPress();
    });
    expect(openURL).toHaveBeenCalledWith(
      'https://who-you.tomz.io/account/mailboxes',
    );
    openURL.mockRestore();
  });

  it('shows the safe service message when Who You is unavailable', async () => {
    const tree = await render({
      status: 'unavailable',
      message: '狐邮暂时不可用，请稍后重试。',
    });
    const strings = renderedStrings(tree);
    expect(strings).toContain('狐邮暂时不可用');
    expect(strings).toContain('狐邮暂时不可用，请稍后重试。');
    expect(actionLabels(tree)).toContain('重试');
  });
});
