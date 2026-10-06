import React from 'react';
import { Check, ChevronDown } from 'lucide-react-native';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, sizing, spacing } from '../theme/tokens';
import { ConnectionStatusDot, type ConnectionVisualStatus } from './ConnectionStatusDot';

export interface ConnectionSourceOption<T extends string> {
  value: T;
  label: string;
  description: string;
  status: ConnectionVisualStatus;
  disabled?: boolean;
}

interface ConnectionSourceDropdownProps<T extends string> {
  value: T;
  options: readonly ConnectionSourceOption<T>[];
  onChange: (value: T) => void;
}

const visualStatusForOption = <T extends string>(
  option: ConnectionSourceOption<T>,
): ConnectionVisualStatus => (option.disabled ? 'not-configured' : option.status);

export function ConnectionSourceDropdown<T extends string>({ value, options, onChange }: ConnectionSourceDropdownProps<T>) {
  const { colors } = useTheme();
  const [visible, setVisible] = React.useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="选择连接来源"
        accessibilityState={{ expanded: visible }}
        onPress={() => setVisible(true)}
        style={({ pressed }) => [styles.trigger, pressed && { backgroundColor: colors.bg.soft }]}
      >
        <Text
          style={[
            styles.title,
            { color: selected?.disabled ? colors.text.muted : colors.text.ink },
          ]}
          numberOfLines={1}
        >
          {selected?.label ?? '连接'}
        </Text>
        <ChevronDown size={16} color={colors.text.soft} />
        {selected ? <ConnectionStatusDot status={visualStatusForOption(selected)} /> : null}
      </Pressable>

      <Modal transparent animationType="fade" visible={visible} onRequestClose={() => setVisible(false)}>
        <View style={styles.root}>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭连接来源选择" style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} onPress={() => setVisible(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.bg.canvas }]}>
            <View style={[styles.handle, { backgroundColor: colors.border.default }]} />
            <Text style={[styles.sheetTitle, { color: colors.text.ink }]}>连接</Text>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected, disabled: option.disabled }}
                  disabled={option.disabled}
                  onPress={() => {
                    onChange(option.value);
                    setVisible(false);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    { borderBottomColor: colors.border.soft },
                    (isSelected || pressed) && !option.disabled && { backgroundColor: colors.bg.soft },
                    option.disabled && styles.disabledOption,
                  ]}
                >
                  <ConnectionStatusDot status={visualStatusForOption(option)} size={10} />
                  <View style={styles.optionText}>
                    <Text
                      style={[
                        styles.optionLabel,
                        { color: option.disabled ? colors.text.muted : colors.text.ink },
                      ]}
                    >
                      {option.label}
                    </Text>
                    <Text style={[styles.optionDescription, { color: colors.text.soft }]}>{option.description}</Text>
                  </View>
                  {isSelected ? (
                    <Check
                      size={20}
                      color={option.disabled ? colors.text.soft : colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: sizing.buttonHeight,
    maxWidth: 230,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  title: { fontSize: fontSize.titleMd, fontWeight: '600', flexShrink: 1 },
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.section, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  handle: { width: 36, height: 4, borderRadius: radius.full, alignSelf: 'center', marginBottom: spacing.lg },
  sheetTitle: { fontSize: fontSize.titleMd, fontWeight: '700', marginBottom: spacing.sm },
  option: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  disabledOption: { opacity: 0.62 },
  optionText: { flex: 1, minWidth: 0, gap: spacing.xs },
  optionLabel: { fontSize: fontSize.bodyMd, fontWeight: '600' },
  optionDescription: { fontSize: fontSize.caption },
});
