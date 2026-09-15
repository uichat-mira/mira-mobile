import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Menu, Settings as SettingsIcon } from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import type { Session } from '../types';
import { useHostStore } from '../store/hostStore';
import { useThreadPinStore } from '../store/threadPinStore';
import { isThreadPinned, sortSessionsByLocalPin } from '../store/threadPinning';
import { selectThreadUnread, useThreadReadStore } from '../store/threadReadStore';
import { miraHostClient } from '../api/miraHostClient';
import { runtimeRegistry, type SessionSourceFilter } from '../runtime/runtimeRegistry';
import { getSessionRoleName } from '../api/roleApi';
import { useRoleNameMap } from '../hooks/useRoleNameMap';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { ConnectionSourceDropdown, type ConnectionSourceOption } from '../components/ConnectionSourceDropdown';
import { type ConnectionVisualStatus } from '../components/ConnectionStatusDot';
import { ProviderConfigStore } from '../provider/providerConfigStore';
import { CustomDrawer } from '../components/CustomDrawer';
import { EmptyStateIllustration } from '../components/EmptyStateIllustration';
import {
  classifySessionLoadFailure,
  type RemoteConnectionDiagnostic,
} from '../connectivity/remoteConnectionDiagnostics';
import { resolveSessionCollectionState } from './sessionCollectionState';
import { resolveSessionOpenTarget } from './sessionNavigation';
import { SessionSwipeRow } from './SessionSwipeRow';

const DRAWER_WIDTH = Math.floor(Dimensions.get('window').width * 0.82);

const getEmptyDescription = (source: SessionSourceFilter): string => {
  if (source === 'local-provider') return '尚未创建本地连接会话';
  if (source === 'remote-host') return '远程连接当前没有可用会话';
  return '远程连接与本地连接当前都没有会话';
};

