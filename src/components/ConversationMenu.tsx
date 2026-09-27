import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Archive,
  ChevronRight,
  FolderPlus,
  House,
  Paperclip,
  Search,
  Share2,
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

const menuItems: ConversationMenuItem[] = [
  { id: 'share', label: '分享', icon: Share2 },
  { id: 'project', label: '添加到项目', icon: FolderPlus, hasChevron: true },
  { id: 'files', label: '已上传文件', icon: Paperclip },
  { id: 'search', label: '在聊天中查找', icon: Search },
  { id: 'home', label: '添加到首页', icon: House },
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
  onFindInChat?: () => void;
}

export function ConversationMenu({
  visible,
  title,
  anchor,
  onClose,
  onShare,
  shareDisabled = false,
  shareDisabledAccessibilityLabel,
  onFindInChat,
}: ConversationMenuProps) {
  const { colors } = useTheme();

  const actionForItem = (id: string) => {
    if (id === 'share') return onShare;
    if (id === 'search') return onFindInChat;
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
          {menuItems.map((item) => {
            const action = actionForItem(item.id);
            const disabled =
              action === undefined || (item.id === 'share' && shareDisabled);
            const itemColor = item.destructive
              ? colors.status.error
              : colors.text.ink;
            const Icon = item.icon;
            const accessibilityLabel = disabled
              ? item.id === 'share' && shareDisabledAccessibilityLabel
                ? shareDisabledAccessibilityLabel
                : `${item.label}，暂不可用`
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
