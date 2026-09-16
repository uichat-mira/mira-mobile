import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { FolderOpen, Pin, Search, X } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import type { Session } from '../types';
import { miraHostClient } from '../api/miraHostClient';
import { getSessionRoleName } from '../api/roleApi';
import { useRoleNameMap } from '../hooks/useRoleNameMap';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { useThreadPinStore } from '../store/threadPinStore';
import { isThreadPinned } from '../store/threadPinning';
import {
  selectThreadUnread,
  useThreadReadStore,
} from '../store/threadReadStore';
import {
  getSessionVisualKindLabel,
  SessionKindIcon,
} from '../components/SessionKindIcon';
import { RemoteDiagnosticNotice } from '../components/RemoteDiagnosticNotice';
import {
  classifySessionLoadFailure,
  type RemoteConnectionDiagnostic,
  type RemoteConnectionDiagnosticAction,
} from '../connectivity/remoteConnectionDiagnostics';
import { resolveSessionCollectionState } from './sessionCollectionState';
import { resolveSessionOpenTarget } from './sessionNavigation';
import {
  GlobalSearchController,
  SEARCH_DEBOUNCE_MS,
  type GlobalSearchState,
} from '../search/globalSearch';

const tabs = [
  { id: 'all', label: '全部', implemented: true },
  { id: 'conversations', label: '对话', implemented: true },
  { id: 'images', label: '图片', implemented: false },
  { id: 'documents', label: '文档', implemented: false },
  // Product term “项目” maps to the Desktop Host Chat Workspace domain.
  { id: 'workspaces', label: '项目', implemented: false },
] as const;
type SearchTab = (typeof tabs)[number]['id'];

