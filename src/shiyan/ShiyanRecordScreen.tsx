import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Mic2, Pause, Play, Square } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import { ShiyanScreenShell } from './ShiyanScreenShell';
import { useShiyanRecordingSession } from './recording/useShiyanRecordingSession';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export function ShiyanRecordScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShiyanRecord'>>();
  const { colors } = useTheme();
  const session = useShiyanRecordingSession({
    sceneId: route.params.sceneId,
    sceneName: route.params.sceneName,
  });

  const start = async () => {
    const result = await session.start();
    switch (result.status) {
      case 'blocked':
        Alert.alert('需要麦克风权限', '请在系统设置中允许 Mira 使用麦克风。', [
          { text: '取消', style: 'cancel' },
          { text: '打开设置', onPress: () => void session.openPermissionSettings() },
        ]);
        break;
      case 'unavailable':
        Alert.alert('无法录音', '当前设备或系统版本不提供可用的麦克风录音权限。');
        break;
      case 'denied':
        Alert.alert('未获得麦克风权限', '允许麦克风权限后才能开始拾言录音。');
        break;
      case 'failed':
        Alert.alert('无法开始录音', result.message);
        break;
      case 'started':
        break;
    }
  };

  const stop = async () => {
    const result = await session.stop();
    if (result.status === 'completed') {
      navigation.replace('ShiyanCaptureConfirm', { captureId: result.captureId });
    } else {
      Alert.alert('无法结束录音', result.message);
    }
  };

  const cancel = () => {
    if (!session.hasActiveSession) {
      navigation.goBack();
      return;
    }
    Alert.alert('取消这次录音？', '取消后会删除本次尚未完成的本地录音文件。', [
      { text: '继续录音', style: 'cancel' },
      {
        text: '删除并退出',
        style: 'destructive',
        onPress: () => {
          void session.cancel().finally(() => navigation.goBack());
        },
      },
    ]);
  };

  return (
    <ShiyanScreenShell title="录音" onBack={cancel}>
      <View style={styles.recordingBody}>
        <Text style={[styles.eyebrow, { color: colors.text.soft }]}>{route.params.sceneName}</Text>
        <Text style={[styles.timer, { color: colors.text.ink }]}>{formatDuration(session.snapshot.durationMs)}</Text>
        <Text style={[styles.recordingHint, { color: colors.text.soft }]}>
          {session.snapshot.state === 'paused' ? '录音已暂停，文件仍保留在本机。' : session.active ? '正在录音，仅写入 App 私有目录。' : '点击开始后才会申请麦克风权限。'}
        </Text>

        {!session.active ? (
          <Pressable
            accessibilityRole="button"
            disabled={session.busy || session.snapshot.state !== 'idle'}
            onPress={() => void start()}
            style={({ pressed }) => [styles.recordButton, { backgroundColor: pressed ? colors.primaryActive : colors.primary }]}
          >
            <Mic2 size={24} color={colors.onPrimary} />
            <Text style={[styles.primaryButtonText, { color: colors.onPrimary }]}>{session.busy ? '正在准备' : '开始录音'}</Text>
          </Pressable>
        ) : (
          <View style={styles.recordActions}>
            <Pressable
              accessibilityRole="button"
              disabled={session.busy}
              onPress={() => void (session.snapshot.state === 'paused' ? session.resume() : session.pause())}
              style={[styles.roundAction, { backgroundColor: colors.bg.soft }]}
            >
              {session.snapshot.state === 'paused' ? <Play size={24} color={colors.primary} /> : <Pause size={24} color={colors.primary} />}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={session.busy}
              onPress={() => void stop()}
              style={[styles.stopAction, { backgroundColor: colors.primary }]}
            >
              <Square size={24} color={colors.onPrimary} fill={colors.onPrimary} />
            </Pressable>
          </View>
        )}
      </View>
    </ShiyanScreenShell>
  );
}

const styles = StyleSheet.create({
  recordingBody: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.lg },
  eyebrow: { fontSize: 13, fontWeight: '600' },
  timer: { fontSize: 54, fontWeight: '300', letterSpacing: 2, fontVariant: ['tabular-nums'] },
  recordingHint: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  recordButton: { minHeight: 58, minWidth: 190, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.xl },
  primaryButtonText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  recordActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  roundAction: { width: 58, height: 58, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  stopAction: { width: 68, height: 68, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
});
