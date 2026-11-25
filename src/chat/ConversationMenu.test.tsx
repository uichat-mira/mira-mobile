import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ConversationMenu } from './ConversationMenu';

jest.mock('lucide-react-native', () => ({
  Archive: () => null,
  ChevronRight: () => null,
  FolderOpen: () => null,
  FolderPlus: () => null,
  Search: () => null,
  Share2: () => null,
  Square: () => null,
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

describe('ConversationMenu action availability', () => {
  const render = async (props: Partial<React.ComponentProps<typeof ConversationMenu>>) => {
    let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(
        <ConversationMenu
          visible
          title="Mira 对话"
          anchor={{ top: 10, right: 10 }}
          onClose={jest.fn()}
          {...props}
        />,
      );
    });
    return renderer!;
  };

  const labels = (root: ReactTestRenderer.ReactTestInstance) =>
    root
      .findAll((node) => node.props.accessibilityRole === 'button')
      .map((node) => node.props.accessibilityLabel as string);

  test('shows Desktop thread actions only when the real binding exists', async () => {
    const withoutBinding = await render({ onShare: jest.fn() });
    expect(labels(withoutBinding.root)).not.toContain('查看远程工作空间');
    expect(labels(withoutBinding.root)).not.toContain('结束远程线程');
    await ReactTestRenderer.act(async () => withoutBinding.unmount());

    const onViewWorkspace = jest.fn();
    const onEndThread = jest.fn();
    const withBinding = await render({
      onShare: jest.fn(),
      onViewWorkspace,
      onEndThread,
    });
    const workspace = findButtonByLabel(withBinding.root, '查看远程工作空间');
    const endThread = findButtonByLabel(withBinding.root, '结束远程线程');
    expect(workspace).toBeDefined();
    expect(endThread).toBeDefined();

    await ReactTestRenderer.act(async () => workspace!.props.onPress());
    expect(onViewWorkspace).toHaveBeenCalledTimes(1);
    await ReactTestRenderer.act(async () => endThread!.props.onPress());
    expect(onEndThread).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => withBinding.unmount());
  });

  test('no longer offers the unimplemented placeholder entries', async () => {
    const renderer = await render({ onShare: jest.fn() });
    const all = labels(renderer.root);

    expect(all.some((label) => label.startsWith('已上传文件'))).toBe(false);
    expect(all.some((label) => label.startsWith('添加到首页'))).toBe(false);
    expect(all).toContain('分享');
    // "添加到项目" has no Host contract yet, so it stays present but disabled
    // with an explicit reason rather than silently doing nothing.
    expect(all).toContain('添加到项目，暂不可用');

    await ReactTestRenderer.act(async () => renderer.unmount());
  });

  test('enables delete when the runtime authorized it and invokes the handler', async () => {
    const onDelete = jest.fn();
    const onClose = jest.fn();
    const renderer = await render({ onDelete, onClose });

    const remove = findButtonByLabel(renderer.root, '删除');
    expect(remove).toBeDefined();
    expect(remove!.props.accessibilityState).toEqual({ disabled: false });

    await ReactTestRenderer.act(async () => {
      remove!.props.onPress();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);

    await ReactTestRenderer.act(async () => renderer.unmount());
  });

  test('keeps delete disabled with an explicit reason when the Host denies it', async () => {
    const onDelete = jest.fn();
    const renderer = await render({
      onDelete,
      deleteDisabled: true,
      deleteDisabledAccessibilityLabel: '删除会话，当前 Mira Host 未授权删除',
    });

    const remove = findButtonByLabel(
      renderer.root,
      '删除会话，当前 Mira Host 未授权删除',
    );
    expect(remove!.props.disabled).toBe(true);
    expect(onDelete).not.toHaveBeenCalled();

    await ReactTestRenderer.act(async () => renderer.unmount());
  });
});
