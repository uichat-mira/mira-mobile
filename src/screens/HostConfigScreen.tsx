import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CheckCircle2,
  ChevronLeft,
  KeyRound,
  ScanLine,
  ShieldCheck,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useHostStore } from '../store/hostStore';
import { useTailscaleConnectivityStore } from '../store/tailscaleConnectivityStore';
import {
  parsePairingUriV1,
  type PairingDescriptorV1,
} from '../protocol/remotePairingV1';
import { remoteMiraHostClient } from '../api/remoteMiraHost';
import { useRemotePairing } from '../pairing/useRemotePairing';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { PairingScannerModal } from '../components/PairingScannerModal';

const buildPairingUriFromRoute = (
  params: RootStackParamList['HostConfig'],
): string | null => {
  if (!params) return null;
  const { version, host, relay, relayId, relayToken, challenge, code } = params;
  if (!version && !host && !relay && !relayId && !relayToken && !challenge && !code) {
    return null;
  }
  if (!version || !challenge || !code) {
    throw new Error('配对链接缺少 version、challenge 或 code');
  }

  const query = new URLSearchParams({ version, challenge, code });
  if (host) query.set('host', host);
  if (relay) query.set('relay', relay);
  if (relayId) query.set('relayId', relayId);
  if (relayToken) query.set('relayToken', relayToken);
  return `mira://pair?${query.toString()}`;
};

