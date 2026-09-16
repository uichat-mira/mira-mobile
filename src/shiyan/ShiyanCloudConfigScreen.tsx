import React, { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ArrowLeft, KeyRound, Trash2 } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import {
  clearShiyanRuntimeConfig,
  loadShiyanRuntimeConfig,
  saveShiyanRuntimeConfig,
} from './client/runtimeConfig';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function ShiyanCloudConfigScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [baseUrl, setBaseUrl] = useState('');
  const [credentialInput, setCredentialInput] = useState('');
  const [hasCredential, setHasCredential] = useState(false);
  const [busy, setBusy] = useState(false);
  const existingCredentialRef = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void loadShiyanRuntimeConfig()
        .then((config) => {
          if (!active) return;
          setBaseUrl(config?.baseUrl ?? '');
          setHasCredential(Boolean(config?.credential));
          existingCredentialRef.current = config?.credential ?? null;
          setCredentialInput('');
        })
        .catch(() => {
          if (!active) return;
          setHasCredential(false);
          existingCredentialRef.current = null;
        });
      return () => {
        active = false;
        existingCredentialRef.current = null;
      };
    }, []),
  );

  const save = async () => {
    const credential = credentialInput.trim() || existingCredentialRef.current;
    if (!baseUrl.trim()) {
      Alert.alert('请填写 Cloud 地址', '例如 https://shiyan.example.com');
      return;
    }
    if (!credential) {
      Alert.alert('请填写设备凭证', '拾言设备凭证与 Desktop Host 配对凭证彼此独立。');
      return;
    }

    setBusy(true);
    try {
      await saveShiyanRuntimeConfig({ baseUrl, credential });
      existingCredentialRef.current = credential;
      setCredentialInput('');
      setHasCredential(true);
      Alert.alert('拾言 Cloud 已保存', '配置只用于拾言 Cloud，不会改动 Desktop Host 连接。');
    } catch (error) {
      Alert.alert('无法保存配置', error instanceof Error ? error.message : '请检查地址与当前构建。');
    } finally {
      setBusy(false);
    }
  };

  const clear = () => {
    Alert.alert('清除拾言 Cloud 配置？', '只会移除拾言 Cloud 地址和设备凭证，不影响本地录音或 Desktop Host。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void clearShiyanRuntimeConfig()
            .then(() => {
              existingCredentialRef.current = null;
              setBaseUrl('');
              setCredentialInput('');
              setHasCredential(false);
            })
            .catch((error) => {
              Alert.alert('无法清除配置', error instanceof Error ? error.message : '请稍后重试。');
            })
            .finally(() => setBusy(false));
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="返回" onPress={() => navigation.goBack()} style={styles.headerButton}>
          <ArrowLeft size={22} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>拾言 Cloud</Text>
        <View style={styles.headerButton} />
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: colors.text.base }]}>Cloud API 地址</Text>
        <TextInput
          value={baseUrl}
          onChangeText={setBaseUrl}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="https://shiyan.example.com"
          placeholderTextColor={colors.text.soft}
          style={[styles.input, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
        />

        <Text style={[styles.label, { color: colors.text.base }]}>设备凭证</Text>
        <View style={styles.credentialHeader}>
          <KeyRound size={16} color={hasCredential ? colors.primary : colors.text.soft} />
          <Text style={[styles.description, { color: colors.text.soft }]}>
            {hasCredential ? '已安全保存。留空表示继续使用现有凭证。' : '首次连接时需要填写。'}
          </Text>
        </View>
        <TextInput
          value={credentialInput}
          onChangeText={setCredentialInput}
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder={hasCredential ? '留空保持现有凭证' : '粘贴拾言设备凭证'}
          placeholderTextColor={colors.text.soft}
          style={[styles.input, { color: colors.text.ink, backgroundColor: colors.bg.card, borderColor: colors.border.default }]}
        />

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void save()}
          style={({ pressed }) => [styles.primaryButton, { backgroundColor: busy ? colors.primaryDisabled : pressed ? colors.primaryActive : colors.primary }]}
        >
          <Text style={{ color: colors.onPrimary, fontWeight: '600' }}>{busy ? '正在保存…' : '保存拾言 Cloud 配置'}</Text>
        </Pressable>

        {hasCredential || baseUrl ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={clear} style={styles.clearButton}>
            <Trash2 size={16} color={colors.text.soft} />
            <Text style={{ color: colors.text.soft }}>清除拾言 Cloud 配置</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600' },
  content: { padding: spacing.lg, paddingBottom: 56, gap: spacing.md },
  description: { fontSize: 13, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '600', marginTop: spacing.sm },
  input: { minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 14 },
  credentialHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  primaryButton: { minHeight: 48, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm },
  clearButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
});
