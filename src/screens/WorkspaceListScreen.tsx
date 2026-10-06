import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft, FolderOpen } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import { workspaceApi, type ChatWorkspace } from '../api/workspaceApi';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import {
  getWorkspaceLoadErrorMessage,
  resolveWorkspaceCollectionState,
} from '../session/workspaceListState';

const formatUpdatedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export function WorkspaceListScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<ChatWorkspace[]>([]);

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setWorkspaces(await workspaceApi.listChatWorkspaces());
    } catch (error) {
      setWorkspaces([]);
      setLoadError(getWorkspaceLoadErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadWorkspaces();
    }, [loadWorkspaces]),
  );

  const collectionState = resolveWorkspaceCollectionState(
    isLoading,
    loadError,
    workspaces.length,
  );

  const data = useMemo(() => workspaces, [workspaces]);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View
        style={[
          styles.header,
          {
            borderBottomColor: colors.border.soft,
            backgroundColor: colors.bg.canvas,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回"
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { backgroundColor: colors.bg.soft },
          ]}
        >
          <ChevronLeft size={24} color={colors.text.ink} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text.ink }]}>项目</Text>
        <View style={styles.headerSpacer} />
      </View>

      {collectionState === 'loading' ? (
        <View
          style={styles.centerState}
          accessibilityRole="progressbar"
          accessibilityLabel="正在加载项目"
        >
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : null}

      {collectionState === 'error' ? (
        <View style={styles.centerState}>
          <Text style={[styles.stateTitle, { color: colors.text.ink }]}>无法加载项目</Text>
          <Text style={[styles.stateBody, { color: colors.text.soft }]}>{loadError}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重试加载项目"
            onPress={() => void loadWorkspaces()}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: pressed ? colors.primaryActive : colors.primary },
            ]}
          >
            <Text style={[styles.retryLabel, { color: colors.onPrimary }]}>重试</Text>
          </Pressable>
        </View>
      ) : null}

      {collectionState === 'empty' ? (
        <View style={styles.centerState}>
          <View
            style={[
              styles.emptyIcon,
              {
                backgroundColor: colors.bg.card,
                borderColor: colors.border.default,
              },
            ]}
          >
            <FolderOpen size={38} strokeWidth={1.5} color={colors.primary} />
          </View>
          <Text style={[styles.stateTitle, { color: colors.text.ink }]}>暂无项目</Text>
          <Text style={[styles.stateBody, { color: colors.text.soft }]}>Desktop 当前没有可显示的工作空间</Text>
        </View>
      ) : null}

      {collectionState === 'data' ? (
        <FlatList
          data={data}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => (
            <View style={[styles.separator, { backgroundColor: colors.border.soft }]} />
          )}
          renderItem={({ item }) => {
            const updatedAt = formatUpdatedAt(item.updatedAt);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${item.name}${item.isDefault ? '，默认项目' : ''}${item.status === 'archived' ? '，已归档' : ''}`}
                onPress={() =>
                  navigation.navigate('WorkspaceDetail', {
                    workspaceId: item.id,
                    workspaceName: item.name,
                  })
                }
                style={({ pressed }) => [
                  styles.workspaceRow,
                  pressed && { backgroundColor: colors.bg.soft },
                ]}
              >
                <View
                  style={[
                    styles.workspaceIcon,
                    {
                      backgroundColor: colors.bg.card,
                      borderColor: colors.border.default,
                    },
                  ]}
                >
                  <FolderOpen size={22} strokeWidth={1.7} color={colors.primary} />
                </View>
                <View style={styles.workspaceText}>
                  <View style={styles.titleRow}>
                    <Text
                      style={[styles.workspaceName, { color: colors.text.ink }]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    {item.isDefault ? (
                      <Text
                        style={[
                          styles.badge,
                          {
                            color: colors.primary,
                            borderColor: colors.border.default,
                            backgroundColor: colors.bg.card,
                          },
                        ]}
                      >
                        默认
                      </Text>
                    ) : null}
                    {item.status === 'archived' ? (
                      <Text
                        style={[
                          styles.badge,
                          {
                            color: colors.text.muted,
                            borderColor: colors.border.default,
                            backgroundColor: colors.bg.card,
                          },
                        ]}
                      >
                        已归档
                      </Text>
                    ) : null}
                  </View>
                  {updatedAt ? (
                    <Text style={[styles.meta, { color: colors.text.soft }]}>更新于 {updatedAt}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
  },
  backButton: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.titleMd,
    fontWeight: '600',
  },
  headerSpacer: { width: sizing.touchTarget },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.section,
    paddingBottom: spacing.section,
  },
  stateTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: '600',
    textAlign: 'center',
  },
  stateBody: {
    marginTop: spacing.md,
    fontSize: fontSize.bodyMd,
    lineHeight: 24,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: sizing.touchTarget,
    minWidth: 96,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  emptyIcon: {
    width: 88,
    height: 88,
    marginBottom: spacing.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  workspaceRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  workspaceIcon: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  workspaceText: { flex: 1, minWidth: 0 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  workspaceName: {
    flexShrink: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: '600',
  },
  badge: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    fontSize: 11,
    fontWeight: '600',
  },
  meta: {
    marginTop: spacing.xs,
    fontSize: fontSize.button,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 56,
  },
});