export function HostConfigScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'HostConfig'>>();
  const { colors } = useTheme();
  const { config, setConfig, clearConfig, setConnectionStatus } = useHostStore();
  const setConnectivityHostUrl = useTailscaleConnectivityStore(
    state => state.setHostUrl,
  );
  const resetConnectivity = useTailscaleConnectivityStore(state => state.reset);

  const [pairingDescriptor, setPairingDescriptor] =
    useState<PairingDescriptorV1 | null>(null);
  const [pairingUriInput, setPairingUriInput] = useState('');
  const [pairingLinkError, setPairingLinkError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [authorizationSheetOpen, setAuthorizationSheetOpen] = useState(false);
  const [successToastVisible, setSuccessToastVisible] = useState(false);
  const pairedHandledRef = useRef(false);

  const {
    state: pairingState,
    start: startPairing,
    reset: resetPairing,
    secureStorageAvailable,
  } = useRemotePairing(pairingDescriptor);

  const restoreCurrentConnectivityTarget = useCallback(() => {
    setConnectivityHostUrl(config?.hostUrl ?? '');
  }, [config?.hostUrl, setConnectivityHostUrl]);

  const loadPairingUri = useCallback(
    (uri: string) => {
      try {
        const descriptor = parsePairingUriV1(uri);
        pairedHandledRef.current = false;
        resetPairing();
        setPairingDescriptor(descriptor);
        setPairingLinkError(null);
        setAuthorizationSheetOpen(true);

        if (descriptor.hostUrl) {
          setConnectivityHostUrl(descriptor.hostUrl);
          const current = useTailscaleConnectivityStore.getState();
          if (
            current.hostUrl !== descriptor.hostUrl ||
            (current.state !== 'probing' && current.state !== 'ready')
          ) {
            void current.probe(descriptor.hostUrl, 'manual').catch(() => {
              // Pairing transport selection owns the final Direct/Relay choice.
              // This warm-up probe must not invalidate an otherwise valid URI.
            });
          }
        } else {
          setConnectivityHostUrl('');
        }
        return true;
      } catch (error) {
        resetPairing();
        setPairingDescriptor(null);
        setAuthorizationSheetOpen(false);
        restoreCurrentConnectivityTarget();
        setPairingLinkError(
          error instanceof Error ? error.message : '无法读取桌面配对链接',
        );
        return false;
      }
    },
    [resetPairing, restoreCurrentConnectivityTarget, setConnectivityHostUrl],
  );

  useEffect(() => {
    try {
      const uri = buildPairingUriFromRoute(route.params);
      if (uri) loadPairingUri(uri);
    } catch (error) {
      resetPairing();
      setPairingDescriptor(null);
      setAuthorizationSheetOpen(false);
      restoreCurrentConnectivityTarget();
      setPairingLinkError(
        error instanceof Error ? error.message : '无法读取桌面配对链接',
      );
    }
  }, [
    loadPairingUri,
    resetPairing,
    restoreCurrentConnectivityTarget,
    route.params,
  ]);

  useEffect(() => {
    if (
      pairingState.phase !== 'paired' ||
      !pairingDescriptor ||
      pairedHandledRef.current
    ) {
      return;
    }

    pairedHandledRef.current = true;
    if (pairingDescriptor.hostUrl) {
      setConfig({ hostUrl: pairingDescriptor.hostUrl, token: '' });
    } else {
      // Relay-only pairing has no Direct Host URL. The secure paired-device
      // credential remains the connection truth; do not masquerade Relay as a
      // Tailscale/Mira Host HTTP URL in the local host store.
      clearConfig();
      resetConnectivity();
    }
    setConnectionStatus('connected');
    setAuthorizationSheetOpen(false);
    setSuccessToastVisible(true);

    const navigationTimer = setTimeout(() => {
      navigation.reset({ index: 0, routes: [{ name: 'SessionList' }] });
    }, 650);

    return () => clearTimeout(navigationTimer);
  }, [
    clearConfig,
    navigation,
    pairingDescriptor,
    pairingState.phase,
    resetConnectivity,
    setConfig,
    setConnectionStatus,
  ]);

  const pairingBusy =
    pairingState.phase === 'claiming' ||
    pairingState.phase === 'waiting_approval';
  const pairingClaimUncertain =
    pairingState.phase === 'error' &&
    pairingState.message?.includes('状态不确定') === true;
  const pairingDeliveredWithoutSave =
    pairingState.phase === 'error' &&
    pairingState.pending !== null &&
    pairingState.deviceId !== null;
  const pairingCanRetry =
    pairingState.phase === 'error' &&
    !pairingClaimUncertain &&
    !pairingDeliveredWithoutSave &&
    secureStorageAvailable;

  const pairingTitle = (() => {
    switch (pairingState.phase) {
      case 'claiming':
        return '正在提交配对申请';
      case 'waiting_approval':
        return '等待桌面确认';
      case 'paired':
        return '配对成功';
      case 'rejected':
        return '桌面已拒绝';
      case 'expired':
        return '配对请求已过期';
      case 'error':
        return pairingDeliveredWithoutSave ? '需要重新配对' : '配对未完成';
      case 'blocked':
        return '配对未完成';
      default:
        return '已识别配对请求';
    }
  })();

  const pairingMessage = (() => {
    switch (pairingState.phase) {
      case 'claiming':
        return '正在连接 Mira Desktop 并提交此设备。';
      case 'waiting_approval':
        return '请在 Mira Desktop 上批准此设备。';
      case 'paired':
        return '桌面已批准，正在返回会话列表。';
      case 'rejected':
        return '此次申请已被桌面拒绝，请关闭后重新生成配对请求。';
      case 'expired':
        return '一次性配对请求已过期，请关闭后在桌面重新生成。';
      case 'blocked':
        return '当前构建无法安全保存设备凭据，请关闭后检查系统安全存储。';
      case 'error':
        if (pairingClaimUncertain) {
          return pairingState.message ?? '配对申请状态不确定，请先在桌面确认申请状态。';
        }
        if (pairingDeliveredWithoutSave) {
          return '设备凭证已被领取，但本机没有完成保存，请关闭后重新配对。';
        }
        return '配对未完成，请检查手机网络和 Mira Desktop 后重试。';
      default:
        return secureStorageAvailable
          ? '提交后，请在桌面端确认此设备。'
          : '当前构建无法安全保存设备凭据，不能提交配对申请。';
    }
  })();

  const handlePastePairingUri = () => {
    const uri = pairingUriInput.trim();
    if (!uri) {
      resetPairing();
      setPairingDescriptor(null);
      setAuthorizationSheetOpen(false);
      restoreCurrentConnectivityTarget();
      setPairingLinkError('请粘贴完整的 Mira 配对链接');
      return;
    }
    loadPairingUri(uri);
  };

  const handleAuthorizationClose = useCallback(() => {
    if (pairingBusy) return;
    setAuthorizationSheetOpen(false);
    resetPairing();
    setPairingDescriptor(null);
    setPairingUriInput('');
    setPairingLinkError(null);
    restoreCurrentConnectivityTarget();
  }, [pairingBusy, resetPairing, restoreCurrentConnectivityTarget]);

  const handleDisconnect = async () => {
    if (secureStorageAvailable) await remoteMiraHostClient.disconnect();
    clearConfig();
    resetConnectivity();
    resetPairing();
    setPairingUriInput('');
    setPairingDescriptor(null);
    setPairingLinkError(null);
    setAuthorizationSheetOpen(false);
    setSuccessToastVisible(false);
    setConnectionStatus('disconnected');
  };

  const handleBack = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('SessionList');
  };

  const authorizationPrimaryVisible =
    pairingState.phase === 'idle' || pairingBusy || pairingCanRetry;
  const authorizationPrimaryDisabled =
    pairingBusy ||
    (pairingState.phase === 'idle' && !secureStorageAvailable);
  const authorizationPrimaryLabel =
    pairingState.phase === 'claiming'
      ? '正在提交'
      : pairingState.phase === 'waiting_approval'
        ? '等待桌面确认'
        : pairingCanRetry
          ? '重试配对'
          : secureStorageAvailable
            ? '提交配对申请'
            : '无法提交';

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { borderBottomColor: colors.border.soft }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={handleBack}
          style={styles.backBtn}
        >
          <ChevronLeft size={24} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>连接桌面端</Text>
        <View style={styles.headerSpacer} />
      </View>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.form}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <View
              style={[
                styles.heroIcon,
                {
                  backgroundColor: colors.bg.card,
                  borderColor: colors.border.default,
                },
              ]}
            >
              <ShieldCheck size={36} color={colors.primary} strokeWidth={1.6} />
            </View>
            <Text style={[styles.heroTitle, { color: colors.text.ink }]}>设备配对</Text>
            <Text style={[styles.heroSubtitle, { color: colors.text.muted }]}> 
              扫描 Mira Desktop 上的配对二维码
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="扫码配对"
            onPress={() => setScannerOpen(true)}
            style={({ pressed }) => [
              styles.scanBtn,
              { backgroundColor: colors.primary },
              pressed && { backgroundColor: colors.primaryActive },
            ]}
          >
            <ScanLine size={19} color={colors.onPrimary} />
            <Text style={[styles.scanBtnText, { color: colors.onPrimary }]}>扫码配对</Text>
          </Pressable>

          <View style={styles.pasteSection}>
            <Text style={[styles.pasteLabel, { color: colors.text.muted }]}> 
              或粘贴配对链接
            </Text>
            <TextInput
              accessibilityLabel="Mira 配对链接"
              style={[
                styles.input,
                {
                  borderColor: pairingLinkError
                    ? colors.status.error
                    : colors.border.default,
                  backgroundColor: colors.bg.input,
                  color: colors.text.ink,
                },
              ]}
              value={pairingUriInput}
              onChangeText={value => {
                setPairingUriInput(value);
                resetPairing();
                setPairingDescriptor(null);
                setAuthorizationSheetOpen(false);
                restoreCurrentConnectivityTarget();
                if (pairingLinkError) setPairingLinkError(null);
              }}
              placeholder="mira://pair?..."
              placeholderTextColor={colors.text.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!pairingBusy}
              onSubmitEditing={handlePastePairingUri}
              returnKeyType="go"
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="继续"
              style={({ pressed }) => [
                styles.continueBtn,
                { borderColor: colors.border.default },
                pressed && { backgroundColor: colors.bg.soft },
                !pairingUriInput.trim() && styles.disabled,
              ]}
              onPress={handlePastePairingUri}
              disabled={!pairingUriInput.trim() || pairingBusy}
            >
              <KeyRound size={18} color={colors.text.ink} />
              <Text style={[styles.continueBtnText, { color: colors.text.ink }]}>继续</Text>
            </Pressable>

            {pairingLinkError ? (
              <Text style={[styles.inlineError, { color: colors.status.error }]}> 
                {pairingLinkError}
              </Text>
            ) : null}
          </View>

          {config ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="断开并清除设备授权"
              style={[styles.disconnectBtn, { borderColor: colors.status.errorBg }]}
              onPress={handleDisconnect}
            >
              <Text style={[styles.disconnectBtnText, { color: colors.status.error }]}> 
                断开并清除设备授权
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <PairingScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScanned={uri => {
          if (loadPairingUri(uri)) {
            setScannerOpen(false);
          }
        }}
      />

      <Modal
        visible={authorizationSheetOpen}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={handleAuthorizationClose}
      >
        <View style={styles.sheetRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭 Mira 授权"
            disabled={pairingBusy}
            onPress={handleAuthorizationClose}
            style={[
              StyleSheet.absoluteFill,
              { backgroundColor: colors.overlay },
            ]}
          />
          <SafeAreaView
            edges={['bottom']}
            style={[
              styles.authorizationSheet,
              { backgroundColor: colors.bg.elevated },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border.default }]} />
            <View style={styles.sheetHeading}>
              <View
                style={[
                  styles.sheetIcon,
                  { backgroundColor: colors.bg.soft },
                ]}
              >
                <ShieldCheck size={22} color={colors.primary} />
              </View>
              <View style={styles.sheetHeadingText}>
                <Text style={[styles.sheetTitle, { color: colors.text.ink }]}>Mira 授权</Text>
                <Text style={[styles.sheetStatus, { color: colors.text.muted }]}> 
                  {pairingTitle}
                </Text>
              </View>
            </View>

            <Text style={[styles.sheetMessage, { color: colors.text.base }]}> 
              {pairingMessage}
            </Text>

            {authorizationPrimaryVisible ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={authorizationPrimaryLabel}
                disabled={authorizationPrimaryDisabled}
                onPress={startPairing}
                style={({ pressed }) => [
                  styles.authorizationPrimaryBtn,
                  {
                    backgroundColor: authorizationPrimaryDisabled
                      ? colors.primaryDisabled
                      : colors.primary,
                  },
                  pressed && !authorizationPrimaryDisabled
                    ? { backgroundColor: colors.primaryActive }
                    : null,
                ]}
              >
                {pairingBusy ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <KeyRound size={18} color={colors.onPrimary} />
                )}
                <Text
                  style={[
                    styles.authorizationPrimaryText,
                    { color: colors.onPrimary },
                  ]}
                >
                  {authorizationPrimaryLabel}
                </Text>
              </Pressable>
            ) : null}

            {!pairingBusy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={pairingState.phase === 'idle' ? '取消授权' : '关闭授权'}
                onPress={handleAuthorizationClose}
                style={({ pressed }) => [
                  styles.authorizationCancelBtn,
                  pressed && { backgroundColor: colors.bg.soft },
                ]}
              >
                <Text style={[styles.authorizationCancelText, { color: colors.text.muted }]}> 
                  {pairingState.phase === 'idle' ? '取消' : '关闭'}
                </Text>
              </Pressable>
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>

      {successToastVisible ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.successToast,
            {
              backgroundColor: colors.bg.elevated,
              borderColor: colors.border.default,
            },
          ]}
        >
          <CheckCircle2 size={19} color={colors.status.success} />
          <Text style={[styles.successToastText, { color: colors.text.ink }]}>配对成功</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.titleLg,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerSpacer: { width: sizing.touchTarget },
  container: { flex: 1 },
  form: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.section,
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.xs,
    paddingBottom: spacing.section,
  },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heroTitle: {
    fontSize: fontSize.titleXl,
    fontWeight: '600',
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  scanBtn: {
    minHeight: 52,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  scanBtnText: { fontSize: fontSize.md, fontWeight: '700' },
  pasteSection: { marginTop: spacing.xl },
  pasteLabel: {
    fontSize: fontSize.button,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.button,
    marginBottom: spacing.sm,
  },
  continueBtn: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  continueBtnText: { fontSize: fontSize.button, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  inlineError: {
    fontSize: fontSize.caption,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  disconnectBtn: {
    minHeight: 48,
    marginTop: spacing.section,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disconnectBtnText: { fontSize: fontSize.md, fontWeight: '600' },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  authorizationSheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: radius.full,
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  sheetHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sheetIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetHeadingText: { flex: 1 },
  sheetTitle: { fontSize: fontSize.titleLg, fontWeight: '700' },
  sheetStatus: {
    fontSize: fontSize.caption,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  sheetMessage: {
    fontSize: fontSize.md,
    lineHeight: 23,
    marginTop: spacing.lg,
  },
  authorizationPrimaryBtn: {
    minHeight: 50,
    marginTop: spacing.xl,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  authorizationPrimaryText: { fontSize: fontSize.md, fontWeight: '700' },
  authorizationCancelBtn: {
    minHeight: sizing.touchTarget,
    marginTop: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorizationCancelText: { fontSize: fontSize.button, fontWeight: '600' },
  successToast: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.xl,
    minHeight: 48,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  successToastText: { fontSize: fontSize.button, fontWeight: '700' },
});
