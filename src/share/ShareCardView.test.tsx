import React from 'react';
import { Image, Text } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';
import { ShareCardView } from './ShareCardView';
import type { ShareCardModel } from './shareCardModel';

const model: ShareCardModel = {
  title: '一次关于 Mira 的对话',
  date: '2026.09.15',
  messages: [
    { id: 'user-1', role: 'user', content: '帮我整理一下' },
    { id: 'assistant-1', role: 'assistant', content: '可以，从三个部分开始。' },
  ],
  totalCount: 2,
  truncated: false,
};

const renderCard = (cardModel: ShareCardModel): ReactTestRenderer => {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = renderer.create(<ShareCardView model={cardModel} />);
  });
  return tree;
};

describe('ShareCardView', () => {
  it('renders fixed brand header, conversation content, logos, and footer metadata', () => {
    const tree = renderCard(model);
    const texts = tree.root.findAllByType(Text);
    const values = texts.map((node) => node.props.children);

    expect(values).toEqual(
      expect.arrayContaining([
        'UIChat Mira',
        '对话分享',
        '2026.09.15',
        '一次关于 Mira 的对话',
        '帮我整理一下',
        '可以，从三个部分开始。',
        '共 2 条消息',
      ]),
    );
    expect(values.filter((value) => value === 'UIChat Mira')).toHaveLength(2);
    expect(tree.root.findAllByType(Image)).toHaveLength(2);

    const userText = texts.find((node) => node.props.children === '帮我整理一下');
    const assistantText = texts.find(
      (node) => node.props.children === '可以，从三个部分开始。',
    );
    expect(userText?.props.style).not.toEqual(assistantText?.props.style);

    act(() => tree.unmount());
  });

  it('renders truthful truncation metadata', () => {
    const tree = renderCard({
      ...model,
      totalCount: 7,
      truncated: true,
    });
    const values = tree.root.findAllByType(Text).map((node) => node.props.children);

    expect(values).toContain('已截取前 2 条 · 共 7 条');

    act(() => tree.unmount());
  });
});
