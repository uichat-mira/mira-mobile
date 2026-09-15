import React from 'react';
import { Image } from 'react-native';
import type { ReactTestRenderer } from 'react-test-renderer';
import renderer, { act } from 'react-test-renderer';
import type { ShareCardModel } from './shareCardModel';
import { requestShareCardCapture, ShareCardCaptureRoot } from './ShareCardCapture';
import { captureRef } from './viewShotAdapter';

jest.mock('./viewShotAdapter', () => ({
  captureRef: jest.fn(),
}));

const mockCaptureRef = captureRef as jest.MockedFunction<typeof captureRef>;

const model: ShareCardModel = {
  title: '测试对话',
  date: '2026.09.15',
  messages: [{ id: 'm-1', role: 'user', content: '你好' }],
  totalCount: 1,
  truncated: false,
};

const fireReadySignals = (tree: ReactTestRenderer) => {
  tree.root.findByProps({ testID: 'share-card-capture-target' }).props.onLayout();
  const logos = tree.root.findAllByType(Image);
  expect(logos).toHaveLength(2);
  logos.forEach((logo) => logo.props.onLoad());
};

describe('ShareCardCaptureRoot', () => {
  let tree: ReactTestRenderer | null = null;

  const mountRoot = () => {
    act(() => {
      tree = renderer.create(<ShareCardCaptureRoot />);
    });
  };

  afterEach(() => {
    if (tree) {
      act(() => tree?.unmount());
      tree = null;
    }
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('rejects when the capture root is absent', async () => {
    await expect(requestShareCardCapture(model)).rejects.toThrow('not mounted');
  });

  it('rejects a concurrent request while one capture is active', async () => {
    mountRoot();

    let first!: Promise<string>;
    act(() => {
      first = requestShareCardCapture(model);
    });

    await expect(requestShareCardCapture(model)).rejects.toThrow('already in progress');

    const firstResult = expect(first).rejects.toThrow('unmounted');
    act(() => {
      tree?.unmount();
      tree = null;
    });
    await firstResult;
  });

  it('times out cleanly and accepts a later request', async () => {
    jest.useFakeTimers();
    mountRoot();

    let first!: Promise<string>;
    act(() => {
      first = requestShareCardCapture(model, { timeoutMs: 50 });
    });
    const firstResult = expect(first).rejects.toThrow('timed out');
    act(() => jest.advanceTimersByTime(50));
    await firstResult;

    let second!: Promise<string>;
    act(() => {
      second = requestShareCardCapture(model, { timeoutMs: 50 });
    });
    const secondResult = expect(second).rejects.toThrow('timed out');
    act(() => jest.advanceTimersByTime(50));
    await secondResult;
  });

  it('waits for layout and both raster assets before capturing PNG', async () => {
    mockCaptureRef.mockResolvedValueOnce('file:///tmp/mira-share-card.png');
    mountRoot();

    let capture!: Promise<string>;
    act(() => {
      capture = requestShareCardCapture(model);
    });

    const logos = tree?.root.findAllByType(Image) ?? [];
    expect(logos).toHaveLength(2);
    act(() => {
      tree?.root.findByProps({ testID: 'share-card-capture-target' }).props.onLayout();
      logos[0]?.props.onLoad();
    });
    expect(mockCaptureRef).not.toHaveBeenCalled();

    await act(async () => {
      logos[1]?.props.onLoad();
      await expect(capture).resolves.toBe('file:///tmp/mira-share-card.png');
    });

    expect(mockCaptureRef).toHaveBeenCalledTimes(1);
    expect(mockCaptureRef).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ format: 'png', result: 'tmpfile' }),
    );
  });

  it('recovers the queue after native capture failure', async () => {
    mockCaptureRef
      .mockRejectedValueOnce(new Error('native capture failed'))
      .mockResolvedValueOnce('file:///tmp/recovered.png');
    mountRoot();

    let first!: Promise<string>;
    act(() => {
      first = requestShareCardCapture(model);
    });
    await act(async () => {
      if (!tree) throw new Error('capture root missing');
      fireReadySignals(tree);
      await expect(first).rejects.toThrow('native capture failed');
    });

    let second!: Promise<string>;
    act(() => {
      second = requestShareCardCapture(model);
    });
    await act(async () => {
      if (!tree) throw new Error('capture root missing');
      fireReadySignals(tree);
      await expect(second).resolves.toBe('file:///tmp/recovered.png');
    });

    expect(mockCaptureRef).toHaveBeenCalledTimes(2);
  });
});
