import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import {
  AudioPlayer,
  playbackPositionFromTrackX,
  playbackProgressRatio,
  playbackThumbLeft,
} from './AudioPlayer';
import type {
  LocalAudioPlaybackAdapter,
  PlaybackSnapshot,
} from './PlaybackAdapter';

jest.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#c96442',
      primaryActive: '#a95034',
      onPrimary: '#faf9f5',
      text: {
        ink: '#141413',
        soft: '#87867f',
      },
      bg: {
        soft: '#e8e6dc',
        card: '#faf9f5',
      },
      border: {
        default: '#e8e6dc',
      },
      status: {
        error: '#c64545',
      },
    },
  }),
}));

class FakePlaybackAdapter implements LocalAudioPlaybackAdapter {
  loadedSource: string | null = null;
  disposeCount = 0;
  seekCalls: number[] = [];
  private snapshot: PlaybackSnapshot = {
    state: 'idle',
    positionMs: 0,
    durationMs: 0,
    error: null,
  };
  private readonly listeners = new Set<(snapshot: PlaybackSnapshot) => void>();

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  async load(source: string) {
    this.loadedSource = source;
    this.setSnapshot({
      state: 'ready',
      positionMs: 0,
      durationMs: 60000,
      error: null,
    });
  }

  async play() {
    this.setSnapshot({ ...this.snapshot, state: 'playing' });
  }

  async pause() {
    this.setSnapshot({ ...this.snapshot, state: 'paused' });
  }

  async seek(positionMs: number) {
    this.seekCalls.push(positionMs);
    this.setSnapshot({ ...this.snapshot, positionMs });
  }

  async dispose() {
    this.disposeCount += 1;
    this.setSnapshot({
      state: 'idle',
      positionMs: 0,
      durationMs: 0,
      error: null,
    });
  }

  emit(snapshot: PlaybackSnapshot) {
    this.setSnapshot(snapshot);
  }

  private setSnapshot(snapshot: PlaybackSnapshot) {
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

const styleOf = (component: ReactTestRenderer.ReactTestInstance) =>
  StyleSheet.flatten(component.props.style) as Record<string, unknown>;

describe('AudioPlayer', () => {
  it('renders without Shiyan business context and keeps the full inactive track', async () => {
    const adapter = new FakePlaybackAdapter();
    let component: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AudioPlayer
          source="/private/shiyan/a.m4a"
          fallbackDurationMs={60000}
          detailText="1.2 MB"
          adapter={adapter}
        />,
      );
    });

    expect(component).toBeDefined();
    expect(adapter.loadedSource).toBe('/private/shiyan/a.m4a');

    const inactiveTrack = component!.root.findByProps({
      testID: 'audio-player-inactive-track',
    });
    const playedTrack = component!.root.findByProps({
      testID: 'audio-player-played-track',
    });

    expect(styleOf(inactiveTrack)).toMatchObject({
      left: 0,
      right: 0,
      height: 4,
    });
    expect(styleOf(playedTrack).width).toBe('0%');

    await ReactTestRenderer.act(async () => {
      component!.unmount();
    });
    expect(adapter.disposeCount).toBe(1);
  });

  it('changes only played fill and thumb while keeping a full seek surface', async () => {
    const adapter = new FakePlaybackAdapter();
    let component: ReactTestRenderer.ReactTestRenderer | undefined;

    await ReactTestRenderer.act(async () => {
      component = ReactTestRenderer.create(
        <AudioPlayer source="/private/shiyan/a.m4a" adapter={adapter} />,
      );
    });

    const trackArea = component!.root.findByProps({
      testID: 'audio-player-track-area',
    });
    ReactTestRenderer.act(() => {
      trackArea.props.onLayout({ nativeEvent: { layout: { width: 200 } } });
    });

    ReactTestRenderer.act(() => {
      adapter.emit({
        state: 'playing',
        positionMs: 30000,
        durationMs: 60000,
        error: null,
      });
    });

    const inactiveTrack = component!.root.findByProps({
      testID: 'audio-player-inactive-track',
    });
    let playedTrack = component!.root.findByProps({
      testID: 'audio-player-played-track',
    });
    let thumb = component!.root.findByProps({ testID: 'audio-player-thumb' });

    expect(styleOf(inactiveTrack)).toMatchObject({ left: 0, right: 0 });
    expect(styleOf(playedTrack).width).toBe('50%');
    expect(styleOf(thumb).left).toBe(93);

    ReactTestRenderer.act(() => {
      adapter.emit({
        state: 'ended',
        positionMs: 60000,
        durationMs: 60000,
        error: null,
      });
    });

    playedTrack = component!.root.findByProps({
      testID: 'audio-player-played-track',
    });
    thumb = component!.root.findByProps({ testID: 'audio-player-thumb' });
    expect(styleOf(playedTrack).width).toBe('100%');
    expect(styleOf(thumb).left).toBe(186);
  });
});

describe('AudioPlayer track math', () => {
  it('maps the whole track to the whole recording, including an unplayed seek', async () => {
    expect(playbackProgressRatio(0, 60000)).toBe(0);
    expect(playbackProgressRatio(30000, 60000)).toBe(0.5);
    expect(playbackProgressRatio(60000, 60000)).toBe(1);
    expect(playbackPositionFromTrackX(0, 200, 60000)).toBe(0);
    expect(playbackPositionFromTrackX(150, 200, 60000)).toBe(45000);
    expect(playbackPositionFromTrackX(250, 200, 60000)).toBe(60000);
    expect(playbackThumbLeft(0, 200)).toBe(0);
    expect(playbackThumbLeft(0.5, 200)).toBe(93);
    expect(playbackThumbLeft(1, 200)).toBe(186);

    const adapter = new FakePlaybackAdapter();
    await adapter.load('/private/shiyan/a.m4a');
    await adapter.seek(playbackPositionFromTrackX(150, 200, 60000));
    expect(adapter.seekCalls).toEqual([45000]);
    expect(adapter.getSnapshot().positionMs).toBe(45000);
  });
});
