import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import {
  ArrowUp,
  Camera,
  Check,
  File,
  Gauge,
  Image as ImageIcon,
  Layers,
  Plus,
  Square,
} from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { fontSize, radius, shadows, sizing, spacing } from '../theme/tokens';
import {
  AGENT_EXECUTION_STRENGTHS,
  type AgentExecutionStrengthId,
} from '../settings/agentExecutionStrength';
import type { LocalProviderModelOption } from '../runtime/localProviderModelSelection';

type Popup = 'attachments' | 'strength' | 'models';
interface Props {
  children?: ReactNode;
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  editable: boolean;
  running: boolean;
  onSend: () => void;
  onStop: () => void;
  strength?: AgentExecutionStrengthId;
  followsGlobal: boolean;
  strengthReady: boolean;
  models?: readonly LocalProviderModelOption[];
  modelsReady: boolean;
  busy: boolean;
  error: string | null;
  onRefresh: () => void;
  onStrength: (strength: AgentExecutionStrengthId | null) => void;
  onModel: (providerId: string) => void;
}
const attachments = [
  { label: '图片', Icon: ImageIcon },
  { label: '拍照', Icon: Camera },
  { label: '文件', Icon: File },
];

export function ChatComposer(props: Props) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [popup, setPopup] = useState<Popup | null>(null);
  // A native IME may dismiss itself while a toolbar menu is open. Keep the
  // strength anchor visible until the menu is explicitly dismissed.
  const expanded = focused || popup === 'strength';
  const [composerHeight, setComposerHeight] = useState(60);
  const [availableHeight, setAvailableHeight] = useState(400);
  const [preview, setPreview] = useState<number | null>(null);
  const input = useRef<TextInput>(null);
  const selected = props.models?.find(option => option.selected);
  const strengthIndex = Math.max(
    0,
    AGENT_EXECUTION_STRENGTHS.findIndex(item => item.id === props.strength),
  );
  const currentStrength = AGENT_EXECUTION_STRENGTHS[preview ?? strengthIndex];
  const disabled = props.running || props.busy;
  const sendDisabled = !props.editable || props.busy || !props.value.trim();
  const close = () => {
    setPopup(null);
    setPreview(null);
  };
  useEffect(() => {
    const listener = Keyboard.addListener('keyboardDidHide', () => {
      input.current?.blur();
      // Keyboard visibility is not a popup dismissal action.
      setFocused(false);
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!popup) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setPopup(null);
      setPreview(null);
      return true;
    });
    return () => listener.remove();
  }, [popup]);
  useEffect(() => {
    if (props.running) {
      setPopup(null);
      setPreview(null);
    }
  }, [props.running]);
  const open = (next: Popup) => {
    if (popup === next) {
      close();
      return;
    }
    setPreview(null);
    setPopup(next);
    if (next !== 'attachments') props.onRefresh();
  };
  const control = (
    label: string,
    icon: ReactNode,
    action: () => void,
    unavailable = false,
    active = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: unavailable, expanded: active }}
      disabled={unavailable}
      onPress={action}
      style={({ pressed }) => [
        styles.control,
        (pressed || active) && { backgroundColor: colors.bg.soft },
        unavailable && styles.dim,
      ]}
    >
      {icon}
    </Pressable>
  );
  const menuRow = (
    label: string,
    onPress: () => void,
    icon?: ReactNode,
    inactive = false,
    detail?: string,
    checked?: boolean,
    key?: string,
    hint?: string,
  ) => (
    <Pressable
      key={key ?? label}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}，${detail}` : label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: inactive, selected: checked }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        pressed && { backgroundColor: colors.bg.soft },
        inactive && styles.dim,
      ]}
    >
      {icon}
      <View style={styles.rowText}>
        <Text style={[styles.menuText, { color: colors.text.ink }]}>
          {label}
        </Text>
        {detail ? (
          <Text style={[styles.detail, { color: colors.text.muted }]}>
            {detail}
          </Text>
        ) : null}
      </View>
      {checked ? <Check size={18} color={colors.primary} /> : null}
    </Pressable>
  );
  return (
    <View
      style={styles.root}
      onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}
    >
      <View
        style={styles.root}
        importantForAccessibility={popup ? 'no-hide-descendants' : 'auto'}
      >
        {props.children}
      </View>
      <View
        testID="composer-container"
        importantForAccessibility={popup ? 'no-hide-descendants' : 'auto'}
        onLayout={event => setComposerHeight(event.nativeEvent.layout.height)}
        style={[styles.bar, { backgroundColor: colors.bg.canvas }]}
      >
        <View
          testID={expanded ? 'composer-expanded' : 'composer-compact'}
          style={[
            styles.shell,
            expanded ? styles.expanded : styles.compact,
            {
              backgroundColor: colors.bg.input,
              borderColor: colors.border.default,
            },
          ]}
        >
          <TextInput
            ref={input}
            testID="composer-input"
            accessibilityLabel="消息输入框"
            value={props.value}
            onChangeText={props.onChangeText}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder}
            placeholderTextColor={colors.text.placeholder}
            editable={props.editable}
            multiline
            maxLength={500}
            submitBehavior="newline"
            style={[
              styles.input,
              expanded ? styles.inputExpanded : styles.inputCompact,
              { color: colors.text.ink },
            ]}
          />
          <View style={styles.actions}>
            {expanded && props.strength !== undefined
              ? control(
                  `执行强度：${
                    props.strengthReady
                      ? AGENT_EXECUTION_STRENGTHS[strengthIndex].label
                      : '未读取'
                  }`,
                  <Gauge
                    size={22}
                    color={
                      props.strength !== 'plain' && props.strengthReady
                        ? colors.primary
                        : colors.text.muted
                    }
                  />,
                  () => open('strength'),
                  disabled,
                  popup === 'strength',
                )
              : null}
            {props.models !== undefined
              ? control(
                  `选择模型：${selected?.model ?? '未选择'}`,
                  <Layers size={21} color={colors.text.ink} />,
                  () => open('models'),
                  disabled,
                  popup === 'models',
                )
              : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.running ? '停止生成' : '发送消息'}
              accessibilityState={{ disabled: !props.running && sendDisabled }}
              disabled={!props.running && sendDisabled}
              onPress={props.running ? props.onStop : props.onSend}
              style={styles.control}
            >
              {({ pressed }) => (
                <View
                  testID="composer-send-face"
                  pointerEvents="none"
                  style={[
                    styles.sendFace,
                    {
                      backgroundColor: props.running
                        ? colors.text.ink
                        : sendDisabled
                        ? colors.primaryDisabled
                        : pressed
                        ? colors.primaryActive
                        : colors.primary,
                    },
                  ]}
                >
                  {props.running ? (
                    <Square
                      size={13}
                      color={colors.bg.elevated}
                      fill={colors.bg.elevated}
                    />
                  ) : (
                    <ArrowUp
                      size={20}
                      strokeWidth={2.2}
                      color={colors.onPrimary}
                    />
                  )}
                </View>
              )}
            </Pressable>
          </View>
          <View style={styles.plus}>
            {control(
              '添加附件',
              <Plus size={23} color={colors.text.ink} />,
              () => open('attachments'),
              false,
              popup === 'attachments',
            )}
          </View>
        </View>
      </View>
      {popup ? (
        <View style={styles.overlay} accessibilityViewIsModal>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="关闭输入框菜单"
            onPress={close}
          />
          <View
            testID={`composer-popup-${popup}`}
            style={[
              styles.popup,
              popup === 'attachments'
                ? styles.leftPopup
                : popup === 'models'
                ? styles.modelPopup
                : styles.rightPopup,
              {
                bottom: composerHeight + spacing.xs,
                maxHeight: Math.max(
                  sizing.touchTarget,
                  availableHeight - composerHeight - spacing.sm,
                ),
                backgroundColor: colors.bg.card,
                borderColor: colors.border.default,
              },
            ]}
          >
            <ScrollView keyboardShouldPersistTaps="always" bounces={false}>
              {popup === 'attachments'
                ? attachments.map(({ label, Icon }) =>
                    menuRow(
                      label,
                      close,
                      <Icon size={21} color={colors.text.ink} />,
                      false,
                      undefined,
                      undefined,
                      undefined,
                      '仅入口预览，尚未接入附件功能',
                    ),
                  )
                : null}
              {popup === 'strength' ? (
                <View style={styles.strengthContent}>
                  <Text style={[styles.menuText, { color: colors.text.ink }]}>
                    强度：
                    {props.strengthReady ? currentStrength.label : '未读取'}
                  </Text>
                  <Slider
                    testID="composer-strength-slider"
                    accessibilityLabel="线程执行强度"
                    accessibilityValue={{ text: currentStrength.label }}
                    minimumValue={0}
                    maximumValue={4}
                    step={1}
                    value={preview ?? strengthIndex}
                    disabled={disabled || !props.strengthReady}
                    minimumTrackTintColor={colors.primary}
                    maximumTrackTintColor={colors.border.default}
                    thumbTintColor={colors.primary}
                    onValueChange={value =>
                      setPreview(Math.max(0, Math.min(4, Math.round(value))))
                    }
                    onSlidingComplete={value => {
                      setPreview(null);
                      if (!disabled && props.strengthReady)
                        props.onStrength(
                          AGENT_EXECUTION_STRENGTHS[
                            Math.max(0, Math.min(4, Math.round(value)))
                          ].id,
                        );
                    }}
                  />
                  <View style={styles.ticks}>
                    {AGENT_EXECUTION_STRENGTHS.map(item => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={item.label}
                        accessibilityState={{
                          selected: currentStrength.id === item.id,
                          disabled: disabled || !props.strengthReady,
                        }}
                        disabled={disabled || !props.strengthReady}
                        onPress={() => props.onStrength(item.id)}
                        style={styles.tick}
                      >
                        <Text
                          style={[
                            styles.tickText,
                            {
                              color:
                                currentStrength.id === item.id
                                  ? colors.primary
                                  : colors.text.muted,
                            },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {menuRow(
                    '跟随全局',
                    () => props.onStrength(null),
                    undefined,
                    disabled || !props.strengthReady,
                    undefined,
                    props.strengthReady && props.followsGlobal,
                  )}
                </View>
              ) : null}
              {popup === 'models' ? (
                props.models?.length ? (
                  props.models.map(option =>
                    menuRow(
                      option.model,
                      () => props.onModel(option.providerId),
                      undefined,
                      disabled || !props.modelsReady,
                      [option.providerName, option.providerHost]
                        .filter(Boolean)
                        .join(' · '),
                      option.selected,
                      option.providerId,
                    ),
                  )
                ) : (
                  <Text style={[styles.empty, { color: colors.text.muted }]}>
                    {props.busy
                      ? '正在读取模型…'
                      : props.modelsReady
                      ? '暂无已配置模型'
                      : '无法读取模型'}
                  </Text>
                )
              ) : null}
              {popup !== 'attachments' && props.error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.empty, { color: colors.status.error }]}
                >
                  {props.error}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  shell: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.xs,
    ...shadows.composer,
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.full,
  },
  expanded: { borderRadius: radius.xl },
  input: {
    minHeight: sizing.touchTarget,
    fontSize: fontSize.md,
    lineHeight: 22,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  inputCompact: {
    flex: 1,
    minWidth: 0,
    maxHeight: sizing.touchTarget,
    marginLeft: sizing.touchTarget,
  },
  inputExpanded: { maxHeight: 112 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    minHeight: sizing.touchTarget,
  },
  plus: { position: 'absolute', bottom: spacing.xs, left: spacing.xs },
  control: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The visible CTA is smaller than its accessible touch area.
  sendFace: {
    width: spacing.section,
    height: spacing.section,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.45 },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 20 },
  popup: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    ...shadows.composer,
  },
  leftPopup: { left: spacing.md, width: 168 },
  rightPopup: { right: spacing.md, left: spacing.md },
  modelPopup: { right: spacing.md, width: 292, maxWidth: '92%' },
  menuRow: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  rowText: { flex: 1, minWidth: 0 },
  menuText: { fontSize: fontSize.bodyMd, fontWeight: '500' },
  detail: { fontSize: fontSize.caption, marginTop: spacing.xs },
  empty: { padding: spacing.md, fontSize: fontSize.caption },
  strengthContent: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  ticks: { flexDirection: 'row', justifyContent: 'space-between' },
  tick: {
    flex: 1,
    minHeight: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickText: { fontSize: fontSize.xs },
});
