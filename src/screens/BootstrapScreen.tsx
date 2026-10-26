import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Cloud, Cpu, Monitor, Puzzle } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';

export function BootstrapScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        <View style={styles.intro}>
          <Text style={[styles.eyebrow, { color: colors.primary }]}>Mira Mobile</Text>
          <Text style={[styles.title, { color: colors.text.ink }]}>选择你现在要做的事</Text>
          <Text style={[styles.description, { color: colors.text.soft }]}>连接 Desktop 和使用独立插件是两条并列入口，不需要先完成桌面配对。</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="连接 Mira Desktop"
          onPress={() => navigation.navigate('HostConfig')}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.bg.soft }]}>
            <Monitor size={22} color={colors.primary} />
          </View>
          <View style={styles.actionText}>
            <Text style={[styles.actionTitle, { color: colors.text.ink }]}>连接 Desktop</Text>
            <Text style={[styles.actionDescription, { color: colors.text.soft }]}>配对本机 Mira Host，进入远程会话与项目。</Text>
          </View>
          <ChevronRight size={20} color={colors.text.soft} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mira Cloud 账户"
          onPress={() => navigation.navigate('CloudAccount')}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.bg.soft }]}>
            <Cloud size={22} color={colors.primary} />
          </View>
          <View style={styles.actionText}>
            <Text style={[styles.actionTitle, { color: colors.text.ink }]}>Mira Cloud 账户</Text>
            <Text style={[styles.actionDescription, { color: colors.text.soft }]}>可选登录，使用 Mira 云服务；不影响本地模型与直连。</Text>
          </View>
          <ChevronRight size={20} color={colors.text.soft} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开 Mira 插件"
          onPress={() => navigation.navigate('Plugins')}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.bg.soft }]}>
            <Puzzle size={22} color={colors.primary} />
          </View>
          <View style={styles.actionText}>
            <Text style={[styles.actionTitle, { color: colors.text.ink }]}>插件</Text>
            <Text style={[styles.actionDescription, { color: colors.text.soft }]}>直接进入拾言等独立能力，无需连接 Desktop。</Text>
          </View>
          <ChevronRight size={20} color={colors.text.soft} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="配置本地大模型"
          onPress={() => navigation.navigate('LocalProviderConfig')}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.bg.soft }]}>
            <Cpu size={22} color={colors.primary} />
          </View>
          <View style={styles.actionText}>
            <Text style={[styles.actionTitle, { color: colors.text.ink }]}>本地大模型</Text>
            <Text style={[styles.actionDescription, { color: colors.text.soft }]}>配置本地模型 Provider，在设备侧直接对话。</Text>
          </View>
          <ChevronRight size={20} color={colors.text.soft} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  intro: { gap: spacing.sm, marginBottom: spacing.lg },
  eyebrow: { fontSize: 13, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
  description: { fontSize: 15, lineHeight: 22 },
  action: {
    minHeight: 92,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { flex: 1, gap: 5 },
  actionTitle: { fontSize: 16, fontWeight: '600' },
  actionDescription: { fontSize: 13, lineHeight: 19 },
});
