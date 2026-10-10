import React from 'react';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';

import { ShareMessageSelector } from './ShareMessageSelector';
import type { ChatMessage } from '../types';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      bg: { canvas: '#fff', soft: '#eee' },
      border: { default: '#ddd' },
      text: { ink: '#111', soft: '#777' },
      primary: '#00f',
      onPrimary: '#fff',
      status: { warning: '#fa0' },
    },
  }),
}));

const message = (
  id: string,
  role: ChatMessage['role'],
  content: string,
): ChatMessage => ({
  id,
  role,
  content,
  timestamp: new Date('2026-09-08T08:00:00Z'),
});

const conversation: ChatMessage[] = [
  message('u-1', 'user', '问题一'),
  message('a-1', 'assistant', '回答一'),
];

// VirtualizedList renders cells on a timer. Unmounting inside act on teardown
// clears that timer, so no state update (and no act warning) escapes after the
// test finishes.
const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  for (const tree of mounted) {
    act(() => {
      tree.unmount();
    });
  }
  mounted.length = 0;
});

const mount = (messages: ChatMessage[], onConfirm: (ids: string[]) => void) => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ShareMessageSelector
        visible
        messages={messages}
        busy={false}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />,
    );
  });
  mounted.push(tree);
  return tree;
};

// testID is forwarded to the inner host View as well, so pick the node that
// actually owns onPress.
const nodeByTestID = (tree: ReactTestRenderer, testID: string) =>
  tree.root.findAll(
    (node) => node.props.testID === testID && typeof node.props.onPress === 'function',
  )[0];

const press = (tree: ReactTestRenderer, testID: string) => {
  const node = nodeByTestID(tree, testID);
  act(() => {
    node.props.onPress();
  });
};

describe('ShareMessageSelector', () => {
  it('starts with every offered message selected and confirms in conversation order', () => {
    const confirmed: string[][] = [];
    const tree = mount(conversation, (ids) => confirmed.push(ids));

    expect(nodeByTestID(tree, 'share-selector-confirm').props.accessibilityLabel).toBe(
      '分享选中的 2 条消息',
    );

    press(tree, 'share-selector-confirm');
    expect(confirmed).toEqual([['u-1', 'a-1']]);
  });

  it('excludes a deselected message from the confirmed selection', () => {
    const confirmed: string[][] = [];
    const tree = mount(conversation, (ids) => confirmed.push(ids));

    press(tree, 'share-selector-row-u-1');
    press(tree, 'share-selector-confirm');

    expect(confirmed).toEqual([['a-1']]);
  });

  it('disables confirm while nothing is selected', () => {
    let called = 0;
    const tree = mount(conversation, () => {
      called += 1;
    });

    press(tree, 'share-selector-row-u-1');
    press(tree, 'share-selector-row-a-1');

    const confirm = nodeByTestID(tree, 'share-selector-confirm');
    expect(confirm.props.accessibilityState.disabled).toBe(true);
    act(() => {
      confirm.props.onPress();
    });
    expect(called).toBe(0);
  });

  it('keeps the user selection when the conversation mutates while the selector is open', () => {
    const confirmed: string[][] = [];
    const onConfirm = (ids: string[]) => confirmed.push(ids);
    const tree = mount(conversation, onConfirm);

    // Opt out of 问题一 before a new reply arrives.
    press(tree, 'share-selector-row-u-1');

    act(() => {
      tree.update(
        <ShareMessageSelector
          visible
          messages={[...conversation, message('a-2', 'assistant', '补充回答')]}
          busy={false}
          onCancel={() => undefined}
          onConfirm={onConfirm}
        />,
      );
    });

    press(tree, 'share-selector-confirm');

    // The opt-out survives, and the message that appeared while open is not
    // silently included.
    expect(confirmed).toEqual([['a-1']]);
  });
});