export function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const roleNames = useRoleNameMap();
  const pinnedAtByThreadId = useThreadPinStore((state) => state.pinnedAtByThreadId);
  const hydratePins = useThreadPinStore((state) => state.hydrate);
  const progressByThreadId = useThreadReadStore((state) => state.progressByThreadId);
  const hydrateReads = useThreadReadStore((state) => state.hydrate);
  const syncUnreadSessions = useThreadReadStore((state) => state.syncSessions);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadDiagnostic, setLoadDiagnostic] =
    useState<RemoteConnectionDiagnostic | null>(null);
  const [searchDiagnostic, setSearchDiagnostic] =
    useState<RemoteConnectionDiagnostic | null>(null);
  const [searchState, setSearchState] = useState<GlobalSearchState>({
    status: 'idle',
    query: '',
    threadMatches: [],
    messageMatches: [],
  });
  const searchControllerRef = useRef<GlobalSearchController | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setLoadDiagnostic(null);
    try {
      const list = await miraHostClient.listSessions();
      setSessions(list);
      void syncUnreadSessions(list).catch(() => undefined);
    } catch (error) {
      setLoadDiagnostic(await classifySessionLoadFailure(error));
    } finally {
      setLoading(false);
    }
  }, [syncUnreadSessions]);

  useEffect(() => {
    void hydratePins().catch(() => undefined);
    void hydrateReads().catch(() => undefined);
    void loadSessions();
  }, [hydratePins, hydrateReads, loadSessions]);

  useEffect(() => {
    const controller = new GlobalSearchController({
      listSessions: () => miraHostClient.listSessions(),
      getMessages: (sessionId) => miraHostClient.getMessages(sessionId),
      onStateChange: setSearchState,
    });
    searchControllerRef.current = controller;
    return () => {
      searchControllerRef.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    if (searchState.status !== 'failed' || searchState.error === undefined) {
      return;
    }
    let active = true;
    void classifySessionLoadFailure(searchState.error).then((diagnostic) => {
      if (active) setSearchDiagnostic(diagnostic);
    });
    return () => {
      active = false;
    };
  }, [searchState.error, searchState.query, searchState.status]);

  useEffect(() => {
    const controller = searchControllerRef.current;
    if (!controller) return;
    setSearchDiagnostic(null);
    if (!query.trim()) {
      controller.search('');
      return;
    }
    const timer = setTimeout(() => controller.search(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const threadResults = hasQuery ? searchState.threadMatches : sessions;
  const messageResults = hasQuery ? searchState.messageMatches : [];

  const openSession = (session: Session) => {
    const target = resolveSessionOpenTarget(session);
    if (target.kind === 'contract-error') {
      Alert.alert('无法打开会话', target.message);
      return;
    }
    navigation.navigate('Chat', { sessionId: session.id, title: session.title });
  };

  const isImplementedTab = activeTab === 'all' || activeTab === 'conversations';
  const collectionState = resolveSessionCollectionState(
    loading,
    loadDiagnostic?.title ?? null,
    sessions.length,
  );

  const handleCollectionDiagnosticAction = useCallback(
    (action: RemoteConnectionDiagnosticAction) => {
      if (action === 'retry') {
        void loadSessions();
        return;
      }
      navigation.navigate('HostConfig');
    },
    [loadSessions, navigation],
  );

  const handleSearchDiagnosticAction = useCallback(
    (action: RemoteConnectionDiagnosticAction) => {
      if (action === 'retry') {
        setSearchDiagnostic(null);
        searchControllerRef.current?.search(query);
        return;
      }
      navigation.navigate('HostConfig');
    },
    [navigation, query],
  );

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.bg.canvas }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.tabs, { borderBottomColor: colors.border.soft }]}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            style={[
              styles.tab,
              activeTab === tab.id && { backgroundColor: colors.bg.soft },
              !tab.implemented && styles.placeholderTab,
            ]}
            onPress={tab.implemented ? () => setActiveTab(tab.id) : undefined}
            accessibilityRole="tab"
            accessibilityState={{
              selected: activeTab === tab.id,
              disabled: !tab.implemented,
            }}
          >
            <Text
              style={[
                styles.tabLabel,
                {
                  color:
                    activeTab === tab.id ? colors.text.ink : colors.text.muted,
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.results}
        keyboardShouldPersistTaps="handled"
      >
        {!hasQuery && collectionState === 'data' && loadDiagnostic ? (
          <RemoteDiagnosticNotice
            diagnostic={loadDiagnostic}
            compact
            onAction={handleCollectionDiagnosticAction}
          />
        ) : null}

        {!isImplementedTab ? (
          <Text style={[styles.placeholderText, { color: colors.text.soft }]}>该类型搜索即将支持</Text>
        ) : collectionState === 'loading' && !hasQuery ? (
          <View
            style={styles.centerState}
            accessibilityLabel="正在加载会话"
            accessibilityRole="progressbar"
          >
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : collectionState === 'error' && !hasQuery && loadDiagnostic ? (
          <View style={styles.centerState}>
            <RemoteDiagnosticNotice
              diagnostic={loadDiagnostic}
              onAction={handleCollectionDiagnosticAction}
            />
          </View>
        ) : hasQuery && searchState.status === 'failed' ? (
          <View style={styles.centerState}>
            {searchDiagnostic ? (
              <RemoteDiagnosticNotice
                diagnostic={searchDiagnostic}
                onAction={handleSearchDiagnosticAction}
              />
            ) : (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
          </View>
        ) : hasQuery && searchState.status === 'searching' ? (
          <View
            style={styles.centerState}
            accessibilityLabel="正在搜索"
            accessibilityRole="progressbar"
          >
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : threadResults.length > 0 || messageResults.length > 0 ? (
          <>
            {threadResults.length > 0 && hasQuery ? (
              <Text style={[styles.resultSectionLabel, { color: colors.text.soft }]}>对话</Text>
            ) : null}
            {threadResults.map((session) => {
            const belongsToWorkspace =
              typeof session.workspaceId === 'string' &&
              session.workspaceId.trim().length > 0;
            const pinned = isThreadPinned(pinnedAtByThreadId, session.id);
            const unread = selectThreadUnread(progressByThreadId, session.id);
            const roleName = getSessionRoleName(session, roleNames);
            return (
              <Pressable
                key={session.id}
                accessibilityRole="button"
                accessibilityLabel={`${getSessionVisualKindLabel(session)}：${session.title}${roleName ? `，角色${roleName}` : ''}${belongsToWorkspace ? '，项目会话' : ''}${pinned ? '，已在本机置顶' : ''}${unread ? '，未读' : ''}`}
                style={styles.result}
                onPress={() => openSession(session)}
              >
                <View style={[styles.resultIcon, { backgroundColor: colors.bg.soft }]}>
                  <SessionKindIcon
                    session={session}
                    size={20}
                    strokeWidth={1.8}
                    color={colors.primary}
                  />
                </View>
                <View style={[styles.resultLine, { backgroundColor: colors.bg.soft }]}>
                  <View style={styles.resultTitleRow}>
                    <Text
                      style={[styles.resultTitle, { color: colors.text.ink }]}
                      numberOfLines={1}
                    >
                      {session.title}
                    </Text>
                    {unread ? (
                      <View
                        accessibilityElementsHidden
                        style={[styles.unreadDot, { backgroundColor: colors.primary }]}
                      />
                    ) : null}
                    {pinned ? (
                      <Pin size={14} color={colors.primary} strokeWidth={2} />
                    ) : null}
                  </View>
                  {roleName || belongsToWorkspace || pinned ? (
                    <View style={styles.projectHint}>
                      {roleName ? (
                        <Text style={[styles.projectHintText, { color: colors.text.soft }]}>角色 · {roleName}</Text>
                      ) : null}
                      {belongsToWorkspace ? (
                        <>
                          <FolderOpen size={13} color={colors.text.soft} strokeWidth={1.7} />
                          <Text style={[styles.projectHintText, { color: colors.text.soft }]}>项目会话</Text>
                        </>
                      ) : null}
                      {pinned ? (
                        <Text style={[styles.projectHintText, { color: colors.text.soft }]}>本机置顶</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
            {messageResults.length > 0 ? (
              <Text style={[styles.resultSectionLabel, { color: colors.text.soft }]}>消息</Text>
            ) : null}
            {messageResults.map((match) => (
              <Pressable
                key={`${match.session.id}:${match.message.id}`}
                accessibilityRole="button"
                accessibilityLabel={`消息命中：${match.session.title}，${match.message.role === 'user' ? '你' : 'Mira'}的消息`}
                style={styles.result}
                onPress={() => openSession(match.session)}
              >
                <View style={[styles.resultIcon, { backgroundColor: colors.bg.soft }]}>
                  <SessionKindIcon
                    session={match.session}
                    size={20}
                    strokeWidth={1.8}
                    color={colors.primary}
                  />
                </View>
                <View style={[styles.resultLine, { backgroundColor: colors.bg.soft }]}>
                  <View style={styles.resultTitleRow}>
                    <Text
                      style={[styles.resultTitle, { color: colors.text.ink }]}
                      numberOfLines={1}
                    >
                      {match.session.title}
                    </Text>
                    <Text style={[styles.messageRole, { color: colors.text.soft }]}>
                      {match.message.role === 'user' ? '你' : 'Mira'}
                    </Text>
                  </View>
                  <Text
                    style={[styles.messageSnippet, { color: colors.text.muted }]}
                    numberOfLines={2}
                  >
                    {match.snippet}
                  </Text>
                </View>
              </Pressable>
            ))}
            {searchState.status === 'degraded' ? (
              <Text style={[styles.degradedHint, { color: colors.text.soft }]}>部分会话未能完成搜索，结果可能不完整。</Text>
            ) : null}
          </>
        ) : hasQuery && searchState.status === 'degraded' ? (
          <View style={styles.centerState}>
            <Text style={[styles.stateTitle, { color: colors.text.ink }]}>搜索未能完成</Text>
            <Text style={[styles.stateText, { color: colors.text.soft }]}>部分会话消息暂时无法读取，无法确认是否存在匹配。</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="重试搜索"
              onPress={() => searchControllerRef.current?.search(query)}
              style={({ pressed }) => [
                styles.retryButton,
                { backgroundColor: pressed ? colors.primaryActive : colors.primary },
              ]}
            >
              <Text style={[styles.retryLabel, { color: colors.onPrimary }]}>重试</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.centerState}>
            <Text style={[styles.stateTitle, { color: colors.text.ink }]}>
              {collectionState === 'empty'
                ? '暂无会话'
                : `没有找到“${query.trim()}”`}
            </Text>
            <Text style={[styles.stateText, { color: colors.text.soft }]}> 
              {collectionState === 'empty'
                ? 'Remote Host V1 当前只搜索桌面端已有会话'
                : '换个关键词再试试'}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.composer, { backgroundColor: colors.bg.canvas }]}>
        <View style={[styles.inputWrap, { backgroundColor: colors.bg.soft }]}>
          <Search size={24} color={colors.text.muted} />
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            placeholder="搜索"
            placeholderTextColor={colors.text.placeholder}
            style={[styles.input, { color: colors.text.ink }]}
            accessibilityLabel="搜索"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} accessibilityLabel="清除搜索">
              <X size={20} color={colors.text.muted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.dismiss, { backgroundColor: colors.bg.soft }]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="关闭搜索"
        >
          <X size={30} color={colors.text.ink} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tabs: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  tab: {
    minHeight: sizing.buttonHeight,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.full,
  },
  placeholderTab: { opacity: 0.55 },
  tabLabel: { fontSize: fontSize.bodyMd },
  results: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: sizing.buttonHeight + spacing.xl,
    gap: spacing.md,
  },
  result: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  resultIcon: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultLine: {
    minHeight: sizing.buttonHeight,
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  resultTitleRow: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  resultTitle: { flex: 1, fontSize: fontSize.bodyMd },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  projectHint: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  projectHintText: { fontSize: fontSize.xs },
  resultSectionLabel: {
    fontSize: fontSize.captionUppercase,
    fontWeight: '600',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  messageRole: { fontSize: fontSize.xs, flexShrink: 0 },
  messageSnippet: {
    marginTop: 2,
    fontSize: fontSize.button,
  },
  degradedHint: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xs,
    fontSize: fontSize.button,
    textAlign: 'center',
  },
  placeholderText: {
    textAlign: 'center',
    marginTop: spacing.xl,
    fontSize: fontSize.bodyMd,
  },
  centerState: {
    flex: 1,
    minHeight: 260,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  stateTitle: { fontSize: fontSize.bodyMd, fontWeight: '600', textAlign: 'center' },
  stateText: {
    marginTop: spacing.sm,
    fontSize: fontSize.button,
    textAlign: 'center',
  },
  retryButton: {
    minHeight: sizing.touchTarget,
    minWidth: 88,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  retryLabel: { fontSize: fontSize.button, fontWeight: '600' },
  composer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputWrap: {
    minHeight: sizing.buttonHeight,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    minHeight: sizing.buttonHeight,
    paddingVertical: 0,
    fontSize: fontSize.titleMd,
  },
  dismiss: {
    width: sizing.iconButton,
    height: sizing.iconButton,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
