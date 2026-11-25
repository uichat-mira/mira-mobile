import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ChevronLeft,
  MoreVertical,
  Share2,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import type { ChatMessage } from '../types';
import type { AgentExecutionStrengthId } from '../settings/agentExecutionStrength';
import type { ConversationMatch } from '../chat/conversationTools';
import {
  ConversationOrchestrator,
  type ConversationLifecycleEvent,
} from '../chat/conversationOrchestration';
import { miraHostClient } from '../api/miraHostClient';
import { useCloudAccountStore } from '../cloud/cloudAccountStore';
import { RemoteHostError } from '../api/remoteHttp';
import {
  desktopThreadWorkspaceService,
  DesktopThreadWorkspaceError,
  type DesktopThreadBinding,
} from '../mcp/desktopThreadWorkspace';
import type { RemoteThreadWorkspaceProjection } from '../protocol/remoteThreadWorkspaceV1';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { useThreadReadStore } from '../store/threadReadStore';
import { useThreadPinStore } from '../store/threadPinStore';
import { removeLastOpenedSession } from '../session/lastOpenedSession';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { AssistantMarkdown } from '../chat/AssistantMarkdown';
import { ConversationMenu } from '../chat/ConversationMenu';
import { ChatComposer } from '../chat/ChatComposer';
import { useComposerControls } from '../chat/useComposerControls';
import { ConversationSearchBar } from '../chat/ConversationSearchBar';
import { MessageAttachments } from '../chat/MessageAttachments';
import {
  LocalAgentRunCard,
  type LocalAgentActivity,
  type LocalAgentApprovalView,
  type LocalAgentNoticeCode,
  type LocalAgentPauseReason,
  type LocalAgentRunPhase,
} from '../agent/LocalAgentRunCard';
import { buildShareCardModel, collectShareableMessages } from '../share/shareCardModel';
import { ConversationShareCoordinator } from '../share/conversationShareCoordinator';
import { ShareMessageSelector } from '../share/ShareMessageSelector';
import { AssistantMessageHapticsObserver } from '../haptics/newAssistantMessageHaptics';
import { lightImpact } from '../haptics/haptics';
import type { ToolApprovalDecision } from '../tools/toolGatewayClient';
import {
  getChatHistoryErrorMessage,
  readCanonicalSessionTitle,
  readLocalSessionTitle,
} from '../chat/chatSessionState';

function ThinkingIndicator({ color }: { color: string }) {
  const dots = useRef([
    new Animated.Value(0.35),
    new Animated.Value(0.35),
    new Animated.Value(0.35),
  ]).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        140,
        dots.map((dot) =>
          Animated.sequence([
            Animated.timing(dot, {
              toValue: 1,
              duration: 280,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(dot, {
              toValue: 0.35,
              duration: 420,
              easing: Easing.in(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ),
      ),
    );
    animation.start();
    return () => animation.stop();
  }, [dots]);

  return (
    <View style={styles.thinkingIndicator} accessibilityLabel="Mira 正在回复">
      {dots.map((opacity, index) => (
        <Animated.View
          key={index}
          style={[styles.thinkingDot, { backgroundColor: color, opacity }]}
        />
      ))}
    </View>
  );
}

function MessageHistorySkeleton({
  colors,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  const { height } = useWindowDimensions();

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <View
      style={[
        styles.historySkeleton,
        { minHeight: Math.max(460, height * 0.62) },
      ]}
      accessibilityLabel="正在加载聊天记录"
      accessibilityRole="progressbar"
    >
      <Animated.View
        style={[
          styles.skeletonHeader,
          { backgroundColor: colors.bg.bubble, opacity },
        ]}
      >
        <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '38%' }]} />
        <View style={[styles.skeletonLine, styles.skeletonTitleLine, { backgroundColor: colors.border.default, width: '72%' }]} />
        <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '52%' }]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.skeletonSection,
          { backgroundColor: colors.bg.soft, opacity },
        ]}
      >
        <View style={styles.skeletonSectionHeader}>
          <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '30%' }]} />
          <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '16%' }]} />
        </View>
        <View style={styles.skeletonRow}>
          <View style={[styles.skeletonIcon, { backgroundColor: colors.border.default }]} />
          <View style={styles.skeletonRowContent}>
            <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '68%' }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '88%' }]} />
          </View>
        </View>
        <View style={styles.skeletonRow}>
          <View style={[styles.skeletonIcon, { backgroundColor: colors.border.default }]} />
          <View style={styles.skeletonRowContent}>
            <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '54%' }]} />
            <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '76%' }]} />
          </View>
        </View>
      </Animated.View>
      <Animated.View
        style={[
          styles.skeletonBody,
          { backgroundColor: colors.bg.bubble, opacity },
        ]}
      >
        <View style={[styles.skeletonLine, { backgroundColor: colors.border.default, width: '34%' }]} />
        <View style={[styles.skeletonLine, styles.skeletonTitleLine, { backgroundColor: colors.border.default, width: '58%' }]} />
        <View style={[styles.skeletonParagraphLine, { backgroundColor: colors.border.default, width: '100%' }]} />
        <View style={[styles.skeletonParagraphLine, { backgroundColor: colors.border.default, width: '92%' }]} />
        <View style={[styles.skeletonParagraphLine, { backgroundColor: colors.border.default, width: '67%' }]} />
      </Animated.View>
      <View style={[styles.skeletonSpacer, { minHeight: Math.max(0, height * 0.12) }]} />
    </View>
  );
}

