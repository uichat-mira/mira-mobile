import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera, CameraType } from 'react-native-camera-kit';
import {
  check,
  openSettings,
  PERMISSIONS,
  request,
  RESULTS,
  type Permission,
} from 'react-native-permissions';
import { ScanLine, Settings, X } from 'lucide-react-native';
import { parseScannedPairingUri } from '../pairing/parseScannedPairingUri';

type CameraState =
  | 'checking'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'unavailable';

const cameraPermission: Permission =
  Platform.OS === 'ios' ? PERMISSIONS.IOS.CAMERA : PERMISSIONS.ANDROID.CAMERA;

interface PairingScannerModalProps {
  visible: boolean;
  onClose: () => void;
  onScanned: (pairingUri: string) => void;
}

export function PairingScannerModal({
  visible,
  onClose,
  onScanned,
}: PairingScannerModalProps) {
  const [cameraState, setCameraState] = useState<CameraState>('checking');
  const [scanError, setScanError] = useState<string | null>(null);
  const scanLocked = useRef(false);
  const { width: windowWidth } = useWindowDimensions();
  const finderSize = Math.min(Math.max(windowWidth - 48, 0), 300);

  const ensureCameraPermission = useCallback(async () => {
    setCameraState('checking');
    try {
      const current = await check(cameraPermission);
      const next =
        current === RESULTS.DENIED ? await request(cameraPermission) : current;
      if (next === RESULTS.GRANTED || next === RESULTS.LIMITED) {
        setCameraState('granted');
      } else if (next === RESULTS.BLOCKED) {
        setCameraState('blocked');
      } else if (next === RESULTS.UNAVAILABLE) {
        setCameraState('unavailable');
      } else {
        setCameraState('denied');
      }
    } catch {
      setCameraState('unavailable');
    }
  }, []);

  useEffect(() => {
    if (!visible) {
      scanLocked.current = false;
      setScanError(null);
      return;
    }
    ensureCameraPermission().catch(() => setCameraState('unavailable'));
  }, [ensureCameraPermission, visible]);

  const handleReadCode = useCallback(
    (value: string | null | undefined) => {
      if (scanLocked.current) return;
      scanLocked.current = true;
      try {
        if (!value || !value.trim()) {
          throw new Error('empty pairing code');
        }
        onScanned(parseScannedPairingUri(value));
      } catch {
        setScanError('这不是有效的 Mira 配对二维码');
        setTimeout(() => {
          scanLocked.current = false;
        }, 1200);
      }
    },
    [onScanned],
  );

  const permissionMessage =
    cameraState === 'blocked'
      ? '相机权限已被关闭，请在系统设置中允许 Mira 使用相机。'
      : cameraState === 'unavailable'
      ? '当前设备无法使用相机扫码，请粘贴完整配对链接。'
      : '需要相机权限才能扫描配对二维码。';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭扫码"
            onPress={onClose}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
          >
            <X size={24} color="#ffffff" />
          </Pressable>
          <Text style={styles.title}>扫描配对二维码</Text>
          <View style={styles.headerSpacer} />
        </View>

        {cameraState === 'granted' ? (
          <View style={styles.cameraContainer}>
            <Camera
              style={StyleSheet.absoluteFill}
              cameraType={CameraType.Back}
              scanBarcode
              allowedBarcodeTypes={['qr']}
              showFrame={false}
              scanThrottleDelay={800}
              onReadCode={event =>
                handleReadCode(event.nativeEvent.codeStringValue)
              }
              onError={() => setCameraState('unavailable')}
            />
            <View pointerEvents="none" style={styles.finderLayer}>
              <View
                style={[styles.finder, { width: finderSize, height: finderSize }]}
              >
                <View style={[styles.finderCorner, styles.finderCornerTopLeft]} />
                <View style={[styles.finderCorner, styles.finderCornerTopRight]} />
                <View style={[styles.finderCorner, styles.finderCornerBottomLeft]} />
                <View style={[styles.finderCorner, styles.finderCornerBottomRight]} />
              </View>
            </View>
            {scanError ? (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{scanError}</Text>
              </View>
            ) : null}
          </View>
        ) : cameraState === 'checking' ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color="#ffffff" />
          </View>
        ) : (
          <View style={styles.centered}>
            <ScanLine size={42} color="#ffffff" />
            <Text style={styles.permissionText}>{permissionMessage}</Text>
            {cameraState === 'blocked' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  openSettings('application').catch(() =>
                    setCameraState('unavailable'),
                  )
                }
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}
              >
                <Settings size={18} color="#111111" />
                <Text style={styles.actionText}>打开系统设置</Text>
              </Pressable>
            ) : cameraState === 'denied' ? (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  ensureCameraPermission().catch(() =>
                    setCameraState('unavailable'),
                  )
                }
                style={({ pressed }) => [
                  styles.actionButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionText}>重新授权</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#090909' },
  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerSpacer: { width: 44 },
  cameraContainer: { flex: 1, overflow: 'hidden' },
  finderLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finder: {
    aspectRatio: 1,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 12,
  },
  finderCorner: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: '#ffffff',
  },
  finderCornerTopLeft: {
    top: -1,
    left: -1,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderTopLeftRadius: 12,
  },
  finderCornerTopRight: {
    top: -1,
    right: -1,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderTopRightRadius: 12,
  },
  finderCornerBottomLeft: {
    bottom: -1,
    left: -1,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderBottomLeftRadius: 12,
  },
  finderCornerBottomRight: {
    bottom: -1,
    right: -1,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderBottomRightRadius: 12,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 18,
  },
  permissionText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: '#ffffff',
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  actionText: { color: '#111111', fontSize: 15, fontWeight: '700' },
  errorBanner: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 36,
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: 'rgba(127, 29, 29, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  errorText: { color: '#ffffff', fontSize: 14, textAlign: 'center' },
  pressed: { opacity: 0.72 },
});
