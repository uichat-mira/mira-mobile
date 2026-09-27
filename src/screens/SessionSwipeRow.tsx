import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Pin, Trash2 } from 'lucide-react-native';
import type { Session } from '../types';
import { getSessionVisualKindLabel, SessionKindIcon } from '../components/SessionKindIcon';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';
import { resolveSessionSwipeOpen } from './sessionSwipe';

const SWIPE_ACTION_WIDTH = 64;
const SWIPE_ACTION_GAP = spacing.xs;
const SWIPE_ACTION_INSET = spacing.xs;

interface SessionSwipeRowProps {
  item: Session;
  roleName: string | null;
  connectionStatus: string;
  colors: ReturnType<typeof useTheme>['colors'];
  isPinned: boolean;
  isUnread: boolean;
  canDelete: boolean;
  isOpen: boolean;
  onSwipeStateChange: (open: boolean) => void;
  onOpen: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export function SessionSwipeRow({
  item,
  roleName,
  connectionStatus,
  colors,
  isPinned,
  isUnread,
  canDelete,
  isOpen,
  onSwipeStateChange,
  onOpen,
  onTogglePin,
  onDelete,
}: SessionSwipeRowProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const isOpenRef = useRef(false);
  const onSwipeStateChangeRef = useRef(onSwipeStateChange);
  const [rowWidth, setRowWidth] = useState(0);
  const actionCount = canDelete ? 2 : 1;
  const actionsWidth =
    SWIPE_ACTION_INSET +
    SWIPE_ACTION_WIDTH * actionCount +
    SWIPE_ACTION_GAP * Math.max(0, actionCount - 1);
  const belongsToWorkspace =
    typeof item.workspaceId === 'string' && item.workspaceId.trim().length > 0;
  const preview = belongsToWorkspace
    ? `项目会话${roleName ? ` · ${roleName}` : ''}`
    : roleName
      ? `角色 · ${roleName}`
      : item.source === 'local-provider'
        ? `本地 Provider${item.providerModel ? ` · ${item.providerModel}` : ''}`
        : connectionStatus === 'connected'
        ? '继续与 Mira 对话'
        : '连接 Mira Host 后继续对话';

  useEffect(() => {
    onSwipeStateChangeRef.current = onSwipeStateChange;
  }, [onSwipeStateChange]);

  const settle = useCallback(
    (open: boolean, animated = true, notify = true) => {
      const changed = isOpenRef.current !== open;
      isOpenRef.current = open;
      scrollRef.current?.scrollTo({
        x: open ? actionsWidth : 0,
        y: 0,
        animated,
      });
      if (notify && changed) onSwipeStateChangeRef.current(open);
    },
    [actionsWidth],
  );

  useEffect(() => {
    if (isOpen !== isOpenRef.current) {
      settle(isOpen, true, false);
    }
  }, [isOpen, settle]);

  useEffect(() => {
    settle(isOpenRef.current, false, false);
  }, [actionsWidth, settle]);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const width = event.nativeEvent.layout.width;
      if (width !== rowWidth) setRowWidth(width);
      settle(isOpenRef.current, false, false);
    },
    [rowWidth, settle],
  );

  const handleScrollSettled = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const open = resolveSessionSwipeOpen(
        isOpenRef.current,
        event.nativeEvent.contentOffset.x,
        actionsWidth,
      );
      settle(open);
    },
    [actionsWidth, settle],
  );

  const handleOpen = useCallback(() => {
    if (isOpenRef.current) {
      settle(false);
      return;
    }
    onOpen();
  }, [onOpen, settle]);

  const handleTogglePin = useCallback(() => {
    settle(false);
    onTogglePin();
  }, [onTogglePin, settle]);

  const handleDelete = useCallback(() => {
    settle(false);
    onDelete();
  }, [onDelete, settle]);

  return (
    <View
      onLayout={handleLayout}
      style={[styles.swipeRow, { borderColor: colors.border.soft }]}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        bounces={false}
        directionalLockEnabled
        nestedScrollEnabled
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: 0 }}
        onScrollEndDrag={handleScrollSettled}
        onMomentumScrollEnd={handleScrollSettled}
        style={styles.swipeScroller}
        contentContainerStyle={styles.swipeContent}
      >
        <View
          style={[
            styles.sessionItem,
            {
              backgroundColor: colors.bg.canvas,
              width: rowWidth || undefined,
            },
          ]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${getSessionVisualKindLabel(item)}：${item.title}${roleName ? `，角色${roleName}` : ''}${belongsToWorkspace ? '，项目会话' : ''}${isPinned ? '，已在本机置顶' : ''}${isUnread ? '，未读' : ''}`}
            style={({ pressed }) => [
              styles.sessionOpen,
              pressed && { backgroundColor: colors.bg.soft },
            ]}
            onPress={handleOpen}
          >
            <View
              style={[
                styles.avatar,
                {
                  backgroundColor: colors.bg.card,
                  borderColor: colors.border.default,
                },
              ]}
            >
              <SessionKindIcon
                session={item}
                size={22}
                strokeWidth={1.7}
                color={colors.primary}
              />
            </View>
            <View style={styles.sessionContent}>
              <View style={styles.sessionTopRow}>
                <View style={styles.sessionTitleGroup}>
                  {isUnread ? (
                    <View
                      accessibilityElementsHidden
                      style={[styles.unreadDot, { backgroundColor: colors.primary }]}
                    />
                  ) : null}
                  <Text
                    style={[styles.sessionTitle, { color: colors.text.ink }]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                  {isPinned ? (
                    <Pin
                      accessibilityElementsHidden
                      size={14}
                      strokeWidth={1.7}
                      color={colors.text.soft}
                    />
                  ) : null}
                </View>
                <Text style={[styles.sessionTime, { color: colors.text.soft }]}>
                  {formatTime(item.updatedAt)}
                </Text>
              </View>
              <Text
                style={[styles.sessionPreview, { color: colors.text.muted }]}
                numberOfLines={1}
              >
                {preview}
              </Text>
            </View>
          </Pressable>
        </View>

        <View
          accessibilityElementsHidden={!isOpen}
          importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
          style={[styles.swipeActions, { width: actionsWidth }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPinned ? `取消置顶：${item.title}` : `置顶：${item.title}`}
            accessibilityState={{ selected: isPinned }}
            onPress={handleTogglePin}
            style={({ pressed }) => [
              styles.swipeAction,
              { backgroundColor: pressed ? colors.primaryActive : colors.primary },
            ]}
          >
            <Pin size={16} color={colors.onPrimary} strokeWidth={2} />
            <Text style={[styles.swipeActionLabel, { color: colors.onPrimary }]}>
              {isPinned ? '取消置顶' : '置顶'}
            </Text>
          </Pressable>
          {canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`删除：${item.title}`}
              onPress={handleDelete}
              style={({ pressed }) => [
                styles.swipeAction,
                { backgroundColor: colors.status.error },
                pressed && { opacity: 0.82 },
              ]}
            >
              <Trash2 size={16} color={colors.onPrimary} strokeWidth={2} />
              <Text style={[styles.swipeActionLabel, { color: colors.onPrimary }]}>删除</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
}

const styles = StyleSheet.create({
  swipeRow: {
    minHeight: 72,
    overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  swipeScroller: { flexGrow: 0 },
  swipeContent: { alignItems: 'stretch' },
  swipeActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingVertical: spacing.sm,
    paddingLeft: SWIPE_ACTION_INSET,
    gap: SWIPE_ACTION_GAP,
  },
  swipeAction: {
    width: SWIPE_ACTION_WIDTH,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  swipeActionLabel: { fontSize: fontSize.xs, fontWeight: '600' },
  sessionItem: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  sessionOpen: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.md,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sessionContent: { flex: 1, minWidth: 0 },
  sessionTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  sessionTitleGroup: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: spacing.sm,
    gap: spacing.xs,
  },
  sessionTitle: { fontSize: fontSize.bodyMd, fontWeight: '600', flex: 1 },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    flexShrink: 0,
  },
  sessionTime: { fontSize: fontSize.xs },
  sessionPreview: { fontSize: fontSize.button },
});