export function SessionListScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const { connectionStatus, config } = useHostStore();
  const roleNames = useRoleNameMap();
  const pinnedAtByThreadId = useThreadPinStore((state) => state.pinnedAtByThreadId);
  const hydratePins = useThreadPinStore((state) => state.hydrate);
  const pinThread = useThreadPinStore((state) => state.pinThread);
  const unpinThread = useThreadPinStore((state) => state.unpinThread);
  const progressByThreadId = useThreadReadStore((state) => state.progressByThreadId);
  const hydrateReads = useThreadReadStore((state) => state.hydrate);
  const syncUnreadSessions = useThreadReadStore((state) => state.syncSessions);
  const clearThreadRead = useThreadReadStore((state) => state.clearThread);
  const insets = useSafeAreaInsets();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sourceFilter, setSourceFilter] = useState<SessionSourceFilter>('all');
  const [localConfigured, setLocalConfigured] = useState(false);
  const [canDeleteSessions, setCanDeleteSessions] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadDiagnostic, setLoadDiagnostic] =
    useState<RemoteConnectionDiagnostic | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openSwipeRowId, setOpenSwipeRowId] = useState<string | null>(null);
  const drawerAnim = useState(new Animated.Value(-DRAWER_WIDTH))[0];
  const backdropAnim = useState(new Animated.Value(0))[0];

  React.useEffect(() => {
    let cancelled = false;
    void new ProviderConfigStore().load().then((configs) => {
      if (!cancelled) setLocalConfigured(configs.length > 0);
    }).catch(() => {
      if (!cancelled) setLocalConfigured(false);
    });
    return () => { cancelled = true; };
  }, []);

  const remoteStatus: ConnectionVisualStatus = loadDiagnostic
    ? 'error'
    : connectionStatus === 'connected'
      ? 'connected'
      : connectionStatus === 'connecting' || connectionStatus === 'reconnecting'
        ? 'connecting'
        : config
          ? 'disconnected'
          : 'not-configured';
  const sourceOptions: ConnectionSourceOption<SessionSourceFilter>[] = [
    { value: 'all', label: '全部任务', description: '同时显示远程和本地会话', status: localConfigured || !!config ? 'connected' : 'not-configured' },
    { value: 'remote-host', label: '远程连接', description: '来自已配对 Mira Host 的会话', status: remoteStatus, disabled: remoteStatus !== 'connected' && remoteStatus !== 'connecting' },
    { value: 'local-provider', label: '本地连接', description: '保存在当前设备的直连会话', status: localConfigured ? 'connected' : 'not-configured' },
  ];

  React.useEffect(() => {
    const remoteUnavailable = remoteStatus !== 'connected' && remoteStatus !== 'connecting';
    if (sourceFilter === 'remote-host' && remoteUnavailable) {
      setSourceFilter('all');
    }
  }, [remoteStatus, sourceFilter]);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    Animated.parallel([
      Animated.timing(drawerAnim, {
        toValue: 0,
        useNativeDriver: true,
        duration: 250,
      }),
      Animated.timing(backdropAnim, {
        toValue: 1,
        useNativeDriver: true,
        duration: 250,
      }),
    ]).start();
  }, [drawerAnim, backdropAnim]);

  const closeDrawer = useCallback(() => {
    Animated.parallel([
      Animated.timing(drawerAnim, {
        toValue: -DRAWER_WIDTH,
        useNativeDriver: true,
        duration: 220,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        useNativeDriver: true,
        duration: 220,
      }),
    ]).start(() => setDrawerOpen(false));
  }, [drawerAnim, backdropAnim]);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    setLoadDiagnostic(null);
    try {
      const [list, canDelete] = await Promise.all([
        runtimeRegistry.listSessions(sourceFilter),
        sourceFilter === 'local-provider' ? Promise.resolve(false) : miraHostClient.canDeleteSession().catch(() => false),
      ]);
      setSessions(list);
      setCanDeleteSessions(canDelete);
      void syncUnreadSessions(
        list.filter((session) => session.source !== 'local-provider'),
      ).catch(() => undefined);
    } catch (error) {
      setCanDeleteSessions(false);
      setLoadDiagnostic(await classifySessionLoadFailure(error));
    } finally {
      setIsLoading(false);
    }
  }, [sourceFilter, syncUnreadSessions]);

  useFocusEffect(
    useCallback(() => {
      void Promise.allSettled([
        Promise.resolve().then(hydratePins),
        Promise.resolve().then(hydrateReads),
      ]).then(() => loadSessions());
    }, [hydratePins, hydrateReads, loadSessions]),
  );

  const orderedSessions = useMemo(
    () => sortSessionsByLocalPin(sessions, pinnedAtByThreadId),
    [pinnedAtByThreadId, sessions],
  );
  const pinnedCount = useMemo(
    () =>
      orderedSessions.filter((session) =>
        isThreadPinned(pinnedAtByThreadId, session.id),
      ).length,
    [orderedSessions, pinnedAtByThreadId],
  );

  const collectionState = resolveSessionCollectionState(
    isLoading,
    loadDiagnostic?.title ?? null,
    sessions.length,
  );

  const listContentStyle = useMemo(
    () => [
      styles.listContent,
      sessions.length === 0 && { flexGrow: 1 },
      { paddingBottom: insets.bottom + 24 },
    ],
    [insets.bottom, sessions.length],
  );

  const openSession = (session: Session) => {
    const target = resolveSessionOpenTarget(session);
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
  };

  const togglePin = async (session: Session) => {
    try {
      if (isThreadPinned(pinnedAtByThreadId, session.id)) {
        await unpinThread(session.id);
      } else {
        await pinThread(session.id);
      }
    } catch {
      Alert.alert('置顶操作失败', '无法保存本机置顶状态，请重试。');
    }
  };

  const deleteSession = async (session: Session) => {
    try {
      await runtimeRegistry.deleteSession(session.id, session.source);
      setSessions((current) => current.filter((item) => item.id !== session.id));
      const cleanupResults = await Promise.allSettled([
        unpinThread(session.id),
        clearThreadRead(session.id),
      ]);
      if (cleanupResults.some((result) => result.status === 'rejected')) {
        Alert.alert(
          '会话已删除',
          '会话已删除，但本机置顶或未读状态清理未完成，请重新打开应用后检查。',
        );
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : '无法删除该会话，请重试。';
      Alert.alert('删除失败', message);
    }
  };

  const confirmDelete = (session: Session) => {
    const message = session.source === 'local-provider'
      ? `确定删除“${session.title}”吗？仅删除当前设备上的本地对话，不影响 Mira Host。`
      : `确定删除“${session.title}”吗？此操作会同步删除桌面端线程。`;
    Alert.alert('删除会话', message, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => void deleteSession(session),
      },
    ]);
  };

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
      edges={['top']}
    >
      <View style={styles.header}>
        <Pressable
          onPress={openDrawer}
          style={({ pressed }) => [
            styles.drawerBtn,
            pressed && { backgroundColor: colors.bg.soft },
          ]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Menu size={20} color={colors.text.ink} />
        </Pressable>
        <View style={styles.headerCenter}>
          <ConnectionSourceDropdown value={sourceFilter} options={sourceOptions} onChange={setSourceFilter} />
        </View>
        <Pressable
          onPress={() => navigation.navigate('Settings')}
          style={({ pressed }) => [
            styles.settingsBtn,
            pressed && { backgroundColor: colors.bg.soft },
          ]}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <SettingsIcon size={20} color={colors.text.ink} />
        </Pressable>
      </View>

      <FlatList
        data={orderedSessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={listContentStyle}
        onScrollBeginDrag={() => setOpenSwipeRowId(null)}
        ListHeaderComponent={
          null
        }
        renderItem={({ item, index }) => (
          <>
            {index === 0 && pinnedCount > 0 ? (
              <Text style={[styles.sectionLabel, { color: colors.text.soft }]}>置顶</Text>
            ) : null}
            {index === pinnedCount && pinnedCount > 0 && pinnedCount < orderedSessions.length ? (
              <Text style={[styles.recentSectionLabel, { color: colors.text.soft }]}>最近对话</Text>
            ) : null}
            <SessionSwipeRow
              item={item}
              roleName={getSessionRoleName(item, roleNames)}
              connectionStatus={connectionStatus}
              colors={colors}
              isPinned={isThreadPinned(pinnedAtByThreadId, item.id)}
              isUnread={selectThreadUnread(progressByThreadId, item.id)}
              canDelete={item.source === 'local-provider' || canDeleteSessions}
              isOpen={openSwipeRowId === item.id}
              onSwipeStateChange={(open) =>
                setOpenSwipeRowId(open ? item.id : (current) =>
                  current === item.id ? null : current,
                )
              }
              onOpen={() => openSession(item)}
              onTogglePin={() => void togglePin(item)}
              onDelete={() => confirmDelete(item)}
            />
          </>
        )}
        ListEmptyComponent={() => {
          if (collectionState === 'loading') {
            return (
              <View
                style={styles.loadingState}
                accessibilityLabel="正在加载线程列表"
                accessibilityRole="progressbar"
              >
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            );
          }

          if (collectionState === 'error' && loadDiagnostic) {
            return <View style={styles.emptyState}><Text style={[styles.emptyTitle, { color: colors.text.ink }]}>连接不可用</Text><Text style={[styles.emptySubtitle, { color: colors.text.soft }]}>请在“连接”中检查远程连接状态</Text></View>;
          }

          return (
            <View style={styles.emptyState}>
              <View style={styles.emptyIllustration}>
                <EmptyStateIllustration size={168} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text.ink }]}>暂无会话</Text>
              <Text style={[styles.emptySubtitle, { color: colors.text.soft }]}>{getEmptyDescription(sourceFilter)}</Text>
            </View>
          );
        }}
      />

      {drawerOpen ? (
        <Modal transparent animationType="none" onRequestClose={closeDrawer}>
          <View style={StyleSheet.absoluteFill}>
            <Animated.View
              style={[
                styles.drawerBackdrop,
                { opacity: backdropAnim, backgroundColor: colors.overlay },
              ]}
              onTouchStart={closeDrawer}
            />
            <Animated.View
              style={[
                styles.drawerPanel,
                { width: DRAWER_WIDTH, transform: [{ translateX: drawerAnim }] },
              ]}
            >
              <CustomDrawer onClose={closeDrawer} />
            </Animated.View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  drawerBtn: {
    width: sizing.buttonHeight,
    height: sizing.buttonHeight,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  settingsBtn: {
    width: sizing.buttonHeight,
    height: sizing.buttonHeight,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: { paddingHorizontal: spacing.lg },
  sectionLabel: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    fontSize: fontSize.captionUppercase,
  },
  recentSectionLabel: {
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
    fontSize: fontSize.captionUppercase,
  },
  emptyState: {
    flex: 1,
    alignItems: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: spacing.section,
    paddingBottom: 80,
  },
  loadingState: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIllustration: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    alignSelf: 'center',
  },
  emptyTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: '600',
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: { fontSize: fontSize.button, textAlign: 'center' },
  drawerBackdrop: { ...StyleSheet.absoluteFill },
  drawerPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
});