import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Layers,
  Lock,
  Mic2,
  ScrollText,
  Settings2,
  Sparkles,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import {
  SHIYAN_BUILT_IN_SCENES,
  getCustomSceneDraft,
  type ShiyanSceneDefinition,
} from './scenes';
import { ShiyanScreenShell } from './ShiyanScreenShell';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function ShiyanHomeScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [selectedSceneId, setSelectedSceneId] = useState(
    SHIYAN_BUILT_IN_SCENES[0]?.id ?? '',
  );
  const [customScene, setCustomScene] = useState<ShiyanSceneDefinition | null>(() =>
    getCustomSceneDraft(),
  );
  const [sceneSheetOpen, setSceneSheetOpen] = useState(false);

  const scenes = useMemo(
    () => (customScene ? [...SHIYAN_BUILT_IN_SCENES, customScene] : [...SHIYAN_BUILT_IN_SCENES]),
    [customScene],
  );
  const selectedScene =
    scenes.find((scene) => scene.id === selectedSceneId) ?? scenes[0] ?? null;

  useFocusEffect(
    useCallback(() => {
      setCustomScene(getCustomSceneDraft());
    }, []),
  );

  const startRecording = () => {
    if (!selectedScene) return;
    navigation.navigate('ShiyanRecord', {
      sceneId: selectedScene.id,
      sceneName: selectedScene.name,
    });
  };

  const shortcuts: readonly {
    key: string;
    title: string;
    caption: string;
    icon: React.ReactNode;
    onPress: () => void;
  }[] = [
    {
      key: 'history',
      title: '全部记录',
      caption: '查看所有拾言记录',
      icon: <ScrollText size={20} color={colors.primary} />,
      onPress: () => navigation.navigate('ShiyanHistory'),
    },
    {
      key: 'service-config',
      title: '服务配置',
      caption: '配置拾言服务连接',
      icon: <Settings2 size={20} color={colors.primary} />,
      onPress: () => navigation.navigate('ShiyanCloudConfig'),
    },
    {
      key: 'scene-config',
      title: '自定义场景',
      caption: '管理我的场景',
      icon: <Layers size={20} color={colors.primary} />,
      onPress: () => navigation.navigate('ShiyanSceneConfig'),
    },
    {
      key: 'organize-rules',
      title: '整理规则',
      caption: 'AI 如何整理你的内容',
      icon: <Sparkles size={20} color={colors.primary} />,
      onPress: () => navigation.navigate('ShiyanOrganizeRules'),
    },
  ];

  return (
    <ShiyanScreenShell title="拾言">
      <ScrollView contentContainerStyle={styles.homeContent}>
        <View style={styles.hero}>
          <View style={styles.heroText}>
            <Text style={[styles.heroTitle, { color: colors.text.ink }]}>先说下来，</Text>
            <Text style={[styles.heroTitle, { color: colors.primary }]}>再慢慢整理。</Text>
            <Text style={[styles.heroCaption, { color: colors.text.soft }]}>
              说出此刻的想法，未来的自己会感谢你。
            </Text>
          </View>
          <View style={[styles.heroArtWrap, { backgroundColor: colors.bg.soft }]}>
            <Image
              source={require('../../assets/shiyan/hero-mic-notebook.png')}
              style={styles.heroArt}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="开始拾言"
          disabled={!selectedScene}
          onPress={startRecording}
          style={({ pressed }) => [styles.startPanel, pressed && { opacity: 0.9 }]}
        >
          <View
            style={[styles.startPanelTint, { backgroundColor: colors.primary }]}
            pointerEvents="none"
          />
          <View style={[styles.startPanelHalo, { backgroundColor: colors.primary }]} pointerEvents="none" />
          <View style={[styles.startPanelIcon, { backgroundColor: colors.primary }]}>
            <Mic2 size={26} color={colors.onPrimary} />
          </View>
          <View style={styles.startPanelText}>
            <Text style={[styles.startPanelTitle, { color: colors.primary }]}>开始拾言</Text>
            <Text style={[styles.startPanelCaption, { color: colors.text.muted }]}>
              点按进入录音，随时开口
            </Text>
          </View>
          <View style={[styles.startPanelArrow, { backgroundColor: colors.primary }]}>
            <ArrowRight size={20} color={colors.onPrimary} />
          </View>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="选择当前场景"
          onPress={() => setSceneSheetOpen(true)}
          style={({ pressed }) => [
            styles.currentSceneRow,
            {
              backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <View style={styles.currentSceneIcon}>
            <View
              style={[styles.currentSceneIconTint, { backgroundColor: colors.primary }]}
              pointerEvents="none"
            />
            <Layers size={20} color={colors.primary} />
          </View>
          <View style={styles.currentSceneText}>
            <Text style={[styles.currentSceneLabel, { color: colors.text.soft }]}>当前场景</Text>
            <Text style={[styles.currentSceneName, { color: colors.text.ink }]}>
              {selectedScene?.name ?? '请选择场景'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.text.soft} />
        </Pressable>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.text.ink }]}>快捷入口</Text>
          <View style={styles.shortcutGrid}>
            {shortcuts.map((shortcut) => (
              <Pressable
                key={shortcut.key}
                accessibilityRole="button"
                accessibilityLabel={shortcut.title}
                onPress={shortcut.onPress}
                style={({ pressed }) => [
                  styles.shortcutCard,
                  {
                    backgroundColor: pressed ? colors.bg.soft : colors.bg.card,
                    borderColor: colors.border.default,
                  },
                ]}
              >
                <View style={styles.shortcutIcon}>
                  <View
                    style={[styles.shortcutIconTint, { backgroundColor: colors.primary }]}
                    pointerEvents="none"
                  />
                  {shortcut.icon}
                </View>
                <View style={styles.shortcutText}>
                  <Text style={[styles.shortcutTitle, { color: colors.text.ink }]} numberOfLines={1}>
                    {shortcut.title}
                  </Text>
                  <Text style={[styles.shortcutCaption, { color: colors.text.soft }]} numberOfLines={1}>
                    {shortcut.caption}
                  </Text>
                </View>
                <ChevronRight size={16} color={colors.text.soft} />
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.privacyNote}>
          <Lock size={13} color={colors.text.soft} />
          <Text style={[styles.privacyNoteText, { color: colors.text.soft }]}>
            内容仅你可见，安全存储，放心记录
          </Text>
        </View>
      </ScrollView>

      <Modal
        visible={sceneSheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSceneSheetOpen(false)}
      >
        <Pressable
          accessible={false}
          style={[styles.sheetBackdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setSceneSheetOpen(false)}
        >
          <View
            style={[styles.sheetPanel, { backgroundColor: colors.bg.card }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.sheetTitle, { color: colors.text.ink }]}>选择场景</Text>
            <ScrollView style={styles.sheetList} bounces={false}>
              {scenes.map((scene) => {
                const selected = selectedScene?.id === scene.id;
                return (
                  <Pressable
                    key={scene.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSelectedSceneId(scene.id);
                      setSceneSheetOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.sheetRow,
                      { backgroundColor: pressed || selected ? colors.bg.soft : colors.bg.card },
                    ]}
                  >
                    <View style={styles.sceneRowLeading}>
                      <View
                        style={[
                          styles.sceneRadio,
                          { borderColor: selected ? colors.primary : colors.border.default },
                        ]}
                      >
                        {selected ? (
                          <View style={[styles.sceneRadioDot, { backgroundColor: colors.primary }]} />
                        ) : null}
                      </View>
                      <Text style={{ color: colors.text.ink, fontWeight: selected ? '600' : '400' }}>
                        {scene.name}
                      </Text>
                    </View>
                    {selected ? <Check size={18} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setSceneSheetOpen(false);
                navigation.navigate('ShiyanSceneConfig');
              }}
              style={styles.sceneConfigLink}
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>配置自定义场景</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSceneSheetOpen(false)}
              style={[styles.sheetCancelButton, { borderColor: colors.border.default }]}
            >
              <Text style={{ color: colors.text.ink, fontWeight: '600' }}>取消</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </ShiyanScreenShell>
  );
}

const styles = StyleSheet.create({
  homeContent: { padding: spacing.lg, gap: spacing.xl, paddingBottom: 48 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  heroText: { flex: 1, gap: 2 },
  heroTitle: { fontSize: fontSize.titleXl, fontWeight: '700', lineHeight: 38 },
  heroCaption: { fontSize: fontSize.caption, lineHeight: 20, marginTop: spacing.sm },
  heroArtWrap: {
    width: 132,
    height: 132,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroArt: { width: 118, height: 102 },
  startPanel: {
    minHeight: 104,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    overflow: 'hidden',
  },
  startPanelTint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.1 },
  startPanelHalo: {
    position: 'absolute',
    left: -28,
    width: 148,
    height: 148,
    borderRadius: radius.full,
    opacity: 0.08,
  },
  startPanelIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startPanelText: { flex: 1, gap: spacing.xs },
  startPanelTitle: { fontSize: fontSize.titleLg, fontWeight: '700' },
  startPanelCaption: { fontSize: fontSize.caption, lineHeight: 19 },
  startPanelArrow: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentSceneRow: {
    minHeight: 68,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  currentSceneIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  currentSceneIconTint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.1 },
  currentSceneText: { flex: 1, gap: 2 },
  currentSceneLabel: { fontSize: fontSize.xs, lineHeight: 17 },
  currentSceneName: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  section: { gap: spacing.md },
  sectionTitle: { fontSize: fontSize.titleMd, fontWeight: '700' },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  shortcutCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  shortcutIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  shortcutIconTint: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.1 },
  shortcutText: { flex: 1, gap: 2 },
  shortcutTitle: { fontSize: fontSize.button, fontWeight: '600' },
  shortcutCaption: { fontSize: fontSize.xs, lineHeight: 16 },
  privacyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  privacyNoteText: { fontSize: fontSize.xs, lineHeight: 18 },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetPanel: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingBottom: spacing.lg, maxHeight: '70%' },
  sheetTitle: { fontSize: fontSize.bodyMd, fontWeight: '700', textAlign: 'center', paddingVertical: spacing.md },
  sheetList: { paddingHorizontal: spacing.md },
  sheetRow: { minHeight: 50, borderRadius: radius.md, paddingHorizontal: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sceneRowLeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sceneRadio: { width: 18, height: 18, borderRadius: radius.full, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  sceneRadioDot: { width: 9, height: 9, borderRadius: radius.full },
  sceneConfigLink: { minHeight: sizing.touchTarget, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.md, marginTop: spacing.xs },
  sheetCancelButton: { minHeight: 46, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', marginHorizontal: spacing.md, marginTop: spacing.xs },
});
