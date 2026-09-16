/**
 * Mira Mobile Design Tokens
 *
 * Based on the Mira design system (Claude/Anthropic visual language).
 * Reference: https://tomz.io/design-md/视觉/product-design-system
 *
 * Core principles:
 * - Single brand accent: coral clay (#cc785c), used sparingly.
 * - Warm-toned cream canvas, never pure white or cold gray.
 * - Hierarchy through surface color contrast, not shadows.
 * - Platform text defaults with restrained, explicit tracking.
 */

// ─── Brand & Text ──────────────────────────────────────────
export const colors = {
  /** 唯一品牌强调色 — 按钮 / CTA / 徽标 */
  primary: '#c96442',
  /** 按钮按下态 */
  primaryActive: '#a95034',
  /** 禁用态背景 */
  primaryDisabled: '#e8e6dc',

  // Text color ramp — hierarchy through light/dark, not hue
  text: {
    /** 标题 / 高对比正文 */
    ink: '#141413',
    /** 正文段落 */
    base: '#3d3d3a',
    /** 加粗正文 / 强调句 */
    strong: '#252523',
    /** 次要文字 */
    muted: '#5e5d59',
    /** 占位符 / 三级文字 */
    soft: '#87867f',
    /** deprecated alias — maps to muted */
    secondary: '#5e5d59',
    /** deprecated alias — maps to soft */
    tertiary: '#87867f',
    placeholder: '#87867f',
  },

  // ─── Light Surfaces ─────────────────────────────────────
  // 画布必须是带暖调的米白色
  bg: {
    /** 页面主底色 — 暖调米白 */
    canvas: '#f5f4ed',
    /** alias for canvas (backwards compat) */
    base: '#f5f4ed',
    /** 轻微区隔的分区底色 */
    soft: '#e8e6dc',
    /** 卡片背景（比画布更深一级） */
    card: '#faf9f5',
    /** 强调型米色区块 */
    creamStrong: '#e8e6dc',
    /** 输入框底色 */
    input: '#faf9f5',
    /** AI 消息气泡 */
    bubble: '#e8e6dc',
    /** deprecated alias */
    subtle: '#e8e6dc',
  },

  // ─── Dark Surfaces ──────────────────────────────────────
  // 深色只用于页脚、少数 CTA、产品截图模块，不作为页面主基调
  dark: {
    /** 深色板块底色 / 页脚 */
    surface: '#181715',
    /** 深色内嵌卡片 / 状态栏 */
    elevated: '#252320',
    /** 深色次级分区 */
    soft: '#1f1e1b',
    /** 深色背景上的主文字 */
    onDark: '#faf9f5',
    /** 深色背景上的次要文字 */
    onDarkSoft: '#a09d96',
  },

  /** 珊瑚色按钮上的文字 */
  onPrimary: '#faf9f5',

  // ─── Borders ────────────────────────────────────────────
  border: {
    /** 卡片细边框 */
    default: '#e8e6dc',
    /** 更轻的分隔线 */
    soft: '#f0eee6',
    /** deprecated alias */
    light: '#f0eee6',
  },

  // ─── Accents & Status ───────────────────────────────────
  accent: {
    /** 代码高亮 / 图表点缀 */
    teal: '#5db8a6',
    /** 代码高亮 / 图表点缀 */
    amber: '#e8a55a',
  },

  status: {
    /** 成功状态 */
    success: '#5db872',
    /** 警告状态 */
    warning: '#d4a017',
    /** 错误状态 */
    error: '#c64545',
    /** 错误状态浅色背景（失败气泡 / 按下态） */
    errorBg: '#fce8e8',
  },

  // ─── Deprecated aliases (backwards compat) ─────────────
  primaryDark: '#a95034',
  success: '#5db872',
  warning: '#d4a017',
  danger: '#c64545',
  dangerLight: '#e8a55a',
  muted: '#5e5d59',

  hint: {
    bg: '#e8e6dc',
    text: '#a95034',
  },

  banner: {
    bg: '#e8e6dc',
    text: '#5e5d59',
  },
} as const;

// ─── Radius ────────────────────────────────────────────────
export const radius = {
  /** 按钮圆角 */
  sm: 8,
  /** 卡片圆角 */
  md: 12,
  /** 大卡片圆角 */
  lg: 16,
  /** 更大圆角 */
  xl: 20,
  /** 全圆角 (pill / 徽标 / 标签) */
  full: 9999,
} as const;

// ─── Spacing ───────────────────────────────────────────────
// 遵循设计系统的间距代币
export const spacing = {
  /** 4px — 图标与文字的紧凑间距 */
  xs: 4,
  /** 8px — 控件内部间距 */
  sm: 8,
  /** 12px — 标准组件间距 */
  md: 12,
  /** 16px — 页面与消息间距 */
  lg: 16,
  /** 24px — 大模块间距 */
  xl: 24,
  /** 32px — 页面分区间距 */
  section: 32,
} as const;

// ─── Typography ────────────────────────────────────────────
export const fontSize = {
  /** 展示级 — 64px */
  displayLg: 64,
  /** 区块标题 — 40px */
  displaySm: 40,
  /** 卡片大标题 — 28px */
  titleXl: 28,
  /** 卡片标题 — 20px */
  titleLg: 20,
  /** 组件标题 — 17px */
  titleMd: 17,
  /** 正文段落 — 16px */
  bodyMd: 16,
  /** 导航链接 / 按钮文字 — 14px */
  button: 14,
  /** 小号标签 — 13px */
  caption: 13,
  /** 大写标签 — 12px */
  captionUppercase: 12,
  /** 代码块 — 13px */
  code: 13,

  // Backwards-compatible aliases
  xs: 12,
  sm: 13,
  base: 14,
  md: 15,
  lg: 16,
  xl: 17,
  '2xl': 18,
  '3xl': 20,
  '4xl': 28,
} as const;

export const lineHeight = {
  /** 正文段落行高 */
  body: 1.6,
  /** 标题行高 */
  title: 1.3,
  /** 紧凑行高 */
  tight: 1.2,
} as const;

export const letterSpacing = {
  /** display-lg */
  displayLg: 0,
  /** display-sm */
  displaySm: 0,
  /** title-xl */
  titleXl: 0,
  /** 大写标签 */
  captionUppercase: 1.5,
  /** 默认 */
  default: 0,
} as const;

// ─── Component Sizing ──────────────────────────────────────
export const sizing = {
  /** 按钮统一高度 */
  buttonHeight: 40,
  /** 圆形图标按钮 */
  iconButton: 44,
  /** 最小触控区域 */
  touchTarget: 44,
} as const;

// ─── Shadows ───────────────────────────────────────────────
// 设计系统哲学：色块优先，阴影罕见
// 浅色卡片 = 细边框 + 大圆角，零阴影
// 深色卡片 = 靠色块对比制造层次，而非投影
export const shadows = {
  // FAB 保留极轻阴影作为浮动元素的最小深度提示
  fab: {
    shadowColor: '#c96442',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  composer: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
} as const;
