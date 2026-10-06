import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ConversationMenu } from './ConversationMenu';

jest.mock('lucide-react-native', () => ({
  Archive: () => null,
  ChevronRight: () => null,
  FolderPlus: () => null,
  House: () => null,
  Paperclip: () => null,
  Search: () => null,
  Share2: () => null,
  Trash2: () => null,
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { card: '#fff', soft: '#f5f5f5' },
      border: { default: '#ddd' },
      text: { muted: '#777', ink: '#111' },
      status: { error: '#c00' },
    },
  }),
}));

const findButtonByLabel = (
  root: ReactTestRenderer.ReactTestInstance,
  label: string,
) =>
  root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      node.props.accessibilityLabel === label,
  )[0];

describe('ConversationMenu share entry', () => {
  test('invokes the existing share entry when available', async () => {
    const onClose = jest.fn();
    const onShare = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ConversationMenu
          visible
          title="Mira 对话"
          anchor={{ top: 10, right: 10 }}
          onClose={onClose}
          onShare={onShare}
        />,
      );
    });

    const share = findButtonByLabel(renderer!.root, '分享');
    expect(share).toBeDefined();
    expect(share!.props.accessibilityState).toEqual({ disabled: false });

    await ReactTestRenderer.act(async () => {
      share!.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => renderer!.unmount());
  });

  test('disables the share entry with an explicit in-flight explanation', async () => {
    const onShare = jest.fn();
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ConversationMenu
          visible
          title="Mira 对话"
          anchor={{ top: 10, right: 10 }}
          onClose={jest.fn()}
          onShare={onShare}
          shareDisabled
          shareDisabledAccessibilityLabel="正在准备分享图片"
        />,
      );
    });

    const share = findButtonByLabel(renderer!.root, '正在准备分享图片');
    expect(share).toBeDefined();
    expect(share!.props.accessibilityState).toEqual({ disabled: true });
    expect(share!.props.disabled).toBe(true);
    expect(onShare).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer!.unmount());
  });
});