const createLocalMessageId = () =>
  `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export function ChatScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Chat'>>();
  const { sessionId, title: routeTitle, source, providerName, providerModel, cloudAccountId } = route.params;
  const activeCloudAccountId = useCloudAccountStore(state => state.account?.id);
  const cloudAccountStatus = useCloudAccountStore(state => state.status);
  const { colors } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const markThreadRead = useThreadReadStore((state) => state.markThreadRead);
  const clearThreadRead = useThreadReadStore((state) => state.clearThread);
  const themedStyles = useMemo(
    () =>
      StyleSheet.create({
        userBubble: { backgroundColor: colors.text.ink },
      }),
    [colors],
  );

  const [sessionTitle, setSessionTitle] = useState(routeTitle);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [preparingSend, setPreparingSend] = useState(false);
  const sendingRef = useRef(false);
  const [streamingText, setStreamingText] = useState('');
  const [cloudCanSend, setCloudCanSend] = useState(false);
  const [agentPhase, setAgentPhase] = useState<LocalAgentRunPhase>('idle');
  const [agentActivities, setAgentActivities] = useState<LocalAgentActivity[]>([]);
  const [agentPauseReason, setAgentPauseReason] =
    useState<LocalAgentPauseReason | null>(null);
  const [pendingAgentApproval, setPendingAgentApproval] =
    useState<LocalAgentApprovalView | null>(null);
  const [approvalAction, setApprovalAction] =
    useState<ToolApprovalDecision | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [agentNotice, setAgentNotice] = useState<LocalAgentNoticeCode | null>(
    null,
  );
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isShareSelecting, setIsShareSelecting] = useState(false);
  // Frozen when the selector opens, so the confirm path builds the very same
  // message snapshot the user selected from.
  const [shareSnapshot, setShareSnapshot] = useState<readonly ChatMessage[]>([]);
  const [searchFocusMessageId, setSearchFocusMessageId] = useState<string | null>(
    null,
  );
  const [menuAnchor, setMenuAnchor] = useState<{
    top: number;
    right: number;
  }>({ top: 0, right: spacing.sm });
  const [desktopThreadBinding, setDesktopThreadBinding] =
    useState<DesktopThreadBinding | null>(null);
  const [threadWorkspace, setThreadWorkspace] =
    useState<RemoteThreadWorkspaceProjection | null>(null);
  const [isLoadingThreadWorkspace, setIsLoadingThreadWorkspace] =
    useState(false);
  const [isEndingThread, setIsEndingThread] = useState(false);
  const [failedMessages, setFailedMessages] = useState<Map<string, string>>(
    new Map(),
  );
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const menuButtonRef = useRef<View>(null);
  const orchestratorRef = useRef<ConversationOrchestrator | null>(null);
  const assistantHapticsRef = useRef<AssistantMessageHapticsObserver | null>(null);
  if (assistantHapticsRef.current === null) {
    assistantHapticsRef.current = new AssistantMessageHapticsObserver();
  }
  const shareCoordinator = useMemo(() => new ConversationShareCoordinator(), []);
  const runtime = useMemo(
    () => runtimeRegistry.runtimeForSession(sessionId, source),
    [sessionId, source],
  );
  const isLocalProvider = runtime.kind === 'local-provider';
  const isCloudHost = source === 'cloud-host';
  const cloudAuthorityActive = !isCloudHost || (
    cloudAccountStatus === 'signed_in' &&
    Boolean(cloudAccountId) && cloudAccountId === activeCloudAccountId
  );
  const supportsLocalAgent = isLocalProvider && runtime.supportsAgent === true;
  const controls = useComposerControls(runtime, sessionId);
  const { strength: agentStrength, setStrength: setAgentStrength, refresh: refreshComposer, mutationPending: composerMutationPending } = controls;
  const agentModeLoading = controls.loading || controls.saving;
  const selectedModel = controls.models.find(option => option.selected);
  useFocusEffect(useCallback(() => { void refreshComposer(); }, [refreshComposer]));
  const shareDisabled =
    isSharing || isLoading || isLoadingHistory || historyError !== null;
  const shareAccessibilityLabel = isSharing
    ? '正在准备分享图片'
    : isLoading
      ? '分享会话，当前回复完成后可用'
      : isLoadingHistory
        ? '分享会话，聊天记录加载完成后可用'
        : historyError
          ? '分享会话，聊天记录重新加载后可用'
          : '分享会话';

  useEffect(() => {
    if (!isCloudHost) return;
    if (!cloudAuthorityActive) {
      runtime.cancelActiveRun();
      setMessages([]);
      setInputText('');
      setCloudCanSend(false);
      return;
    }
    let active = true;
    setCloudCanSend(false);
    void runtime.canSendMessage?.(sessionId).then(allowed => {
      if (active) setCloudCanSend(allowed);
    }).catch(() => { if (active) setCloudCanSend(false); });
    return () => { active = false; };
  }, [cloudAuthorityActive, isCloudHost, runtime, sessionId]);

  useEffect(() => {
    setIsSearchVisible(false);
    setSearchFocusMessageId(null);
  }, [sessionId]);

  useEffect(() => {
    // A new session re-establishes the baseline: opening a session must read
    // its existing history without firing the "new reply" reminder.
    assistantHapticsRef.current?.reset();
  }, [sessionId]);

  useEffect(() => {
    // Remote canonical messages arrive through the Host snapshot feed (published
    // by every canonical read, including the Agent discovery poll and run
    // observation). Feeding the same observer here means a Remote Assistant
    // reply that lands while foregrounded triggers the identical reminder as a
    // Local one, without inventing a second trigger path.
    if (isLocalProvider || isCloudHost) return undefined;
    return miraHostClient.subscribeMessageSnapshots((snapshot) => {
      if (snapshot.sessionId !== sessionId) return;
      assistantHapticsRef.current?.observe(snapshot.messages);
    });
  }, [isCloudHost, isLocalProvider, sessionId]);

  useEffect(() => {
    setAgentActivities([]);
    setPendingAgentApproval(null);
    setApprovalAction(null);
    setAgentPhase('idle');
    setAgentPauseReason(null);
    setAgentError(null);
    setAgentNotice(null);
    setDesktopThreadBinding(null);
    setThreadWorkspace(null);
    setIsLoadingThreadWorkspace(false);
    setIsEndingThread(false);
  }, [runtime, sessionId]);

  useEffect(() => {
    if (!isLocalProvider || !runtime.setExecutionSuspended) return undefined;

    const syncExecutionState = (state: string) => {
      runtime.setExecutionSuspended?.(state !== 'active');
    };
    syncExecutionState(AppState.currentState);
    const subscription = AppState.addEventListener('change', syncExecutionState);
    return () => {
      subscription.remove();
    };
  }, [isLocalProvider, runtime]);

  useFocusEffect(
    useCallback(() => {
      if (!isLocalProvider || !runtime.setExecutionSuspended) {
        return undefined;
      }
      runtime.setExecutionSuspended(AppState.currentState !== 'active');
      return () => {
        runtime.setExecutionSuspended?.(true);
      };
    }, [isLocalProvider, runtime]),
  );

  const refreshSessionTitle = useCallback(async () => {
    if (isLocalProvider) {
      const localTitle = await readLocalSessionTitle(runtime, sessionId);
      if (localTitle !== null) {
        setSessionTitle(localTitle);
      }
      return;
    }
    const canonicalTitle = isCloudHost
      ? await readLocalSessionTitle(runtime, sessionId)
      : await readCanonicalSessionTitle(miraHostClient, sessionId);
    if (canonicalTitle !== null) {
      setSessionTitle(canonicalTitle);
    }
  }, [isCloudHost, isLocalProvider, runtime, sessionId]);

  const refreshDesktopThreadBinding = useCallback(async () => {
    if (!isLocalProvider) {
      setDesktopThreadBinding(null);
      setThreadWorkspace(null);
      return;
    }
    try {
      setDesktopThreadBinding(
        await desktopThreadWorkspaceService.getBinding(sessionId),
      );
    } catch {
      // A local storage read failure must not fabricate a remote workspace or
      // block ordinary Local chat.
      setDesktopThreadBinding(null);
    }
  }, [isLocalProvider, sessionId]);

  const loadMessages = useCallback(async (): Promise<ChatMessage[] | null> => {
    setHistoryError(null);
    try {
      if (!cloudAuthorityActive) {
        throw new RemoteHostError('CLOUD_RELAY_SESSION_REJECTED',
          '当前云账号已发生变化，请重新选择会话');
      }
      const canonicalMessages = await runtime.getMessages(sessionId);
      setMessages(canonicalMessages);
      assistantHapticsRef.current?.observe(canonicalMessages);
      try {
        await markThreadRead(
          sessionId,
          canonicalMessages,
          canonicalMessages.length,
        );
      } catch {
        // A local persistence failure must not turn a valid Host history read
        // into a fake chat error or falsely clear the unread state.
      }
      return canonicalMessages;
    } catch (error) {
      if (error instanceof RemoteHostError && error.status === 404) {
        void clearThreadRead(sessionId).catch(() => undefined);
      }
      setHistoryError(getChatHistoryErrorMessage(error));
      return null;
    }
  }, [clearThreadRead, cloudAuthorityActive, markThreadRead, runtime, sessionId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setIsLoadingHistory(true);
      void Promise.all([
        loadMessages(),
        refreshSessionTitle(),
        refreshDesktopThreadBinding(),
      ]).finally(() => {
        if (active) setIsLoadingHistory(false);
      });
      return () => {
        active = false;
      };
    }, [loadMessages, refreshDesktopThreadBinding, refreshSessionTitle]),
  );

  const retryHistory = useCallback(() => {
    setIsLoadingHistory(true);
    void Promise.all([loadMessages(), refreshSessionTitle()]).finally(() => {
      setIsLoadingHistory(false);
    });
  }, [loadMessages, refreshSessionTitle]);

  const scrollToBottom = useCallback(() => {
    if (isSearchVisible) return;
    flatListRef.current?.scrollToEnd({ animated: true });
  }, [isSearchVisible]);

  // The share button no longer shares immediately: it opens the selection mode
  // so the user decides which questions and replies end up in the card.
  const handleShare = useCallback(() => {
    if (shareCoordinator.isActive || isSharing) return;
    if (isLoadingHistory || isLoading || historyError) return;

    const snapshot = collectShareableMessages(messages);
    if (snapshot.length === 0) {
      Alert.alert('暂无可分享内容', '当前会话还没有可分享的消息。');
      return;
    }

    setShareSnapshot(snapshot);
    setIsShareSelecting(true);
  }, [
    historyError,
    isLoading,
    isLoadingHistory,
    isSharing,
    messages,
    shareCoordinator,
  ]);

  const handleConfirmShare = useCallback(
    async (selectedIds: string[]) => {
      setIsShareSelecting(false);
      if (shareCoordinator.isActive || isSharing) return;

      const selected = new Set(selectedIds);
      // Build from the frozen snapshot the selector displayed, so messages that
      // streamed in while it was open can neither leak in nor shift order.
      const selectedMessages = shareSnapshot.filter((message) => selected.has(message.id));
      setShareSnapshot([]);
      const model = buildShareCardModel(selectedMessages, sessionTitle);
      if (!model) {
        Alert.alert('暂无可分享内容', '请至少选择一条要分享的消息。');
        return;
      }

      setIsSharing(true);
      try {
        await shareCoordinator.share(model);
      } catch {
        Alert.alert(
          '分享失败',
          '未能生成分享图片或打开系统分享，请重试；若仍失败，可重新打开会话后再试。',
        );
      } finally {
        setIsSharing(false);
      }
    },
    [isSharing, sessionTitle, shareCoordinator, shareSnapshot],
  );

  const closeSearch = useCallback(() => {
    setIsSearchVisible(false);
    setSearchFocusMessageId(null);
  }, []);

  const openSearch = useCallback(() => {
    setIsSearchVisible(true);
  }, []);

  const clearSearchFocus = useCallback(() => {
    setSearchFocusMessageId(null);
  }, []);

  const removePinnedThread = useThreadPinStore((state) => state.unpinThread);
  const [canDelete, setCanDelete] = useState(isLocalProvider);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    if (isLocalProvider) {
      setCanDelete(true);
      return () => {
        active = false;
      };
    }
    // Deletion is a Host-authorized mutation, so the menu must reflect the
    // current manifest grant instead of always offering a dead action.
    const check = isCloudHost
      ? runtimeRegistry.cloud.canDeleteSession()
      : miraHostClient.canDeleteSession();
    void check
      .then((allowed) => {
        if (active) setCanDelete(allowed);
      })
      .catch(() => {
        if (active) setCanDelete(false);
      });
    return () => {
      active = false;
    };
  }, [isCloudHost, isLocalProvider]);

  const handleDelete = useCallback(() => {
    if (isDeleting || !canDelete) return;
    const message = isLocalProvider
      ? `确定删除“${sessionTitle}”吗？会先结束该线程在 Mira Desktop 上的远程任务（若有），已有文件保留；随后仅删除当前设备上的本地对话。`
      : `确定删除“${sessionTitle}”吗？此操作会同步删除桌面端线程。`;
    Alert.alert('删除会话', message, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          setIsDeleting(true);
          void (async () => {
            try {
              await runtimeRegistry.deleteSession(sessionId, source);
              setDesktopThreadBinding(null);
              setThreadWorkspace(null);
              void removeLastOpenedSession(sessionId).catch(() => undefined);
              const cleanup = await Promise.allSettled([
                removePinnedThread(sessionId),
                clearThreadRead(sessionId),
              ]);
              if (cleanup.some((result) => result.status === 'rejected')) {
                Alert.alert(
                  '会话已删除',
                  '会话已删除，但本机置顶或未读状态清理未完成，请重新打开应用后检查。',
                );
              }
              navigation.goBack();
            } catch (error) {
              if (error instanceof DesktopThreadWorkspaceError) {
                Alert.alert(
                  '无法确认远程线程已结束',
                  `${error.message} 本机会话未删除；请检查 Mira Desktop 连接后重试。`,
                );
              } else {
                const failure =
                  error instanceof Error && error.message
                    ? error.message
                    : '无法删除该会话，请重试。';
                Alert.alert('删除失败', failure);
              }
            } finally {
              setIsDeleting(false);
            }
          })();
        },
      },
    ]);
  }, [
    canDelete,
    clearThreadRead,
    isDeleting,
    isLocalProvider,
    navigation,
    removePinnedThread,
    sessionId,
    sessionTitle,
    source,
  ]);

  const upsertAgentActivity = useCallback(
    (
      callId: string,
      name: string,
      status: LocalAgentActivity['status'],
      detail?: string,
    ) => {
      setAgentActivities(prev => {
        const index = prev.findIndex(item => item.callId === callId);
        const next: LocalAgentActivity = {
          callId,
          name,
          status,
          ...(detail ? { detail } : {}),
        };
        if (index < 0) return [...prev, next];
        return [
          ...prev.slice(0, index),
          { ...prev[index], ...next },
          ...prev.slice(index + 1),
        ];
      });
    },
    [],
  );

  const agentEnabled = agentStrength !== 'plain';

  const handleAgentApproval = useCallback(
    (decision: ToolApprovalDecision) => {
      if (
        !pendingAgentApproval ||
        approvalAction ||
        !runtime.resolveToolApproval
      ) {
        return;
      }
      setApprovalAction(decision);
      runtime.resolveToolApproval(
        pendingAgentApproval.invocationId,
        decision,
      );
    },
    [approvalAction, pendingAgentApproval, runtime],
  );

  const focusSearchMatch = useCallback((match: ConversationMatch) => {
    setSearchFocusMessageId(match.messageId);
    flatListRef.current?.scrollToIndex({
      index: match.messageIndex,
      animated: true,
      viewPosition: 0.45,
    });
  }, []);

  const handleLifecycleEvent = useCallback(
    (event: ConversationLifecycleEvent) => {
      switch (event.type) {
        case 'turn-started':
          setFailedMessages((prev) => {
            if (!prev.has(event.messageId)) return prev;
            const next = new Map(prev);
            next.delete(event.messageId);
            return next;
          });
          setInputText('');
          setIsLoading(true);
          setPreparingSend(false);
          setStreamingText('');
          break;
        case 'agent-reset':
          setAgentActivities([]);
          setPendingAgentApproval(null);
          setApprovalAction(null);
          setAgentPauseReason(null);
          setAgentError(null);
          setAgentNotice(null);
          break;
        case 'clear-approval-action':
          setApprovalAction(null);
          break;
        case 'clear-approval':
          setPendingAgentApproval(null);
          setApprovalAction(null);
          break;
        case 'text':
          setStreamingText(event.text);
          scrollToBottom();
          break;
        case 'activity':
          upsertAgentActivity(
            event.callId,
            event.name,
            event.status,
            event.detail,
          );
          break;
        case 'approval-required':
          setPendingAgentApproval({
            invocationId: event.approval.invocationId,
            callId: event.approval.callId,
            name: event.approval.name,
            message: event.approval.message,
            ...(event.approval.scope ? { scope: event.approval.scope } : {}),
          });
          break;
        case 'notice':
          setAgentNotice(event.code);
          break;
        case 'phase':
          setAgentPhase(event.phase);
          break;
        case 'pause':
          setAgentPauseReason(event.reason);
          break;
        case 'canonical-reload':
          setMessages(event.messages);
          assistantHapticsRef.current?.observe(event.messages);
          break;
        case 'failure':
          // A user cancel is never reported as an ordinary failure.
          if (event.kind !== 'cancelled') {
            setFailedMessages((prev) =>
              new Map(prev).set(event.messageId, event.message),
            );
            if (supportsLocalAgent && agentEnabled) {
              setAgentError(event.message);
            }
          }
          break;
        default:
          break;
      }
    },
    [
      agentEnabled,
      scrollToBottom,
      supportsLocalAgent,
      upsertAgentActivity,
    ],
  );

  const getOrchestrator = useCallback(
    (): ConversationOrchestrator =>
      new ConversationOrchestrator(
        {
          runtime,
          loadCanonicalMessages: loadMessages,
          refreshSessionTitle: () => {
            void refreshSessionTitle();
          },
        },
        (input) =>
          runtime.sendMessage(sessionId, input.content, {
            messageId: input.messageId,
          }),
      ),
    [loadMessages, refreshSessionTitle, runtime, sessionId],
  );

  const runTurn = useCallback(
    async (
      content: string,
      messageId: string,
      userTimestamp: number,
      useLocalAgent: boolean,
    ) => {
      const orchestrator = getOrchestrator();
      orchestratorRef.current = orchestrator;
      try {
        await orchestrator.dispatchTurn(
          {
            content,
            messageId,
            agentEnabled: useLocalAgent,
            userTimestamp,
          },
          { emit: handleLifecycleEvent },
          createLocalMessageId,
        );
      } finally {
        orchestratorRef.current = null;
        setStreamingText('');
        setIsLoading(false);
      }
    },
    [getOrchestrator, handleLifecycleEvent],
  );

  const sendMessage = useCallback(
    async (text?: string, existingMessage?: ChatMessage) => {
      const content = (text ?? existingMessage?.content ?? inputText).trim();
      if (
        !content ||
        sendingRef.current ||
        isLoading ||
        (isCloudHost && (!cloudAuthorityActive || !cloudCanSend)) ||
        (isLocalProvider && (agentModeLoading || composerMutationPending()))
      ) {
        return;
      }

      sendingRef.current = true;
      setPreparingSend(true);
      try {
        let effectiveStrength: AgentExecutionStrengthId = 'plain';
        if (supportsLocalAgent && runtime.getEffectiveAgentStrength) {
          try {
            effectiveStrength = await runtime.getEffectiveAgentStrength(sessionId);
            setAgentStrength(effectiveStrength);
          } catch {
            // Let the runtime send surface the fail-closed strength error instead
            // of silently downgrading this turn to plain chat.
            effectiveStrength = agentStrength;
          }
        }
        const useLocalAgent = supportsLocalAgent && effectiveStrength !== 'plain';
        // Retry reuses the same user message id so an uncertain reconnect cannot
        // duplicate the user message (Remote Host V1 requires a stable messageId).
        const userMsg: ChatMessage = existingMessage ?? {
          id: createLocalMessageId(),
          role: 'user',
          content,
          timestamp: new Date(),
        };
        if (!existingMessage) {
          setMessages((prev) => [...prev, userMsg]);
        }

        // Haptic feedback fires for every user-initiated send (including retries)
        // so the interaction contract "my question was delivered" matches what
        // users feel. It runs in parallel with runTurn — no await, the network
        // path must never wait on the vibrator.
        void lightImpact();

        await runTurn(content, userMsg.id, userMsg.timestamp.getTime(), useLocalAgent);
      } finally {
        sendingRef.current = false;
        setPreparingSend(false);
      }
    },
    [
      agentModeLoading,
      agentStrength,
      composerMutationPending,
      cloudAuthorityActive,
      cloudCanSend,
      isCloudHost,
      isLocalProvider,
      inputText,
      isLoading,
      runTurn,
      runtime,
      sessionId,
      setAgentStrength,
      supportsLocalAgent,
    ],
  );

  const handleStop = useCallback(() => {
    const orchestrator = orchestratorRef.current;
    if (orchestrator) {
      orchestrator.cancel();
    } else {
      runtime.cancelActiveRun();
    }
    if (supportsLocalAgent && agentEnabled) {
      setPendingAgentApproval(null);
      setApprovalAction(null);
      setAgentPauseReason('cancelled');
      setAgentPhase('paused');
    }
  }, [agentEnabled, runtime, supportsLocalAgent]);

  const showDesktopThreadWorkspace = useCallback(() => {
    if (!isLocalProvider || isLoadingThreadWorkspace) return;
    setIsLoadingThreadWorkspace(true);
    void (async () => {
      try {
        const projection =
          await desktopThreadWorkspaceService.getWorkspace(sessionId);
        setThreadWorkspace(projection);
        if (projection.status === 'active' && projection.workspace) {
          Alert.alert(
            '远程工作空间',
            [
              'Mira Desktop 已为当前线程创建私有工作空间。',
              `引用：${projection.workspace.ref}`,
              `目录当前可用：${projection.workspace.available ? '是' : '否'}`,
              '成果文件保留在 Mira Desktop；手机端不会虚构本机目录。',
            ].join('\n'),
          );
          return;
        }
        if (projection.status === 'ended') {
          // A discovery read can show `ended` while an earlier end request was
          // never confirmed. Do not present that as proven cleanup success.
          Alert.alert(
            '远程线程已标记结束',
            projection.workspace
              ? ['Mira Desktop 已把该线程标记为结束，已有文件仍保留。', `引用：${projection.workspace.ref}`, desktopThreadBinding?.endState === 'confirmed' ? '清理已确认。' : '清理尚未确认，可重试结束。'].join('\n')
              : 'Mira Desktop 已把该线程标记为结束，没有已生成的远程工作空间。可使用「重试结束远程线程」再次确认清理结果。',
          );
          return;
        }
        Alert.alert(
          '尚无远程工作空间',
          '当前线程还没有实际执行需要 Mira Desktop 工作空间的工具，因此没有生成目录。',
        );
      } catch (error) {
        if (error instanceof DesktopThreadWorkspaceError) {
          Alert.alert(
            '无法读取远程工作空间',
            `${error.message}${error.retryable ? ' 请检查连接后重试。' : ''}`,
          );
          return;
        }
        Alert.alert('无法读取远程工作空间', '请检查 Mira Desktop 连接后重试。');
      } finally {
        setIsLoadingThreadWorkspace(false);
      }
    })();
  }, [desktopThreadBinding, isLoadingThreadWorkspace, isLocalProvider, sessionId]);

  const endDesktopThread = useCallback(() => {
    if (!isLocalProvider || isEndingThread) return;
    Alert.alert(
      '结束远程线程',
      '这会停止该线程在 Mira Desktop 上仍在运行的远程任务和终端会话。已有文件与成果会保留，不会删除本机聊天。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '结束',
          style: 'destructive',
          onPress: () => {
            setIsEndingThread(true);
            void (async () => {
              try {
                const result =
                  await desktopThreadWorkspaceService.endThread(sessionId);
                if (result.kind === 'no_remote_work') {
                  setDesktopThreadBinding(null);
                  setThreadWorkspace(null);
                  Alert.alert(
                    '无需结束',
                    '当前线程还没有绑定 Mira Desktop 的远程工作。',
                  );
                  return;
                }
                setThreadWorkspace(result.projection);
                await refreshDesktopThreadBinding();
                Alert.alert(
                  '远程线程已结束',
                  [
                    'Mira Desktop 已确认该线程结束。',
                    `停止进行中的调用：${result.projection.stoppedInvocations ?? '未提供'}；停止终端会话：${result.projection.stoppedTerminalSessions ?? '未提供'}。`,
                    '已有文件与成果仍保留。',
                    ...(result.localEndRecorded === false
                      ? ['本机结束状态未能保存，后续可能需要再次确认结束。']
                      : []),
                  ].join('\n'),
                );
              } catch (error) {
                const message = error instanceof DesktopThreadWorkspaceError
                  ? error.message
                  : '无法确认 Mira Desktop 已结束该线程。';
                Alert.alert(
                  '结束未确认',
                  `${message} 本机聊天未被删除；请检查连接后重试。`,
                );
              } finally {
                setIsEndingThread(false);
              }
            })();
          },
        },
      ],
    );
  }, [isEndingThread, isLocalProvider, refreshDesktopThreadBinding, sessionId]);

  const openMenu = useCallback(() => {
    void refreshDesktopThreadBinding();
    menuButtonRef.current?.measureInWindow((x, y, width, height) => {
      setMenuAnchor({
        top: y + height + spacing.xs,
        right: Math.max(spacing.sm, windowWidth - x - width),
      });
      setIsMenuVisible(true);
    });
  }, [refreshDesktopThreadBinding, windowWidth]);

  const handleRetry = useCallback(
    (msg: ChatMessage) => {
      void sendMessage(undefined, msg);
    },
    [sendMessage],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isUser = item.role === 'user';
      const failureMessage = isUser ? failedMessages.get(item.id) : undefined;
      const isFailed = failureMessage !== undefined;
      const isSearchFocused = item.id === searchFocusMessageId;

      return (
        <View
          style={[
            styles.messageRow,
            isUser ? styles.messageRowRight : styles.messageRowLeft,
            isSearchFocused && [
              styles.searchFocusedRow,
              { backgroundColor: colors.bg.soft },
            ],
          ]}
        >
          <View>
            <View
              style={[
                styles.bubble,
                isUser ? styles.userBubble : styles.assistantBubble,
                isUser && themedStyles.userBubble,
              ]}
            >
              {isUser ? (
                <Text style={[styles.bubbleText, { color: colors.bg.elevated }]}>
                  {item.content}
                </Text>
              ) : (
                <AssistantMarkdown content={item.content} />
              )}
              {!isCloudHost ? <MessageAttachments threadId={sessionId} parts={item.parts} /> : null}
            </View>
            {isFailed ? (
              <>
                <Text
                  style={[styles.failureText, { color: colors.status.error }]}
                >
                  {failureMessage}
                </Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.retryBtn,
                    pressed && { opacity: 0.6 },
                  ]}
                  onPress={() => handleRetry(item)}
                >
                  <Text
                    style={[styles.retryText, { color: colors.status.error }]}
                  >
                    点击重试
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      );
    },
    [
      colors,
      failedMessages,
      handleRetry,
      isCloudHost,
      searchFocusMessageId,
      sessionId,
      themedStyles,
    ],
  );

  const renderFooter = useCallback(() => {
    const showAgentState =
      supportsLocalAgent &&
      agentEnabled &&
      (agentPhase !== 'idle' ||
        agentActivities.length > 0 ||
        pendingAgentApproval !== null ||
        agentNotice !== null ||
        agentError !== null);
    if (!streamingText && !isLoading && !showAgentState) return null;

    return (
      <View>
        {showAgentState ? (
          <LocalAgentRunCard
            phase={agentPhase}
            pauseReason={agentPauseReason}
            activities={agentActivities}
            approval={pendingAgentApproval}
            approvalAction={approvalAction}
            notice={agentNotice}
            error={agentError}
            onApproval={handleAgentApproval}
          />
        ) : null}
        {streamingText || isLoading ? (
          <View style={[styles.messageRow, styles.messageRowLeft]}>
            <View style={[styles.bubble, styles.assistantBubble]}>
              {streamingText ? (
                <AssistantMarkdown content={streamingText} />
              ) : (
                <ThinkingIndicator color={colors.text.soft} />
              )}
            </View>
          </View>
        ) : null}
      </View>
    );
  }, [
    agentActivities,
    agentEnabled,
    agentError,
    agentNotice,
    agentPauseReason,
    agentPhase,
    approvalAction,
    colors.text.soft,
    handleAgentApproval,
    isLoading,
    pendingAgentApproval,
    streamingText,
    supportsLocalAgent,
  ]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.bg.canvas }]}
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
        <View style={styles.headerLeading}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="返回"
            hitSlop={8}
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && { backgroundColor: colors.bg.soft },
            ]}
          >
            <ChevronLeft size={24} color={colors.text.ink} />
          </Pressable>
        </View>
        <View style={styles.headerTitleGroup}>
          <Text style={[styles.headerTitle, { color: colors.text.ink }]} numberOfLines={1}>
            {sessionTitle}
          </Text>
          <Text style={[styles.headerSource, { color: colors.text.soft }]} numberOfLines={1}>
            {isLocalProvider
              ? (selectedModel ? `${selectedModel.providerName} · ${selectedModel.model}` : controls.supportsModels ? 'Local Provider' : `${providerName || 'Local Provider'}${providerModel ? ` · ${providerModel}` : ''}`)
              : 'Remote Host'}
          </Text>
        </View>
        <View
          style={[
            styles.headerActionGroup,
            {
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={shareAccessibilityLabel}
            accessibilityState={{ disabled: shareDisabled, busy: isSharing }}
            disabled={shareDisabled}
            onPress={() => void handleShare()}
            style={({ pressed }) => [
              styles.groupButton,
              pressed && !shareDisabled && { backgroundColor: colors.bg.soft },
              shareDisabled && { opacity: 0.5 },
            ]}
          >
            {isSharing ? (
              <ActivityIndicator size="small" color={colors.text.ink} />
            ) : (
              <Share2 size={19} color={colors.text.ink} strokeWidth={2} />
            )}
          </Pressable>
          <View
            style={[
              styles.groupDivider,
              { backgroundColor: colors.border.default },
            ]}
          />
          <Pressable
            ref={menuButtonRef}
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel="打开会话菜单"
            onPress={openMenu}
            style={({ pressed }) => [
              styles.groupButton,
              pressed && { backgroundColor: colors.bg.soft },
            ]}
          >
            <MoreVertical size={20} color={colors.text.ink} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>

      <ConversationMenu
        visible={isMenuVisible}
        title={sessionTitle}
        anchor={menuAnchor}
        onClose={() => setIsMenuVisible(false)}
        onShare={() => void handleShare()}
        shareDisabled={shareDisabled}
        shareDisabledAccessibilityLabel={shareAccessibilityLabel}
        {...(isLocalProvider && desktopThreadBinding
          ? {
              onViewWorkspace: showDesktopThreadWorkspace,
              viewWorkspaceDisabled: isLoadingThreadWorkspace,
              viewWorkspaceDisabledAccessibilityLabel:
                '查看远程工作空间，正在读取',
              onEndThread: endDesktopThread,
              endThreadDisabled: isEndingThread || desktopThreadBinding.endState === 'confirmed',
              endThreadDisabledAccessibilityLabel:
                '结束远程线程，正在处理',
              endThreadLabel:
                desktopThreadBinding.endState === 'confirmed'
                  ? '结束远程线程'
                  : desktopThreadBinding.endState === 'pending' || threadWorkspace?.status === 'ended'
                  ? '重试结束远程线程'
                  : '结束远程线程',
            }
          : {})}
        onFindInChat={openSearch}
        onDelete={handleDelete}
        deleteDisabled={isDeleting || !canDelete}
        deleteDisabledAccessibilityLabel={
          isDeleting
            ? '删除会话，正在删除'
            : '删除会话，当前 Mira Host 未授权删除'
        }
      />

      <ShareMessageSelector
        visible={isShareSelecting}
        messages={shareSnapshot}
        busy={isSharing}
        onCancel={() => {
          setIsShareSelecting(false);
          setShareSnapshot([]);
        }}
        onConfirm={(selectedIds) => void handleConfirmShare(selectedIds)}
      />

      {isSearchVisible ? (
        <ConversationSearchBar
          messages={messages}
          onFocusMatch={focusSearchMatch}
          onClearFocus={clearSearchFocus}
          onClose={closeSearch}
        />
      ) : null}

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <ChatComposer
          key={sessionId}
          value={inputText}
          onChangeText={setInputText}
          placeholder={isCloudHost && !cloudCanSend ? '当前 Cloud Host 尚未授予消息发送权限' : '给 Mira 发消息...'}
          editable={cloudAuthorityActive && (!isCloudHost || cloudCanSend) && !isLoading}
          running={isLoading}
          onSend={() => void sendMessage()}
          onStop={handleStop}
          strength={controls.supportsStrength ? agentStrength : undefined}
          followsGlobal={controls.override === null}
          strengthReady={controls.strengthReady}
          models={controls.supportsModels ? controls.models : undefined}
          modelsReady={controls.modelsReady}
          busy={preparingSend || (isLocalProvider && agentModeLoading)}
          error={controls.error}
          onRefresh={() => void refreshComposer()}
          onStrength={value => { if (!sendingRef.current) void controls.chooseStrength(value); }}
          onModel={providerId => { if (!sendingRef.current) void controls.chooseModel(providerId); }}
        >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.messageList}
          onContentSizeChange={scrollToBottom}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            flatListRef.current?.scrollToOffset({
              offset: Math.max(0, averageItemLength * index),
              animated: true,
            });
          }}
          ListEmptyComponent={
            isLoadingHistory ? (
              <MessageHistorySkeleton colors={colors} />
            ) : historyError ? (
              <View style={styles.historyErrorState}>
                <Text
                  style={[styles.historyErrorText, { color: colors.text.muted }]}
                >
                  {historyError}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="重新加载聊天记录"
                  onPress={retryHistory}
                  style={({ pressed }) => [
                    styles.historyRetryButton,
                    {
                      backgroundColor: pressed
                        ? colors.primaryActive
                        : colors.primary,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.historyRetryText,
                      { color: colors.onPrimary },
                    ]}
                  >
                    重试
                  </Text>
                </Pressable>
              </View>
            ) : null
          }
          ListFooterComponent={renderFooter}
        />

        </ChatComposer>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLeading: {
    width: sizing.touchTarget * 2,
    alignItems: 'flex-start',
  },
  headerActionGroup: {
    width: sizing.touchTarget * 2,
    height: sizing.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  groupButton: {
    flex: 1,
    height: sizing.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupDivider: { width: StyleSheet.hairlineWidth, height: 20 },
  headerTitle: {
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif' }),
    fontSize: fontSize.xl,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerTitleGroup: { flex: 1, minWidth: 0, alignItems: 'center' },
  headerSource: { fontSize: fontSize.xs, marginTop: 1 },
  container: { flex: 1 },
  messageList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  historySkeleton: {
    justifyContent: 'flex-start',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  historyErrorState: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  historyErrorText: {
    maxWidth: 320,
    textAlign: 'center',
    fontSize: fontSize.bodyMd,
    lineHeight: 22,
  },
  historyRetryButton: {
    minWidth: 96,
    height: sizing.touchTarget,
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyRetryText: { fontSize: fontSize.button, fontWeight: '600' },
  skeletonHeader: {
    minHeight: 112,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  skeletonSection: {
    minHeight: 176,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  skeletonSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skeletonRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
  },
  skeletonRowContent: {
    flex: 1,
    gap: spacing.sm,
  },
  skeletonBody: {
    minHeight: 150,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  skeletonSpacer: { flex: 1 },
  skeletonLine: { height: 10, borderRadius: radius.full },
  skeletonTitleLine: { height: 16 },
  skeletonParagraphLine: { height: 12, borderRadius: radius.full },
  messageRow: { marginBottom: spacing.lg, flexDirection: 'row' },
  messageRowLeft: { justifyContent: 'flex-start' },
  messageRowRight: { justifyContent: 'flex-end' },
  searchFocusedRow: { borderRadius: radius.sm },
  bubble: { flexShrink: 1 },
  userBubble: {
    maxWidth: 272,
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    maxWidth: '100%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  bubbleText: { fontSize: fontSize.md, lineHeight: 24 },
  thinkingIndicator: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  thinkingDot: { width: 6, height: 6, borderRadius: 3 },
  retryBtn: {
    marginTop: 4,
    alignSelf: 'flex-end',
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  retryText: { fontSize: fontSize.sm },
  failureText: { fontSize: fontSize.sm, lineHeight: 18, marginTop: 6 },
});
