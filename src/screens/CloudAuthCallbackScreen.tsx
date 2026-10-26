import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AlertCircle, CheckCircle2 } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { deviceCredentialStore } from '../security/deviceCredentialStore';
import {
  useCloudAccountStore,
  type CloudAccountStatus,
} from '../cloud/cloudAccountStore';

type CallbackRoute = RouteProp<RootStackParamList, 'CloudAuthCallback'>;

export function CloudAuthCallbackScreen() {
  const route = useRoute<CallbackRoute>();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const completeSignIn = useCloudAccountStore(state => state.completeSignIn);
  const message = useCloudAccountStore(state => state.message);
  const [phase, setPhase] = useState<'working' | 'done'>('working');
  const [result, setResult] = useState<CloudAccountStatus | null>(null);
  const handled = useRef(false);

  const code = route.params?.code;
  const state = route.params?.state;
  const error = route.params?.error;

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    void completeSignIn({ code, state, error })
      .then(nextStatus => {
        setResult(nextStatus);
      })
      .finally(() => {
        setPhase('done');
      });
  }, [code, completeSignIn, error, state]);

  const succeeded = result === 'signed_in' && !message;
  const detailMarker = '\n错误详情：';
  const detailAt = message?.indexOf(detailMarker) ?? -1;
  const summary = detailAt >= 0 ? message?.slice(0, detailAt) : message;
  const diagnosticDetail = detailAt >= 0 ? message?.slice(detailAt + detailMarker.length) : null;

  const returnToAccount = async () => {
    const routes = navigation.getState().routes;
    if (routes.some(item => item.name === 'CloudAccount')) {
      navigation.popTo('CloudAccount');
      return;
    }

    // A cold OAuth deep link can have only the callback in history. Restore
    // a usable entry route so Back still reaches Local Provider/Host choices.
    const hasRemoteCredential = routes.some(item => item.name === 'SessionList')
      ? true
      : await deviceCredentialStore.load().then(Boolean).catch(() => false);
    const root = hasRemoteCredential ? 'SessionList' : 'Bootstrap';
    navigation.reset({
      index: 1,
      routes: [{ name: root }, { name: 'CloudAccount' }],
    });
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        {phase === 'working' ? (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.title, { color: colors.text.ink }]}>
              正在完成 Mira Cloud 登录…
            </Text>
            <Text style={[styles.description, { color: colors.text.soft }]}>
              正在校验回调并向 Mira Cloud 交换设备会话。
            </Text>
          </>
        ) : succeeded ? (
          <>
            <View
              style={[styles.icon, { backgroundColor: colors.status.success }]}
            >
              <CheckCircle2 size={30} color={colors.onPrimary} />
            </View>
            <Text style={[styles.title, { color: colors.text.ink }]}>
              已登录 Mira Cloud
            </Text>
            <Text style={[styles.description, { color: colors.text.soft }]}>
              这台设备已绑定到当前账户。下次启动会从系统安全存储恢复登录状态。
            </Text>
          </>
        ) : (
          <>
            <View
              style={[styles.icon, { backgroundColor: colors.status.errorBg }]}
            >
              <AlertCircle size={30} color={colors.status.error} />
            </View>
            <Text style={[styles.title, { color: colors.text.ink }]}>
              未完成 Mira Cloud 登录
            </Text>
            <Text style={[styles.description, { color: colors.text.soft }]}>
              {summary ?? '登录回调未通过校验，请重新发起登录。'}
            </Text>
            {diagnosticDetail ? (
              <View style={[styles.diagnostic, { backgroundColor: colors.bg.card }]}>
                <Text style={[styles.diagnosticLabel, { color: colors.text.soft }]}>
                  错误详情（可截图）
                </Text>
                <Text selectable style={[styles.diagnosticText, { color: colors.text.ink }]}>
                  {diagnosticDetail}
                </Text>
              </View>
            ) : null}
          </>
        )}

        {phase === 'done' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回 Mira Cloud 账户"
            onPress={returnToAccount}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: colors.primary },
              pressed && { opacity: 0.78 },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.onPrimary }]}>
              返回 Mira Cloud 账户
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.titleLg,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: fontSize.bodyMd,
    lineHeight: 24,
    textAlign: 'center',
  },
  diagnostic: {
    alignSelf: 'stretch',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  diagnosticLabel: { fontSize: fontSize.bodySm },
  diagnosticText: { fontSize: fontSize.bodySm, lineHeight: 22 },
  button: {
    marginTop: spacing.lg,
    minHeight: sizing.touchTarget,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
});
