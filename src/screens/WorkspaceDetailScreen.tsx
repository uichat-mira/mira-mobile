import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronLeft } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import type { Session } from '../types';
import { workspaceApi } from '../api/workspaceApi';
import { getSessionRoleName } from '../api/roleApi';
import { useRoleNameMap } from '../hooks/useRoleNameMap';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import {
  getSessionVisualKindLabel,
  SessionKindIcon,
} from '../components/SessionKindIcon';
import {
  getSessionLoadErrorMessage,
  resolveSessionCollectionState,
} from '../session/sessionCollection';
import { getWorkspaceDetailContractError } from './workspaceDetailState';

const PAGE_LIMIT = 50;
const twoDigits = (value: number) => String(value).padStart(2, '0');

function formatUpdatedAt(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()} ${twoDigits(date.getHours())}:${twoDigits(
    date.getMinutes(),
  )}`;
}

export function WorkspaceDetailScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'WorkspaceDetail'>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const roleNames = useRoleNameMap();
  const { workspaceId, workspaceName } = route.params;
  const contractError = getWorkspaceDetailContractError(
    workspaceId,
    workspaceName,
  );
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(contractError === null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const loadWorkspaceSessions = useCallback(async () => {
    if (contractError) {
      setSessions([]);
      setTotal(0);
      setNextCursor(null);
      setLoadError(null);
      setLoadMoreError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    setLoadMoreError(null);
    try {
      const page = await workspaceApi.listWorkspaceThreads(workspaceId, {
        status: 'active',
        limit: PAGE_LIMIT,
      });
      setSessions(page.items);
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setSessions([]);
      setTotal(0);
      setNextCursor(null);
      setLoadError(getSessionLoadErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [contractError, workspaceId]);

  const loadMore = useCallback(async () => {
    if (contractError || !nextCursor || isLoading || isLoadingMore) return;

    const cursor = nextCursor;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await workspaceApi.listWorkspaceThreads(workspaceId, {
        status: 'active',
        limit: PAGE_LIMIT,
        cursor,
      });
      setSessions(current => {
        const knownIds = new Set(current.map(item => item.id));
        return [
          ...current,
          ...page.items.filter(item => !knownIds.has(item.id)),
        ];
      });
      setTotal(page.total);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setLoadMoreError(getSessionLoadErrorMessage(error));
    } finally {
      setIsLoadingMore(false);
    }
  }, [contractError, isLoading, isLoadingMore, nextCursor, workspaceId]);

  useFocusEffect(
    useCallback(() => {
      void loadWorkspaceSessions();
    }, [loadWorkspaceSessions]),
  );

  const collectionState = resolveSessionCollectionState(
    isLoading,
    loadError,
    sessions.length,
  );
  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      sessions.length === 0 && { flexGrow: 1 },
      { paddingBottom: insets.bottom + spacing.xl },
    ],
    [insets.bottom, sessions.length],
  );

  const openSession = (session: Session) => {
    navigation.navigate('Chat', {
      sessionId: session.id,
      title: session.title,
    });
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top']}
    >
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.bg.canvas,
            borderBottomColor: colors.border.soft,
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="返回项目列表"
          hitSlop={8}
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { backgroundColor: colors.bg.soft },
          ]}
        >
          <ChevronLeft size={24} color={colors.text.ink} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text
            style={[styles.headerTitle, { color: colors.text.ink }]}
            numberOfLines={1}
          >
            {contractError ? '项目' : workspaceName}
          </Text>
          {!contractError ? (
            <Text style={[styles.headerCaption, { color: colors.text.soft }]}>
              项目会话{!isLoading && !loadError ? ` · ${total}` : ''}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerSpacer} />
      </View>

      {contractError ? (
        <View style={styles.centerState}>
          <Text style={[styles.stateTitle, { color: colors.text.ink }]}>项目数据无效</Text>
          <Text style={[styles.stateBody, { color: colors.text.soft }]}>{contractError}</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={listContentStyle}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.35}
          renderItem={({ item }) => {
            const roleName = getSessionRoleName(item, roleNames);
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${getSessionVisualKindLabel(item)}：${item.title}${roleName ? `，角色${roleName}` : ''}`}
                onPress={() => openSession(item)}
                style={({ pressed }) => [
                  styles.sessionRow,
                  {
                    backgroundColor: colors.bg.canvas,
                    borderColor: colors.border.soft,
                  },
                  pressed && { backgroundColor: colors.bg.soft },
                ]}
              >
                <View
                  style={[
                    styles.sessionIcon,
                    {
                      backgroundColor: colors.bg.card,
                      borderColor: colors.border.default,
                    },
                  ]}
                >
                  <SessionKindIcon
                    session={item}
                    size={21}
                    strokeWidth={1.7}
                    color={colors.primary}
                  />
                </View>
                <View style={styles.sessionContent}>
                  <Text
                    style={[styles.sessionTitle, { color: colors.text.ink }]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  <View style={styles.sessionMetaRow}>
                    {roleName ? (
                      <Text
                        style={[styles.sessionRole, { color: colors.primary }]}
                        numberOfLines={1}
                      >
                        {roleName}
                      </Text>
                    ) : null}
                    <Text style={[styles.sessionTime, { color: colors.text.soft }]}>
                      {formatUpdatedAt(item.updatedAt)}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            collectionState === 'loading' ? (
              <View
                style={styles.centerState}
                accessibilityRole="progressbar"
                accessibilityLabel="正在加载项目会话"
              >
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : collectionState === 'error' ? (
              <View style={styles.centerState}>
                <Text style={[styles.stateTitle, { color: colors.text.ink }]}>加载项目会话失败</Text>
                <Text style={[styles.stateBody, { color: colors.text.soft }]}>{loadError}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重试加载项目会话"
                  onPress={() => void loadWorkspaceSessions()}
                  style={({ pressed }) => [
                    styles.retryButton,
                    {
                      backgroundColor: pressed
                        ? colors.primaryActive
                        : colors.primary,
                    },
                  ]}
                >
                  <Text style={[styles.retryLabel, { color: colors.onPrimary }]}>重试</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.centerState}>
                <Text style={[styles.stateTitle, { color: colors.text.ink }]}>暂无项目会话</Text>
                <Text style={[styles.stateBody, { color: colors.text.soft }]}>这个项目当前没有可读取的活跃会话。</Text>
              </View>
            )
          }
          ListFooterComponent={
            sessions.length === 0 ? null : isLoadingMore ? (
              <View style={styles.footerState} accessibilityLabel="正在加载更多项目会话">
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : loadMoreError ? (
              <View style={styles.footerState}>
                <Text style={[styles.footerError, { color: colors.text.soft }]}>
                  {loadMoreError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重试加载更多项目会话"
                  onPress={() => void loadMore()}
                  style={({ pressed }) => [
                    styles.loadMoreButton,
                    { backgroundColor: pressed ? colors.bg.soft : colors.bg.card },
                  ]}
                >
                  <Text style={[styles.loadMoreLabel, { color: colors.primary }]}>重试加载更多</Text>
                </Pressable>
              </View>
            ) : nextCursor ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="加载更多项目会话"
                onPress={() => void loadMore()}
                style={({ pressed }) => [
                  styles.loadMoreButton,
                  { backgroundColor: pressed ? colors.bg.soft : colors.bg.card },
                ]}
              >
                <Text style={[styles.loadMoreLabel, { color: colors.primary }]}>加载更多</Text>
              </Pressable>
            ) : sessions.length < total ? (
              <Text style={[styles.footerError, { color: colors.text.soft }]}>项目会话尚未完整加载</Text>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    minHeight: 58,
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
  headerCenter: { flex: 1, minWidth: 0, alignItems: 'center' },
  headerTitle: {
    maxWidth: '100%',
    fontSize: fontSize.bodyMd,
    fontWeight: '600',
  },
  headerCaption: { marginTop: 2, fontSize: fontSize.caption },
  headerSpacer: { width: sizing.touchTarget },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.section,
    paddingVertical: spacing.section,
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
  sessionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sessionIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionContent: { flex: 1, minWidth: 0 },
  sessionTitle: { fontSize: fontSize.bodyMd, fontWeight: '500' },
  sessionMetaRow: {
    marginTop: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sessionRole: { flexShrink: 1, fontSize: fontSize.caption, fontWeight: '600' },
  sessionTime: { flexShrink: 0, fontSize: fontSize.caption },
  footerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  footerError: {
    paddingVertical: spacing.md,
    fontSize: fontSize.caption,
    textAlign: 'center',
  },
  loadMoreButton: {
    minHeight: sizing.touchTarget,
    marginVertical: spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  loadMoreLabel: { fontSize: fontSize.button, fontWeight: '600' },
});
