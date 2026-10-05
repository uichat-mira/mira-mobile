import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Mic2 } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { useTheme } from '../theme/ThemeContext';
import { radius, spacing } from '../theme/tokens';
import {
  SHIYAN_BUILT_IN_SCENES,
  getCustomSceneDraft,
  type ShiyanSceneDefinition,
} from './scenes';
import { ShiyanScreenShell } from './ShiyanScreenShell';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

export function ShiyanSceneSelectScreen() {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customScene, setCustomScene] = useState<ShiyanSceneDefinition | null>(() => getCustomSceneDraft());

  useFocusEffect(
    useCallback(() => {
      setCustomScene(getCustomSceneDraft());
    }, []),
  );

  const scenes = useMemo(
    () => (customScene ? [...SHIYAN_BUILT_IN_SCENES, customScene] : [...SHIYAN_BUILT_IN_SCENES]),
    [customScene],
  );
  const selected = scenes.find((scene) => scene.id === selectedId) ?? null;

  return (
    <ShiyanScreenShell title="选择场景">
      <ScrollView contentContainerStyle={styles.content}>
        {scenes.map((scene) => {
          const isSelected = selectedId === scene.id;
          return (
            <Pressable
              key={scene.id}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => setSelectedId(scene.id)}
              style={({ pressed }) => [
                styles.sceneCard,
                {
                  backgroundColor: pressed || isSelected ? colors.bg.soft : colors.bg.card,
                  borderColor: isSelected ? colors.primary : colors.border.default,
                },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.text.ink }]}>{scene.name}</Text>
              <Text style={[styles.cardDescription, { color: colors.text.soft }]}>{scene.description}</Text>
              <Text style={[styles.structureText, { color: colors.text.base }]}>{scene.outputStructure.join(' · ')}</Text>
            </Pressable>
          );
        })}

        <Pressable
          accessibilityRole="button"
          disabled={!selected}
          onPress={() => {
            if (!selected) return;
            navigation.navigate('ShiyanRecord', { sceneId: selected.id, sceneName: selected.name });
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            {
              backgroundColor: selected ? (pressed ? colors.primaryActive : colors.primary) : colors.bg.soft,
            },
          ]}
        >
          <Mic2 size={18} color={selected ? colors.onPrimary : colors.text.soft} />
          <Text style={[styles.primaryButtonText, { color: selected ? colors.onPrimary : colors.text.soft }]}>
            {selected ? `使用「${selected.name}」开始录音` : '先选择一个场景'}
          </Text>
        </Pressable>

        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ShiyanSceneConfig')}>
          <Text style={[styles.linkText, { color: colors.primary }]}>配置自定义场景</Text>
        </Pressable>
      </ScrollView>
    </ShiyanScreenShell>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: 48 },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  cardDescription: { fontSize: 14, lineHeight: 20 },
  sceneCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.lg, gap: 7 },
  structureText: { fontSize: 12, lineHeight: 18 },
  primaryButton: { minHeight: 50, borderRadius: radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, marginTop: spacing.sm },
  primaryButtonText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  linkText: { fontSize: 14, fontWeight: '600', textAlign: 'center', paddingVertical: spacing.sm },
});
