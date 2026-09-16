import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Clock,
  FolderKanban,
  FolderOpen,
  Grid3x3,
  Image as ImageIcon,
  Monitor,
  Search,
  Smartphone,
  SquarePen,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import type { Session } from '../types';
import { useTheme } from '../theme/ThemeContext';
import { miraHostClient } from '../api/miraHostClient';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { getSessionRoleName } from '../api/roleApi';
import { useRoleNameMap } from '../hooks/useRoleNameMap';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { useThreadPinStore } from '../store/threadPinStore';
import { isThreadPinned, splitSessionsByLocalPin } from '../store/threadPinning';
import {
  selectThreadUnread,
  useThreadReadStore,
} from '../store/threadReadStore';
import {
  getSessionVisualKindLabel,
  SessionKindIcon,
} from './SessionKindIcon';
import { RemoteDiagnosticNotice } from './RemoteDiagnosticNotice';
import {
  classifySessionLoadFailure,
  type RemoteConnectionDiagnostic,
  type RemoteConnectionDiagnosticAction,
} from '../connectivity/remoteConnectionDiagnostics';
import { resolveSessionCollectionState } from '../screens/sessionCollectionState';
import { resolveSessionOpenTarget } from '../screens/sessionNavigation';

type NavProp = NativeStackNavigationProp<RootStackParamList>;
const miraLogo = require('../../assets/branding/mira-logo-square.png');

interface CategoryItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
}

const categories: CategoryItem[] = [
  { id: 'images', label: '图片', icon: ImageIcon },
  { id: 'files', label: '文件库', icon: FolderKanban },
  // Product term “项目” maps to the Desktop Host Chat Workspace domain.
  { id: 'workspaces', label: '项目', icon: FolderOpen },
  { id: 'remote', label: '远程连接', icon: Monitor },
  { id: 'local-provider', label: '本地连接', icon: Smartphone },
  { id: 'planned', label: '已计划', icon: Clock },
  { id: 'plugins', label: '插件', icon: Grid3x3 },
];

const RECENT_THREAD_LIMIT = 20;

interface CustomDrawerProps {
  onClose: () => void;
}

