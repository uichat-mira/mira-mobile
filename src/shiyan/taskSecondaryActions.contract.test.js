const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const readSource = path => readFileSync(resolve(process.cwd(), path), 'utf8');

const home = readSource('src/shiyan/ShiyanRecordingScreens.tsx');
const detail = readSource('src/shiyan/ShiyanTaskDetailScreen.tsx');
const wrapper = readSource('src/shiyan/ShiyanTaskDetailWithDeliveryScreen.tsx');
const sheet = readSource('src/shiyan/ShiyanActionSheet.tsx');

describe('MOB-034 Shiyan secondary action hierarchy', () => {
  it('keeps home config in shortcuts without a duplicate More sheet', () => {
    expect(home).toContain("title: '服务配置'");
    expect(home).toContain("title: '自定义场景'");
    expect(home).toContain("navigation.navigate('ShiyanCloudConfig')");
    expect(home).toContain("navigation.navigate('ShiyanSceneConfig')");
    expect(home).not.toContain('accessibilityLabel="更多操作"');
    expect(home).not.toContain('MoreHorizontal');
    expect(home).not.toContain('<ShiyanActionSheet');
    expect(home).not.toContain('accessibilityLabel="配置拾言 Cloud"');
    expect(home).not.toContain('部分 Cloud 记录暂时不可用');
  });

  it('moves result-page low-frequency actions behind one More sheet', () => {
    expect(detail).toContain('accessibilityLabel="更多操作"');
    expect(detail).toContain('<ShiyanActionSheet');
    expect(detail).toContain("label: '分享最终稿'");
    expect(detail).toContain("label: deliveryActions.failed ? '重新投递 GitHub' : '投递到 GitHub'");
    expect(detail).toContain("label: '打开已投递文档'");
    expect(detail).toContain("label: '保留原始录音'");
    expect(detail).toContain("label: '使用默认清理策略'");
    expect(detail).not.toContain('系统分享 Markdown');
  });

  it('does not keep a competing persistent delivery bar', () => {
    expect(wrapper).not.toContain('GitHub Destination');
    expect(wrapper).not.toContain('deliveryBar');
    expect(wrapper).toContain('deliveryActions={{');
  });

  it('keeps share and delivery as different domain actions', () => {
    expect(detail).toContain('await Share.share');
    expect(wrapper).toContain('deliverFinalDraftToGithub');
    expect(detail).toContain('onPress: deliveryActions.onDeliver');
    expect(detail).toContain('onPress: deliveryActions.onOpenDelivery');
  });

  it('blocks sharing an old saved version while Final Draft edits are dirty or saving', () => {
    expect(detail).toContain('const shareBlocked = finalDraftDirty || finalDraftSaving;');
    expect(detail).toContain("supportingText: shareBlocked ? '请先保存当前修改'");
    expect(detail).toContain('disabled: shareBlocked');
  });

  it('keeps Final Draft editing primary and AI adjustment secondary', () => {
    expect(detail).toContain('styles.secondaryAction');
    expect(detail).toContain('styles.primaryButton');
    expect(detail).toContain("key: 'manual-edit'");
    expect(detail).toContain("label: '手动编辑'");
    expect(detail).toContain("key: 'ai-adjust'");
    expect(detail).toContain("label: 'AI 调整'");
    expect(detail).toContain('title="选择编辑方式"');
  });

  it('stabilizes More handlers for hook-safe memoization', () => {
    expect(detail).toContain('const setRetention = useCallback(');
    expect(detail).toContain('const shareFinalDraft = useCallback(async () => {');
    expect(detail).toContain('setRetention,');
    expect(detail).toContain('shareFinalDraft,');
  });

  it('keeps action-sheet items individually accessible', () => {
    expect(sheet).toContain('accessible={false}');
    expect(sheet).toContain('accessibilityRole="button"');
    expect(sheet).toContain('accessibilityLabel="关闭"');
    expect(home).toContain('accessible={false}');
  });

  it('surfaces delivery failure after the sheet closes', () => {
    expect(wrapper).toContain("Alert.alert('GitHub 投递未完成'");
    expect(wrapper).toContain('最终稿仍然安全，可以再次投递。');
    expect(wrapper).toContain("Alert.alert('无法打开已投递文档'");
  });

  it('uses existing design tokens for sheet and backdrop visuals', () => {
    expect(detail).toContain("import { fontSize, radius, sizing, spacing } from '../theme/tokens';");
    expect(sheet).toContain("import { fontSize, radius, sizing, spacing } from '../theme/tokens';");
    expect(detail).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{6}|rgba\(/);
    expect(sheet).toContain('backgroundColor: colors.overlay');
    expect(home).toContain('backgroundColor: colors.overlay');
    expect(home).not.toMatch(/rgba\(/);
  });

  it('removes Cloud implementation language from ordinary result feedback', () => {
    expect(detail).not.toContain('Cloud 已记录保留选择');
    expect(detail).not.toContain('Cloud 将按默认保留策略');
  });
});
