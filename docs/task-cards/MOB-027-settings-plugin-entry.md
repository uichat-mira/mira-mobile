# MOB-027：设置页插件入口恢复可用

状态：**完成**（代码已入 `dev`，真机入口回归已通过）

负责人：`mob_027_settings_plugin_entry`

执行仓库：`dangjingtao/uichat-mira-mobile`

首次派卡基线：`dev @ a90dfb6c2d80079fd85084fff0214968e137e653`

## 背景

当前 `SettingsScreen` 已展示「插件」设置项，但该行没有配置可执行的 `actionId`，`handleSettingAction()` 也没有对应分支，因此用户点击无响应。

与此同时，应用导航层已经存在 `Plugins` route 与 `PluginsScreen`。这是一处明确的接线回归，不需要重新设计插件体系。

## 目标

1. 「设置 -> 插件」点击后稳定进入现有插件页面。
2. 返回设置页路径正常。
3. 不改变现有插件产品范围，不新增假插件能力。

## Scope

- 为现有「插件」设置项补齐明确 action。
- 在 `handleSettingAction()` 中导航到当前已注册的 `Plugins` route，或使用项目当前等价的类型安全导航方式。
- 保持现有 SettingsRow 的视觉、点击反馈和无障碍语义。
- 如现有导航类型缺失，仅做完成该路由所需的最小类型修复。

## Hard Constraints

- 不重做 Settings 信息架构。
- 不重写 `PluginsScreen`。
- 不新增插件市场 / 安装 / 第三方生态能力。
- 不把入口可点击伪装成尚不存在的远端插件功能。
- 不顺手修改其它设置项。

## Must Read

- `AGENTS.md`
- `docs/work-ledger.md`
- `docs/task-cards/MOB-016-shiyan-plugin-shell.md`
- `src/screens/SettingsScreen.tsx`
- `App.tsx`
- `src/types/navigation.ts`
- 当前 `PluginsScreen` 实现

## Execution Entry Points

- `src/screens/SettingsScreen.tsx`
- `App.tsx` / `src/types/navigation.ts`（仅当当前 HEAD 的 route 类型需要同步）

## Validation

至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

并取得以下 smoke 证据：

1. 设置页点击「插件」会进入现有 Plugins 页面；
2. 连续点击不会产生异常导航栈；
3. 返回后回到设置页；
4. 其它设置入口行为无回归。

如果适合当前测试结构，补一个针对 action -> route 的轻量回归测试；不为了这张小卡引入大型 UI 测试框架。

## Parallel / Integration

该卡改动面很窄，可与 MOB-025、MOB-026、MOB-028、MOB-029 从同一 `dev` base 并行。若当前 HEAD 已修复，则先报告并用测试 / smoke 证明，不重复造另一套路由。

## Open / Unknown

None。

## Acceptance

- 代码证据：`327b2e4` 已进入 `dev`。
- 产品验收：产品负责人于 2026-09-01 确认真机入口回归通过。
- 结论：MOB-027 `PASS`，无剩余挂账。

## Handoff

已完成，无后续施工。
