import React from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';

export interface SettingsChoice<T extends string> {
  value: T;
  label: string;
  swatch?: string;
  description?: string;
  accessibilityLabel?: string;
}

interface SettingsChoiceModalProps<T extends string> {
  visible: boolean;
  value: T;
  options: readonly SettingsChoice<T>[];
  onChange: (value: T) => void;
  onClose: () => void;
  withinModal?: boolean;
  title?: string;
}

export function SettingsChoiceModal<T extends string>({
  visible, value, options, onChange, onClose, withinModal = false, title,
}: SettingsChoiceModalProps<T>) {
  const { colors } = useTheme();
  const [mounted, setMounted] = React.useState(visible);
  const progress = React.useRef(new Animated.Value(visible ? 1 : 0)).current;

  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [progress, visible]);

  const requestClose = React.useCallback(() => {
    onClose();
  }, [onClose]);

  const menuStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [10, 0],
        }),
      },
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.98, 1],
        }),
      },
    ],
  };

  if (!mounted) {
    return null;
  }

  const body = (
    <Pressable
      style={[styles.backdrop, withinModal && styles.drawerBackdrop]}
      onPress={requestClose}
    >
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.backdropOverlay,
            { backgroundColor: colors.overlay, opacity: progress },
            withinModal && styles.drawerOverlay,
          ]}
        />
        <Animated.View
          style={[styles.menu, withinModal && styles.drawerMenu, { backgroundColor: colors.bg.elevated }, menuStyle]}
          onStartShouldSetResponder={() => true}
        >
          {title ? (
            <Text style={[styles.menuTitle, { color: colors.text.muted }]}>{title}</Text>
          ) : null}
          {/* Descriptions wrap, so the list can outgrow a short screen (landscape
              or the 大 text scale). Scroll instead of clipping the last option. */}
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {options.map((option) => (
              <Pressable
                key={option.value}
                style={({ pressed }) => [
                  styles.option,
                  withinModal && styles.drawerOption,
                  withinModal && option.value === value && { backgroundColor: colors.bg.soft },
                  pressed && { backgroundColor: colors.bg.soft },
                ]}
                onPress={() => {
                  onChange(option.value);
                  onClose();
                }}
                accessibilityRole="radio"
                accessibilityLabel={option.accessibilityLabel ?? option.label}
                accessibilityState={{ checked: option.value === value }}
              >
                {option.swatch ? <View style={[styles.swatch, { backgroundColor: option.swatch }]} /> : null}
                {option.description ? (
                  <View style={styles.optionCopy}>
                    <Text style={[styles.drawerLabel, { color: colors.text.ink }]}>
                      {option.label}
                    </Text>
                    <Text style={[styles.description, { color: colors.text.muted }]}>
                      {option.description}
                    </Text>
                  </View>
                ) : (
                  <Text style={[styles.label, { color: colors.text.ink }]}>{option.label}</Text>
                )}
                {option.value === value ? <Check size={20} color={withinModal ? colors.primary : colors.text.ink} /> : <View style={styles.checkSpace} />}
              </Pressable>
            ))}
          </ScrollView>
        </Animated.View>
    </Pressable>
  );
  // The Drawer already lives inside a native Modal. A second iOS modal can
  // fail to present or block input; render the same choice content in place.
  return withinModal
    ? <View style={styles.withinModal}>{body}</View>
    : <Modal visible={mounted} transparent animationType="none" onRequestClose={requestClose}>{body}</Modal>;
}

const styles = StyleSheet.create({
  withinModal: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20 },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  // A picker already inside the Drawer belongs beside its bottom CTA,
  // not in a second centered modal narrowed by the drawer's own width.
  drawerBackdrop: {
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingBottom: 88,
  },
  backdropOverlay: {
    opacity: 0,
  },
  drawerOverlay: { backgroundColor: 'rgba(20,20,19,0.22)' },
  menu: {
    width: '78%',
    maxWidth: 320,
    maxHeight: '80%',
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  drawerMenu: {
    width: '100%',
    maxWidth: '100%',
    maxHeight: '100%',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  menuTitle: {
    fontSize: fontSize.caption,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  drawerOption: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  swatch: { width: 12, height: 12, borderRadius: radius.full },
  optionCopy: { flex: 1, minWidth: 0 },
  label: { flex: 1, fontSize: fontSize.bodyMd },
  drawerLabel: { fontSize: fontSize.bodyMd },
  description: { fontSize: fontSize.caption, marginTop: 2 },
  checkSpace: { width: 20 },
});