export function CustomDrawer({ onClose }: CustomDrawerProps) {
  const navigation = useNavigation<NavProp>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const roleNames = useRoleNameMap();
  const pinnedAtByThreadId = useThreadPinStore((state) => state.pinnedAtByThreadId);
  const hydratePins = useThreadPinStore((state) => state.hydrate);
  const progressByThreadId = useThreadReadStore((state) => state.progressByThreadId);
  const hydrateReads = useThreadReadStore((state) => state.hydrate);
  const syncUnreadSessions = useThreadReadStore((state) => state.syncSessions);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadDiagnostic, setLoadDiagnostic] =
    useState<RemoteConnectionDiagnostic | null>(null);
  const [creatingChat, setCreatingChat] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setLoadDiagnostic(null);
    try {
      const list = await runtimeRegistry.listSessions('all');
      setSessions(list);
      void syncUnreadSessions(
        list.filter((session) => session.source !== 'local-provider').slice(0, 20),
      ).catch(() => undefined);
    } catch (error) {
      setLoadDiagnostic(await classifySessionLoadFailure(error));
    } finally {
      setLoading(false);
    }
  }, [syncUnreadSessions]);

  React.useEffect(() => {
    void hydratePins().catch(() => undefined);
    void hydrateReads().catch(() => undefined);
    void loadSessions();
  }, [hydratePins, hydrateReads, loadSessions]);

  // Group by device-local pin state first, then apply the Recent display cap.
  // A pinned thread that falls outside the Recent cap must stay visible in the
  // pinned group instead of disappearing from the drawer.
  const { pinned: pinnedSessions, recent: recentSessions } = React.useMemo(
    () => splitSessionsByLocalPin(sessions, pinnedAtByThreadId, RECENT_THREAD_LIMIT),
    [pinnedAtByThreadId, sessions],
  );

  // Pinned threads beyond the Recent cap still need unread observation.
  React.useEffect(() => {
    if (pinnedSessions.length === 0) return;
    void syncUnreadSessions(
      pinnedSessions.filter((session) => session.source !== 'local-provider'),
    ).catch(() => undefined);
  }, [pinnedSessions, syncUnreadSessions]);

  const collectionState = resolveSessionCollectionState(
    loading,
    loadDiagnostic?.title ?? null,
    sessions.length,
  );

  const handleOpenSession = useCallback((session: Session) => {
    const target = resolveSessionOpenTarget(session);
    onClose();

    if (target.kind === 'workspace-list') {
      navigation.navigate('WorkspaceList');
      return;
    }
    if (target.kind === 'contract-error') {
      Alert.alert('无法打开会话', target.message);
      return;
    }
    navigation.navigate('Chat', {
      sessionId: session.id,
      title: session.title,
      source: session.source,
      providerName: session.providerName,
      providerModel: session.providerModel,
    });
  }, [navigation, onClose]);

  const handleOpenWorkspaces = () => {
    onClose();
    navigation.navigate('WorkspaceList');
  };

  const handleOpenRemoteConnection = useCallback(() => {
    onClose();
    navigation.navigate('HostConfig');
  }, [navigation, onClose]);

  const handleOpenLocalProvider = useCallback(() => {
    onClose();
    navigation.navigate('LocalProviderConfig');
  }, [navigation, onClose]);

  const handleOpenPlugins = () => {
    onClose();
    navigation.navigate('Plugins');
  };

  const handleDiagnosticAction = useCallback(
    (action: RemoteConnectionDiagnosticAction) => {
      if (action === 'retry') {
        void loadSessions();
        return;
      }
      handleOpenRemoteConnection();
    },
    [handleOpenRemoteConnection, loadSessions],
  );

  const createRemoteChat = useCallback(async () => {
    setCreatingChat(true);
    try {
      const session = await miraHostClient.createSession();
      onClose();
      navigation.navigate('Chat', {
        sessionId: session.id,
        title: session.title,
        source: session.source,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : '无法新建远程会话，请稍后重试。';
      Alert.alert('无法新建远程会话', message);
    } finally {
      setCreatingChat(false);
    }
  }, [navigation, onClose]);

  const handleCreateChat = useCallback(() => {
    if (creatingChat) return;
    Alert.alert('新建会话', '选择会话来源', [
      {
        text: '远程连接',
        onPress: () => void createRemoteChat(),
      },
      {
        text: '本地连接',
        onPress: handleOpenLocalProvider,
      },
      { text: '取消', style: 'cancel' },
    ]);
  }, [creatingChat, createRemoteChat, handleOpenLocalProvider]);

  const renderDrawerSession = useCallback(
    ({ item }: { item: Session }) => {
      const belongsToWorkspace =
        typeof item.workspaceId === 'string' &&
        item.workspaceId.trim().length > 0;
      const pinned = isThreadPinned(pinnedAtByThreadId, item.id);
      const unread = selectThreadUnread(progressByThreadId, item.id);
      const roleName = getSessionRoleName(item, roleNames);
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${getSessionVisualKindLabel(item)}：${item.title}${roleName ? `，角色${roleName}` : ''}${belongsToWorkspace ? '，项目会话' : ''}${pinned ? '，已在本机置顶' : ''}${unread ? '，未读' : ''}`}
          style={({ pressed }) => [
            styles.recentItem,
            pressed && { backgroundColor: colors.bg.soft },
          ]}
          onPress={() => handleOpenSession(item)}
        >
          <SessionKindIcon
            session={item}
            size={18}
            strokeWidth={1.8}
            color={colors.text.muted}
          />
          <View style={styles.recentText}>
            <Text
              style={[styles.recentLabel, { color: colors.text.base }]}
              numberOfLines={1}
            >
              {item.title}
            </Text>
            {roleName ? (
              <Text
                style={[styles.recentRole, { color: colors.text.soft }]}
                numberOfLines={1}
              >
                {roleName}
              </Text>
            ) : null}
          </View>
          {unread ? (
            <View
              accessibilityElementsHidden
              style={[styles.unreadDot, { backgroundColor: colors.primary }]}
            />
          ) : null}
          {belongsToWorkspace ? (
            <FolderOpen size={16} color={colors.text.soft} strokeWidth={1.7} />
          ) : null}
        </Pressable>
      );
    },
    [colors, handleOpenSession, pinnedAtByThreadId, progressByThreadId, roleNames],
  );

  const listSeparator = useCallback(
    () => (
      <View
        style={[
          styles.separator,
          { backgroundColor: colors.border.soft },
        ]}
      />
    ),
    [colors],
  );

  return (
    <View
      style={[
        styles.drawer,
        {
          backgroundColor: colors.bg.canvas,
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.brandMark}>
          <Image source={miraLogo} style={styles.brandLogo} />
          <Text
            style={[styles.brandTitle, { color: colors.text.ink }]}
            numberOfLines={1}
          >
            UIChat Mira
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.headerBtn}
            onPress={() => navigation.navigate('Search')}
            accessibilityRole="button"
            accessibilityLabel="搜索会话"
          >
            <Search size={22} color={colors.text.muted} />
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.categories}>
          {categories.map((cat) => {
            const interactive =
              cat.id === 'remote' || cat.id === 'local-provider' || cat.id === 'workspaces' || cat.id === 'plugins';
            const onPress =
              cat.id === 'remote'
                ? handleOpenRemoteConnection
                : cat.id === 'local-provider'
                  ? handleOpenLocalProvider
                : cat.id === 'workspaces'
                  ? handleOpenWorkspaces
                  : cat.id === 'plugins'
                    ? handleOpenPlugins
                    : undefined;
            const accessibilityLabel =
                cat.id === 'remote'
                    ? '远程连接'
                    : cat.id === 'local-provider'
                      ? '本地连接'
                : cat.id === 'workspaces'
                  ? '项目'
                  : cat.id === 'plugins'
                    ? '插件'
                    : undefined;

            return (
              <Pressable
                key={cat.id}
                style={({ pressed }) => [
                  styles.categoryItem,
                  pressed && interactive && { backgroundColor: colors.bg.soft },
                ]}
                onPress={onPress}
                accessibilityRole={interactive ? 'button' : undefined}
                accessibilityLabel={accessibilityLabel}
              >
                <cat.icon size={22} color={colors.text.muted} />
                <Text style={[styles.categoryLabel, { color: colors.text.base }]}>
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {collectionState === 'data' && loadDiagnostic ? (
          <View style={styles.diagnosticWrap}>
            <RemoteDiagnosticNotice
              diagnostic={loadDiagnostic}
              compact
              onAction={handleDiagnosticAction}
            />
          </View>
        ) : null}

        {collectionState === 'data' ? (
          <>
            {pinnedSessions.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>置顶</Text>
                <FlatList
                  data={pinnedSessions}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  renderItem={renderDrawerSession}
                  ItemSeparatorComponent={listSeparator}
                />
              </>
            ) : null}
            {recentSessions.length > 0 ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>最近</Text>
                <FlatList
                  data={recentSessions}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  renderItem={renderDrawerSession}
                  ItemSeparatorComponent={listSeparator}
                />
              </>
            ) : null}
          </>
        ) : null}

        {collectionState === 'loading' ? (
          <Text style={[styles.emptyHint, { color: colors.text.soft }]}>加载中...</Text>
        ) : null}

        {collectionState === 'empty' ? (
          <Text style={[styles.emptyHint, { color: colors.text.soft }]}>暂无会话</Text>
        ) : null}

        {collectionState === 'error' && loadDiagnostic ? (
          <View style={styles.errorState}>
            <RemoteDiagnosticNotice
              diagnostic={loadDiagnostic}
              onAction={handleDiagnosticAction}
            />
          </View>
        ) : null}
      </ScrollView>

      <View
        style={[styles.bottomBar, { borderTopColor: colors.border.soft }]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={creatingChat ? '正在新建聊天' : '聊天'}
          accessibilityState={{ disabled: creatingChat }}
          disabled={creatingChat}
          onPress={() => void handleCreateChat()}
          style={({ pressed }) => [
            styles.chatButton,
            {
              backgroundColor: pressed ? colors.primaryActive : colors.primary,
            },
            creatingChat && { opacity: 0.7 },
          ]}
        >
          <SquarePen size={20} color={colors.onPrimary} strokeWidth={2.2} />
          <Text
            style={[styles.chatButtonLabel, { color: colors.onPrimary }]}
          >
            {creatingChat ? '新建中…' : '聊天'}
          </Text>
        </Pressable>
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <Text style={[styles.avatarLabel, { color: colors.primary }]}>M</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  drawer: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
  },
  brandMark: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  brandLogo: { width: 28, height: 28, borderRadius: 14 },
  brandTitle: {
    flexShrink: 1,
    fontFamily: Platform.select({
      ios: 'Georgia',
      android: 'serif',
      default: 'serif',
    }),
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: 0,
  },
  headerActions: { flexDirection: 'row', flexShrink: 0, gap: 4 },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { flex: 1 },
  categories: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 4,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 14,
    borderRadius: 10,
  },
  categoryLabel: { fontSize: 16, fontWeight: '500' },
  diagnosticWrap: { paddingHorizontal: spacing.lg },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 6,
  },
  recentItem: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  recentText: { flex: 1, minWidth: 0 },
  recentLabel: { fontSize: 15 },
  recentRole: { marginTop: 2, fontSize: fontSize.xs },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 46 },
  emptyHint: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  errorState: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.section,
  },
  bottomBar: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  chatButton: {
    minWidth: 136,
    height: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    gap: spacing.sm,
  },
  chatButtonLabel: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  avatar: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLabel: { fontSize: fontSize.button, fontWeight: '700' },
});
