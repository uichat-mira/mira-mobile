import React from 'react';
import { AppState, Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';
import { WhoYouMailReadSection } from './WhoYouMailReadSection';
import type { WhoYouMailService } from '../whoYou/whoYouMailService';
import type { WhoYouMailbox } from '../whoYou/whoYouMcpClient';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fafafa', card: '#fff', soft: '#efefef' },
      border: { default: '#ddd' },
      text: { ink: '#111', base: '#333', muted: '#555', soft: '#888' },
      primary: '#c64', status: { error: '#f00', warning: '#d70' },
    },
  }),
}));

const mailbox: WhoYouMailbox = {
  mailboxId: 'mailbox-fixture', address: 'fixture@example.test',
  kind: 'third_party', provider: 'gmail', status: 'active',
  credentialStatus: 'active', quotaBytes: 100000, bytesUsed: 1000,
  messageCount: 40, createdAt: '2026-11-22T00:00:00Z',
  sync: { lastSyncedAt: 1790000000000, lastError: null, inProgress: false, initialImportComplete: false },
};
const summary = {
  id: 'msg-fixture', threadId: 'thread-fixture',
  direction: 'inbound' as const,
  from: [{ name: 'Example Sender', address: 'sender@example.test' }],
  subject: 'Fixture message', receivedAt: 1790000000000,
  snippet: 'Fixture preview', attachmentCount: 0,
};

const displayed = (tree: ReactTestRenderer): string =>
  tree.root.findAllByType(Text).map(node => {
    const c = node.props.children;
    return Array.isArray(c) ? c.join('') : String(c);
  }).join(' ');

describe('Who You direct mail reader', () => {
  it('searches only on user action, reads plain text without invoking a model, clears on background', async () => {
    const search = jest.fn(async () => ({ messages: [summary], nextCursor: null }));
    const read = jest.fn(async () => ({ ...summary, body: 'Private fixture text', truncated: false }));
    const service = { search, read } as unknown as WhoYouMailService;
    let background: ((state: string) => void) | undefined;
    const subscription = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      background = handler as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
    let tree!: ReactTestRenderer;
    try {
      await act(async () => {
        tree = renderer.create(<WhoYouMailReadSection mailboxes={[mailbox]} service={service} />);
      });
      expect(search).not.toHaveBeenCalled();
      expect(displayed(tree)).toContain('初始同步尚未完成');
      const searchButton = tree.root.find(node => node.props.accessibilityLabel === '搜索已同步邮件');
      await act(async () => { searchButton.props.onPress(); });
      expect(search).toHaveBeenCalledWith('', undefined);
      expect(displayed(tree)).toContain('Fixture message');

      const messageButton = tree.root.find(node =>
        node.props.accessibilityLabel === '阅读邮件：Fixture message');
      await act(async () => { messageButton.props.onPress(); });
      expect(read).toHaveBeenCalledWith('msg-fixture');
      expect(displayed(tree)).toContain('Private fixture text');
      expect(displayed(tree)).toContain('不会自动发送给模型');

      await act(async () => { background?.('background'); });
      expect(displayed(tree)).not.toContain('Private fixture text');
      expect(displayed(tree)).not.toContain('Fixture message');
    } finally {
      await act(async () => tree?.unmount());
      subscription.mockRestore();
    }
  });

  it('distinguishes an empty synced search from an empty Gmail inbox', async () => {
    const service = {
      search: jest.fn(async () => ({ messages: [], nextCursor: null })),
      read: jest.fn(),
    } as unknown as WhoYouMailService;
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<WhoYouMailReadSection mailboxes={[mailbox]} service={service} />);
    });
    const button = tree.root.find(node => node.props.accessibilityLabel === '搜索已同步邮件');
    await act(async () => { button.props.onPress(); });
    expect(displayed(tree)).toContain('已同步邮件中没有匹配结果');
    expect(displayed(tree)).toContain('同步覆盖范围');
    expect((service.read as jest.Mock)).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });
});
