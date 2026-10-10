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
  TextInput,
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
  Bot,
  ChevronLeft,
  MoreVertical,
  Send,
  Share2,
  Square,
} from 'lucide-react-native';
import type { RootStackParamList } from '../types/navigation';
import type { ChatMessage } from '../types';
import type { ConversationMatch } from '../chat/conversationTools';
import {
  ConversationOrchestrator,
  type ConversationLifecycleEvent,
} from '../chat/conversationOrchestration';
import { miraHostClient } from '../api/miraHostClient';
import { RemoteHostError } from '../api/remoteHttp';
import { runtimeRegistry } from '../runtime/runtimeRegistry';
import { useThreadReadStore } from '../store/threadReadStore';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, shadows, sizing, spacing } from '../theme/tokens';
import { AssistantMarkdown } from '../chat/AssistantMarkdown';
import { ConversationMenu } from '../chat/ConversationMenu';
import { ConversationSearchBar } from '../chat/ConversationSearchBar';
import { MessageAttachments } from '../chat/MessageAttachments';
import {
  LocalAgentRunCard,
  type LocalAgentActivity,
  type LocalAgentApprovalView,
  type LocalAgentPauseReason,
  type LocalAgentRunPhase,
} from '../agent/LocalAgentRunCard';
import { buildShareCardModel } from '../share/shareCardModel';
import { ConversationShareCoordinator } from '../share/conversationShareCoordinator';
import { buildShareSelectionRows } from '../share/shareSelection';
import { ShareMessageSelector } from '../share/ShareMessageSelector';
import { AssistantMessageHapticsObserver } from '../haptics/newAssistantMessageHaptics';
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
  const { sessionId, title: routeTitle, source, providerName, providerModel } = route.params;
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
  const [streamingText, setStreamingText] = useState('');
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [agentModeLoading, setAgentModeLoading] = useState(true);
  const [agentPhase, setAgentPhase] = useState<LocalAgentRunPhase>('idle');
  const [agentActivities, setAgentActivities] = useState<LocalAgentActivity[]>([]);
  const [agentPauseReason, setAgentPauseReason] =
    useState<LocalAgentPauseReason | null>(null);
  const [pendingAgentApproval, setPendingAgentApproval] =
    useState<LocalAgentApprovalView | null>(null);
  const [approvalAction, setApprovalAction] =
    useState<ToolApprovalDecision | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isShareSelecting, setIsShareSelecting] = useState(false);
  const [searchFocusMessageId, setSearchFocusMessageId] = useState<string | null>(
    null,
  );
  const [menuAnchor, setMenuAnchor] = useState<{
    top: number;
    right: number;
  }>({ top: 0, right: spacing.sm });
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
  const supportsLocalAgent = isLocalProvider && runtime.supportsAgent === true;
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
    if (isLocalProvider) return undefined;
    return miraHostClient.subscribeMessageSnapshots((snapshot) => {
      if (snapshot.sessionId !== sessionId) return;
      assistantHapticsRef.current?.observe(snapshot.messages);
    });
  }, [isLocalProvider, sessionId]);

  useEffect(() => {
    let active = true;
    setAgentActivities([]);
    setPendingAgentApproval(null);
    setApprovalAction(null);
    setAgentPhase('idle');
    setAgentPauseReason(null);
    setAgentError(null);

    if (!supportsLocalAgent || !runtime.getAgentEnabled) {
      setAgentEnabled(false);
      setAgentModeLoading(false);
      return () => {
        active = false;
      };
    }

    setAgentModeLoading(true);
    void runtime
      .getAgentEnabled(sessionId)
      .then(enabled => {
        if (active) setAgentEnabled(enabled);
      })
      .catch(() => {
        if (active) setAgentEnabled(false);
      })
      .finally(() => {
        if (active) setAgentModeLoading(false);
      });

    return () => {
      active = false;
    };
  }, [runtime, sessionId, supportsLocalAgent]);

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
    const canonicalTitle = await readCanonicalSessionTitle(
      miraHostClient,
      sessionId,
    );
    if (canonicalTitle !== null) {
      setSessionTitle(canonicalTitle);
    }
  }, [isLocalProvider, runtime, sessionId]);

  const loadMessages = useCallback(async (): Promise<ChatMessage[] | null> => {
    setHistoryError(null);
    try {
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
  }, [clearThreadRead, markThreadRead, runtime, sessionId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setIsLoadingHistory(true);
      void Promise.all([loadMessages(), refreshSessionTitle()]).finally(() => {
        if (active) setIsLoadingHistory(false);
      });
      return () => {
        active = false;
      };
    }, [loadMessages, refreshSessionTitle]),
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

    if (buildShareSelectionRows(messages).length === 0) {
      Alert.alert('暂无可分享内容', '当前会话还没有可分享的消息。');
      return;
    }

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
      // Filtering the canonical snapshot keeps the conversation order.
      const selectedMessages = messages.filter((message) => selected.has(message.id));
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
    [isSharing, messages, sessionTitle, shareCoordinator],
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

  const toggleAgentMode = useCallback(async () => {
    if (
      !supportsLocalAgent ||
      !runtime.setAgentEnabled ||
      agentModeLoading ||
      isLoading
    ) {
      return;
    }
    const next = !agentEnabled;
    setAgentModeLoading(true);
    try {
      await runtime.setAgentEnabled(sessionId, next);
      setAgentEnabled(next);
      if (!next) {
        setAgentActivities([]);
        setPendingAgentApproval(null);
        setApprovalAction(null);
        setAgentPhase('idle');
        setAgentPauseReason(null);
        setAgentError(null);
      }
    } catch {
      Alert.alert('Agent 模式', '暂时无法保存 Agent 模式状态，请稍后重试。');
    } finally {
      setAgentModeLoading(false);
    }
  }, [
    agentEnabled,
    agentModeLoading,
    isLoading,
    runtime,
    sessionId,
    supportsLocalAgent,
  ]);

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
          setStreamingText('');
          break;
        case 'agent-reset':
          setAgentActivities([]);
          setPendingAgentApproval(null);
          setApprovalAction(null);
          setAgentPauseReason(null);
          setAgentError(null);
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
            agentEnabled: input.agentEnabled,
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
        isLoading ||
        (supportsLocalAgent && agentModeLoading)
      ) {
        return;
      }

      const useLocalAgent = supportsLocalAgent && agentEnabled;
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

      await runTurn(content, userMsg.id, userMsg.timestamp.getTime(), useLocalAgent);
    },
    [
      agentEnabled,
      agentModeLoading,
      inputText,
      isLoading,
      runTurn,
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

  const openMenu = useCallback(() => {
    menuButtonRef.current?.measureInWindow((x, y, width, height) => {
      setMenuAnchor({
        top: y + height + spacing.xs,
        right: Math.max(spacing.sm, windowWidth - x - width),
      });
      setIsMenuVisible(true);
    });
  }, [windowWidth]);

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
              <MessageAttachments threadId={sessionId} parts={item.parts} />
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
              ? `${providerName || 'Local Provider'}${providerModel ? ` · ${providerModel}` : ''}`
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
        onFindInChat={openSearch}
      />

      <ShareMessageSelector
        visible={isShareSelecting}
        messages={messages}
        busy={isSharing}
        onCancel={() => setIsShareSelecting(false)}
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
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
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

        {supportsLocalAgent ? (
          <View style={styles.agentModeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                agentEnabled ? '关闭本地 Agent 模式' : '开启本地 Agent 模式'
              }
              disabled={agentModeLoading || isLoading}
              onPress={() => void toggleAgentMode()}
              style={({ pressed }) => [
                styles.agentModeButton,
                {
                  backgroundColor: agentEnabled
                    ? colors.bg.soft
                    : colors.bg.card,
                  borderColor: agentEnabled
                    ? colors.primary
                    : colors.border.default,
                },
                pressed && { opacity: 0.72 },
                (agentModeLoading || isLoading) && { opacity: 0.5 },
              ]}
            >
              <Bot
                size={16}
                color={agentEnabled ? colors.primary : colors.text.muted}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.agentModeText,
                  {
                    color: agentEnabled
                      ? colors.text.ink
                      : colors.text.muted,
                  },
                ]}
              >
                {agentModeLoading
                  ? 'Agent…'
                  : agentEnabled
                    ? 'Agent 已开启'
                    : 'Agent'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.inputBar,
            {
              borderTopColor: colors.border.soft,
              backgroundColor: colors.bg.canvas,
            },
          ]}
        >
          <View
            style={[
              styles.inputWrapper,
              {
                backgroundColor: colors.bg.input,
                borderColor: colors.border.default,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: colors.text.ink }]}
              value={inputText}
              onChangeText={setInputText}
              placeholder="给 Mira 发消息..."
              placeholderTextColor={colors.text.placeholder}
              multiline
              maxLength={500}
              editable={
                !isLoading && !(supportsLocalAgent && agentModeLoading)
              }
              blurOnSubmit={false}
              onSubmitEditing={() => void sendMessage()}
            />
            {isLoading ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="停止生成"
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: pressed
                      ? colors.primaryActive
                      : colors.text.ink,
                  },
                ]}
                onPress={handleStop}
              >
                <Square
                  size={16}
                  color={colors.bg.elevated}
                  fill={colors.bg.elevated}
                />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="发送消息"
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: pressed
                      ? colors.primaryActive
                      : colors.primary,
                  },
                  (!inputText.trim() ||
                    (supportsLocalAgent && agentModeLoading)) && {
                    backgroundColor: colors.primaryDisabled,
                  },
                ]}
                onPress={() => void sendMessage()}
                disabled={
                  !inputText.trim() ||
                  (supportsLocalAgent && agentModeLoading)
                }
              >
                <Send size={18} color={colors.onPrimary} strokeWidth={2.5} />
              </Pressable>
            )}
          </View>
        </View>
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
  agentModeRow: {
    paddingHorizontal: 14,
    paddingBottom: spacing.xs,
    alignItems: 'flex-start',
  },
  agentModeButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
  },
  agentModeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  inputBar: {
    paddingHorizontal: 14,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputWrapper: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingLeft: 14,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderRadius: 24,
    ...shadows.composer,
  },
  input: {
    flex: 1,
    minHeight: sizing.touchTarget,
    maxHeight: 100,
    paddingHorizontal: 0,
    paddingVertical: 10,
    fontSize: fontSize.md,
    lineHeight: 22,
  },
  sendBtn: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: sizing.touchTarget / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});