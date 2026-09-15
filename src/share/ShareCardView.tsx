import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import type { ShareCardModel } from './shareCardModel';

const miraLogo = require('../../assets/branding/mira-logo-square.png');

/** Logical width of the exported share image. */
export const SHARE_CARD_WIDTH = 360;

/**
 * The share card is an exported artifact, not app UI: it always uses the
 * fixed brand palette from the design tokens and never follows the user's
 * runtime theme preset (DESIGN.md keeps the logo canvas fixed as well).
 */
const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_WIDTH,
    backgroundColor: colors.bg.canvas,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  logo: { width: 34, height: 34, borderRadius: radius.md },
  headerText: { flex: 1, minWidth: 0 },
  brandName: { fontSize: fontSize.button, lineHeight: 20, fontWeight: '600', color: colors.text.ink },
  brandTag: { fontSize: fontSize.button, lineHeight: 18, color: colors.text.soft },
  date: { fontSize: fontSize.button, lineHeight: 18, color: colors.text.soft },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: spacing.lg, backgroundColor: 'rgba(20,20,19,0.10)' },
  title: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    fontSize: fontSize.titleMd,
    lineHeight: 22,
    fontWeight: '700',
    color: colors.text.ink,
  },
  messages: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  row: { flexDirection: 'row' },
  rowUser: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  bubbleUser: {
    backgroundColor: colors.text.ink,
    borderBottomRightRadius: 4,
  },
  bubbleMira: {
    backgroundColor: colors.bg.bubble,
    borderBottomLeftRadius: 4,
  },
  bubbleUserText: { fontSize: fontSize.button, lineHeight: 20, color: colors.onPrimary },
  bubbleMiraText: { fontSize: fontSize.button, lineHeight: 20, color: colors.text.base },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  footerBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footerLogo: { width: 16, height: 16, borderRadius: 4 },
  footerName: { fontSize: fontSize.button, lineHeight: 18, fontWeight: '500', color: colors.text.muted },
  footerMeta: { fontSize: fontSize.button, lineHeight: 18, color: colors.text.soft },
  brandBar: { height: 4, backgroundColor: colors.primary },
});

export function ShareCardView({
  model,
  onLogoLoad,
}: {
  model: ShareCardModel;
  onLogoLoad?: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Image source={miraLogo} style={styles.logo} onLoad={onLogoLoad} />
        <View style={styles.headerText}>
          <Text style={styles.brandName}>UIChat Mira</Text>
          <Text style={styles.brandTag}>对话分享</Text>
        </View>
        <Text style={styles.date}>{model.date}</Text>
      </View>
      <View style={styles.divider} />
      <Text style={styles.title} numberOfLines={2}>
        {model.title}
      </Text>
      <View style={styles.messages}>
        {model.messages.map((message) => (
          <View
            key={message.id}
            style={[styles.row, message.role === 'user' ? styles.rowUser : undefined]}
          >
            <View
              style={[
                styles.bubble,
                message.role === 'user' ? styles.bubbleUser : styles.bubbleMira,
              ]}
            >
              <Text style={message.role === 'user' ? styles.bubbleUserText : styles.bubbleMiraText}>
                {message.content}
              </Text>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.divider} />
      <View style={styles.footer}>
        <View style={styles.footerBrand}>
          <Image source={miraLogo} style={styles.footerLogo} onLoad={onLogoLoad} />
          <Text style={styles.footerName}>UIChat Mira</Text>
        </View>
        <Text style={styles.footerMeta}>
          {model.truncated
            ? `已截取前 ${model.messages.length} 条 · 共 ${model.totalCount} 条`
            : `共 ${model.totalCount} 条消息`}
        </Text>
      </View>
      <View style={styles.brandBar} />
    </View>
  );
}
