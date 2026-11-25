import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Archive,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Search,
  Share2,
  Square,
  Trash2,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, shadows, sizing, spacing } from '../theme/tokens';

type MenuIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

interface ConversationMenuItem {
  id: string;
  label: string;
  icon: MenuIcon;
  destructive?: boolean;
  hasChevron?: boolean;
  addTopSpacing?: boolean;
}

// Only entries with a real action live here. "已上传文件" and "添加到首页" were
// placeholders without an implementation, so they are gone rather than rendered
// as permanently grey rows.
const menuItems: ConversationMenuItem[] = [
  { id: 'share', label: '分享', icon: Share2 },
  { id: 'project', label: '添加到项目', icon: FolderPlus, hasChevron: true },
  { id: 'search', label: '在聊天中查找', icon: Search },
  { id: 'archive', label: '归档', icon: Archive },
  {
    id: 'delete',
    label: '删除',
    icon: Trash2,
    destructive: true,
    addTopSpacing: true,
  },
];

interface ConversationMenuProps {
  visible: boolean;
  title: string;
  anchor: {
    top: number;
    right: number;
  };
  onClose: () => void;
  onShare?: () => void;
  shareDisabled?: boolean;
  shareDisabledAccessibilityLabel?: string;
  /** Only present when Mobile has a real Desktop thread binding to show. */
  onViewWorkspace?: () => void;
  viewWorkspaceDisabled?: boolean;
  viewWorkspaceDisabledAccessibilityLabel?: string;
  /** Explicit end; never invoked by turn completion, backgrounding or app close. */
  onEndThread?: () => void;
  endThreadDisabled?: boolean;
  endThreadDisabledAccessibilityLabel?: string;
  endThreadLabel?: string;
  onFindInChat?: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleteDisabledAccessibilityLabel?: string;
  onAddToProject?: () => void;
  projectDisabled?: boolean;
  projectDisabledAccessibilityLabel?: string;
}

export function ConversationMenu({
  visible,
  title,
  anchor,
  onClose,
  onShare,
  shareDisabled = false,
  shareDisabledAccessibilityLabel,
  onViewWorkspace,
  viewWorkspaceDisabled = false,
  viewWorkspaceDisabledAccessibilityLabel,
  onEndThread,
  endThreadDisabled = false,
  endThreadDisabledAccessibilityLabel,
  endThreadLabel = '结束远程线程',
  onFindInChat,
  onDelete,
  deleteDisabled = false,
  deleteDisabledAccessibilityLabel,
  onAddToProject,
  projectDisabled = false,
  projectDisabledAccessibilityLabel,
}: ConversationMenuProps) {
  const { colors } = useTheme();
  const items: ConversationMenuItem[] = [
    menuItems[0],
    ...(onViewWorkspace
      ? [{
          id: 'workspace',
          label: '查看远程工作空间',
          icon: FolderOpen,
        } satisfies ConversationMenuItem]
      : []),
    ...(onEndThread
      ? [{
          id: 'end-thread',
          label: endThreadLabel,
          icon: Square,
          destructive: true,
        } satisfies ConversationMenuItem]
      : []),
    ...menuItems.slice(1),
  ];

  const actionForItem = (id: string) => {
    if (id === 'share') return onShare;
    if (id === 'workspace') return onViewWorkspace;
    if (id === 'end-thread') return onEndThread;
    if (id === 'search') return onFindInChat;
    if (id === 'delete') return onDelete;
    if (id === 'project') return onAddToProject;
    return undefined;
  };

  const disabledForItem = (id: string) => {
    if (id === 'share') return shareDisabled;
    if (id === 'workspace') return viewWorkspaceDisabled;
    if (id === 'end-thread') return endThreadDisabled;
    if (id === 'delete') return deleteDisabled;
    if (id === 'project') return projectDisabled;
    return false;
  };

  const disabledLabelForItem = (id: string) => {
    if (id === 'share') return shareDisabledAccessibilityLabel;
    if (id === 'workspace') {
      return viewWorkspaceDisabledAccessibilityLabel;
    }
    if (id === 'end-thread') return endThreadDisabledAccessibilityLabel;
    if (id === 'delete') return deleteDisabledAccessibilityLabel;
    if (id === 'project') return projectDisabledAccessibilityLabel;
    return undefined;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭菜单"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <View
          style={[
            styles.menu,
            {
              top: anchor.top,
              right: anchor.right,
              backgroundColor: colors.bg.card,
              borderColor: colors.border.default,
            },
          ]}
        >
          <Text
            style={[styles.title, { color: colors.text.muted }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {items.map((item) => {
            const action = actionForItem(item.id);
            const disabled = action === undefined || disabledForItem(item.id);
            const itemColor = item.destructive
              ? colors.status.error
              : colors.text.ink;
            const Icon = item.icon;
            const accessibilityLabel = disabled
              ? disabledLabelForItem(item.id) ?? `${item.label}，暂不可用`
              : item.label;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={() => {
                  onClose();
                  action?.();
                }}
                style={({ pressed }) => [
                  styles.item,
                  item.addTopSpacing && styles.itemWithTopSpacing,
                  disabled && styles.disabledItem,
                  pressed && !disabled && { backgroundColor: colors.bg.soft },
                ]}
              >
                <Icon size={20} color={itemColor} strokeWidth={2.2} />
                <Text style={[styles.itemLabel, { color: itemColor }]}>
                  {item.label}
                </Text>
                {item.hasChevron && (
                  <ChevronRight size={18} color={itemColor} strokeWidth={2.2} />
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  menu: {
    position: 'absolute',
    width: 228,
    paddingVertical: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    overflow: 'hidden',
    ...shadows.composer,
  },
  title: {
    height: 36,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
    fontSize: fontSize.button,
    lineHeight: 22,
  },
  item: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  disabledItem: { opacity: 0.45 },
  itemWithTopSpacing: { marginTop: spacing.sm },
  itemLabel: { flex: 1, fontSize: fontSize.bodyMd, lineHeight: 22 },
});
