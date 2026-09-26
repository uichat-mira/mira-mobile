import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { fontSize, radius, spacing } from '../../theme/tokens';

interface SettingsInputModalProps {
  visible: boolean;
  title: string;
  placeholder?: string;
  confirmLabel: string;
  maxLength?: number;
  /** Pre-fills the input when the modal opens (edit flows). */
  initialValue?: string;
  /** Allows longer multi-line content such as memory text. */
  multiline?: boolean;
  /** Returns a user-facing rejection reason, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}

export function SettingsInputModal({
  visible,
  title,
  placeholder,
  confirmLabel,
  maxLength,
  initialValue,
  multiline = false,
  validate,
  onSubmit,
  onClose,
}: SettingsInputModalProps) {
  const { colors } = useTheme();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const confirmed = text.trim().length > 0;
  // Captured at open time so a parent re-render with a different
  // initialValue never clobbers text the user is already editing.
  const initialTextRef = useRef(initialValue ?? '');
  initialTextRef.current = initialValue ?? '';

  useEffect(() => {
    if (visible) {
      setText(initialTextRef.current);
      setError(null);
    }
  }, [visible]);

  const submit = () => {
    if (!confirmed) return;
    // A rejected value keeps the modal open so the reason stays visible.
    const problem = validate ? validate(text.trim()) : null;
    if (problem) {
      setError(problem);
      return;
    }
    onSubmit(text.trim());
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <Pressable style={[styles.backdrop, { backgroundColor: colors.overlay }]} onPress={onClose}>
          <View
            style={[styles.card, { backgroundColor: colors.bg.elevated }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[styles.title, { color: colors.text.ink }]}>{title}</Text>
            <TextInput
              value={text}
              onChangeText={(value) => {
                setText(value);
                setError(null);
              }}
              placeholder={placeholder}
              placeholderTextColor={colors.text.placeholder}
              maxLength={maxLength}
              autoFocus
              multiline={multiline}
              onSubmitEditing={multiline ? undefined : submit}
              returnKeyType={multiline ? 'default' : 'done'}
              style={[
                styles.input,
                multiline && styles.inputMultiline,
                {
                  backgroundColor: colors.bg.card,
                  color: colors.text.ink,
                  borderColor: colors.border.default,
                },
              ]}
            />
            {error ? (
              <Text style={[styles.error, { color: colors.status.error }]}>{error}</Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: colors.bg.card },
                  pressed && { opacity: 0.7 },
                ]}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="取消"
              >
                <Text style={[styles.buttonLabel, { color: colors.text.muted }]}>取消</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  { backgroundColor: confirmed ? colors.primary : colors.primaryDisabled },
                  pressed && confirmed && { opacity: 0.85 },
                ]}
                onPress={submit}
                disabled={!confirmed}
                accessibilityRole="button"
                accessibilityLabel={confirmLabel}
              >
                <Text
                  style={[styles.buttonLabel, { color: confirmed ? colors.onPrimary : colors.text.muted }]}
                >
                  {confirmLabel}
                </Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '84%',
    maxWidth: 340,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: '700',
    textAlign: 'center',
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.bodyMd,
  },
  inputMultiline: {
    minHeight: 120,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  error: {
    fontSize: fontSize.button,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  button: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: fontSize.button,
    fontWeight: '600',
  },
});
