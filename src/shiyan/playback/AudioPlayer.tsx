import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Pause, Play } from 'lucide-react-native';
import { useTheme } from '../../theme/ThemeContext';
import { radius, spacing } from '../../theme/tokens';
import {
  playbackAdapter,
  type LocalAudioPlaybackAdapter,
  type PlaybackSnapshot,
} from './PlaybackAdapter';

const THUMB_SIZE = 14;

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(Math.max(0, durationMs) / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

export const playbackProgressRatio = (positionMs: number, durationMs: number) =>
  durationMs > 0
    ? Math.min(Math.max(positionMs / durationMs, 0), 1)
    : 0;

export const playbackPositionFromTrackX = (
  locationX: number,
  trackWidth: number,
  durationMs: number,
) => {
  if (trackWidth <= 0 || durationMs <= 0) return 0;
  const ratio = Math.min(Math.max(locationX / trackWidth, 0), 1);
  return Math.round(ratio * durationMs);
};

export const playbackThumbLeft = (
  progressRatio: number,
  trackWidth: number,
  thumbSize = THUMB_SIZE,
) => {
  if (trackWidth <= 0) return 0;
  const usableWidth = Math.max(0, trackWidth - thumbSize);
  return Math.min(Math.max(progressRatio, 0), 1) * usableWidth;
};

export interface AudioPlayerHandle {
  dispose(): Promise<void>;
}

export interface AudioPlayerProps {
  source: string;
  fallbackDurationMs?: number;
  detailText?: string;
  disabled?: boolean;
  active?: boolean;
  adapter?: LocalAudioPlaybackAdapter;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer(
    {
      source,
      fallbackDurationMs = 0,
      detailText,
      disabled = false,
      active = true,
      adapter = playbackAdapter,
    },
    ref,
  ) {
    const { colors } = useTheme();
    const [snapshot, setSnapshot] = useState<PlaybackSnapshot>(() =>
      adapter.getSnapshot(),
    );
    const [trackWidth, setTrackWidth] = useState(0);

    useEffect(() => adapter.subscribe(setSnapshot), [adapter]);

    useEffect(() => {
      if (active) {
        void adapter.load(source);
      } else {
        void adapter.dispose();
      }
    }, [active, adapter, source]);

    useEffect(
      () => () => {
        void adapter.dispose();
      },
      [adapter],
    );

    useImperativeHandle(
      ref,
      () => ({
        dispose: () => adapter.dispose(),
      }),
      [adapter],
    );

    const durationMs = snapshot.durationMs || fallbackDurationMs;
    const progressRatio = playbackProgressRatio(snapshot.positionMs, durationMs);
    const canControl =
      !disabled &&
      active &&
      (snapshot.state === 'ready' ||
        snapshot.state === 'playing' ||
        snapshot.state === 'paused' ||
        snapshot.state === 'ended');
    const isPlaying = snapshot.state === 'playing';

    const trackResponder = useMemo(
      () =>
        PanResponder.create({
          onStartShouldSetPanResponder: () => canControl,
          onMoveShouldSetPanResponder: () => canControl,
          onPanResponderGrant: (event) => {
            if (!canControl) return;
            void adapter.seek(
              playbackPositionFromTrackX(
                event.nativeEvent.locationX,
                trackWidth,
                durationMs,
              ),
            );
          },
          onPanResponderMove: (event) => {
            if (!canControl) return;
            void adapter.seek(
              playbackPositionFromTrackX(
                event.nativeEvent.locationX,
                trackWidth,
                durationMs,
              ),
            );
          },
          onPanResponderRelease: () => {},
          onPanResponderTerminate: () => {},
        }),
      [adapter, canControl, durationMs, trackWidth],
    );

    return (
      <View style={[styles.card, { backgroundColor: colors.bg.soft }]}>
        <View style={styles.topRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? '暂停播放' : '播放录音'}
            disabled={!canControl}
            onPress={() =>
              void (isPlaying ? adapter.pause() : adapter.play())
            }
            style={({ pressed }) => [
              styles.toggle,
              {
                backgroundColor: canControl
                  ? pressed
                    ? colors.primaryActive
                    : colors.primary
                  : colors.bg.card,
              },
            ]}
          >
            {isPlaying ? (
              <Pause
                size={20}
                color={canControl ? colors.onPrimary : colors.text.soft}
              />
            ) : (
              <Play
                size={20}
                color={canControl ? colors.onPrimary : colors.text.soft}
              />
            )}
          </Pressable>

          <View style={styles.meta}>
            <Text style={[styles.times, { color: colors.text.ink }]}>
              {formatDuration(snapshot.positionMs)} / {formatDuration(durationMs)}
            </Text>
            {detailText ? (
              <Text style={[styles.detail, { color: colors.text.soft }]}>
                {detailText}
              </Text>
            ) : null}
          </View>
        </View>

        <View
          {...trackResponder.panHandlers}
          testID="audio-player-track-area"
          onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
          style={styles.seekArea}
          accessibilityRole="adjustable"
          accessibilityLabel="播放进度"
        >
          <View
            testID="audio-player-inactive-track"
            pointerEvents="none"
            style={[
              styles.inactiveTrack,
              { backgroundColor: colors.border.default },
            ]}
          />
          <View
            testID="audio-player-played-track"
            pointerEvents="none"
            style={[
              styles.playedTrack,
              {
                backgroundColor: canControl
                  ? colors.primary
                  : colors.text.soft,
                width: `${progressRatio * 100}%`,
              },
            ]}
          />
          {trackWidth > 0 ? (
            <View
              testID="audio-player-thumb"
              pointerEvents="none"
              style={[
                styles.thumb,
                {
                  backgroundColor: canControl
                    ? colors.primary
                    : colors.text.soft,
                  left: playbackThumbLeft(progressRatio, trackWidth),
                },
              ]}
            />
          ) : null}
        </View>

        {snapshot.state === 'failed' && snapshot.error ? (
          <Text style={[styles.error, { color: colors.status.error }]}>
            {snapshot.error} 录音文件本身不受影响。
          </Text>
        ) : null}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggle: {
    width: 46,
    height: 46,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1, gap: 2 },
  times: {
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  detail: { fontSize: 13, lineHeight: 19 },
  seekArea: {
    position: 'relative',
    height: 32,
  },
  inactiveTrack: {
    position: 'absolute',
    top: 14,
    left: 0,
    right: 0,
    height: 4,
    borderRadius: radius.full,
  },
  playedTrack: {
    position: 'absolute',
    top: 14,
    left: 0,
    height: 4,
    borderRadius: radius.full,
  },
  thumb: {
    position: 'absolute',
    top: 9,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radius.full,
  },
  error: { fontSize: 12, lineHeight: 18 },
});
