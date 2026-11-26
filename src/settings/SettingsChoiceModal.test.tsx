import React from 'react';
import renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { SettingsChoiceModal } from './SettingsChoiceModal';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      overlay: 'rgba(0,0,0,0.4)',
      bg: { elevated: '#faf9f5', soft: '#e8e6dc' },
      text: { ink: '#141413', muted: '#5e5d59' },
      primary: '#c96442',
    },
  }),
}));

describe('SettingsChoiceModal drawer presentation', () => {
  it('uses the full drawer content width and anchors above the chat action', async () => {
    let tree!: ReactTestRenderer;
    const onChange = jest.fn();
    const onClose = jest.fn();
    await act(async () => {
      tree = renderer.create(
        <SettingsChoiceModal
          withinModal
          visible
          title="选择聊天方式"
          value="remote"
          options={[
            {
              value: 'remote', label: '远程连接',
              description: 'Mira Cloud',
              accessibilityLabel: '远程连接（Mira Cloud）',
            },
            { value: 'local', label: '本地连接', description: '手机直连模型服务' },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      );
    });

    const styles = tree.root.findAll(node => node.props.style).map(node =>
      StyleSheet.flatten(node.props.style),
    );
    expect(styles).toContainEqual(expect.objectContaining({
      justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 88,
    }));
    expect(styles).toContainEqual(expect.objectContaining({
      width: '100%', maxWidth: '100%',
    }));

    const remote = tree.root.findByProps({ accessibilityLabel: '远程连接（Mira Cloud）' });
    const local = tree.root.findByProps({ accessibilityLabel: '本地连接' });
    expect(remote.props.accessibilityState).toEqual({ checked: true });
    expect(local.props.accessibilityState).toEqual({ checked: false });
    const text = tree.root.findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(text).toEqual(expect.arrayContaining([
      '选择聊天方式', '远程连接', 'Mira Cloud', '本地连接', '手机直连模型服务',
    ]));

    await act(async () => { local.props.onPress(); });
    expect(onChange).toHaveBeenCalledWith('local');
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => { tree.unmount(); });
  });

  it('lets a long option description wrap instead of truncating it', async () => {
    let tree!: ReactTestRenderer;
    const description = '适合长链路任务；仍受运行时间和取消操作约束。';
    await act(async () => {
      tree = renderer.create(
        <SettingsChoiceModal
          withinModal
          visible
          value="deep"
          options={[{ value: 'deep', label: '深度', description }]}
          onChange={jest.fn()}
          onClose={jest.fn()}
        />,
      );
    });

    const descriptionNode = tree.root.find(
      node => typeof node.props.children === 'string' && node.props.children === description,
    );
    // Any numberOfLines cap re-introduces the ellipsis the picker must avoid.
    expect(descriptionNode.props.numberOfLines).toBeUndefined();

    await act(async () => { tree.unmount(); });
  });
});
