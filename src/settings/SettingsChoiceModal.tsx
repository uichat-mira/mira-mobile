import React from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, spacing } from '../theme/tokens';

export interface SettingsChoice<T extends string> {
  value: T;
  label: string;
  swatch?: string;
}

interface SettingsChoiceModalProps<T extends string> {
  visible: boolean;
  value: T;
  options: readonly SettingsChoice<T>[];
  onChange: (value: T) => void;
  onClose: () => void;
}

export function SettingsChoiceModal<T extends string>({ visible, value, options, onChange, onClose }: SettingsChoiceModalProps<T>) {
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

  return (
    <Modal visible={mounted} transparent animationType="none" onRequestClose={requestClose}>
      <Pressable style={styles.backdrop} onPress={requestClose}>
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.backdropOverlay,
            { backgroundColor: colors.overlay, opacity: progress },
          ]}
        />
        <Animated.View
          style={[styles.menu, { backgroundColor: colors.bg.elevated }, menuStyle]}
          onStartShouldSetResponder={() => true}
        >
          {options.map((option) => (
            <Pressable
              key={option.value}
              style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.bg.soft }]}
              onPress={() => {
                onChange(option.value);
                onClose();
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === value }}
            >
              {option.swatch ? <View style={[styles.swatch, { backgroundColor: option.swatch }]} /> : null}
              <Text style={[styles.label, { color: colors.text.ink }]}>{option.label}</Text>
              {option.value === value ? <Check size={20} color={colors.text.ink} /> : <View style={styles.checkSpace} />}
            </Pressable>
          ))}
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  backdropOverlay: {
    opacity: 0,
  },
  menu: {
    width: '78%',
    maxWidth: 320,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    overflow: 'hidden',
  },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  swatch: { width: 12, height: 12, borderRadius: radius.full },
  label: { flex: 1, fontSize: fontSize.bodyMd },
  checkSpace: { width: 20 },
});
