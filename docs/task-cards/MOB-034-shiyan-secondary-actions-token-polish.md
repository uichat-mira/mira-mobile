# MOB-034：拾言低频入口、分享 / 投递与 Design Token 收口

状态：**REVIEW · 待真机/真实服务验证**

负责人：`t-zt`

执行仓库：`dangjingtao/uichat-mira-mobile`

依赖：建议在 MOB-030 / MOB-031 / MOB-032 / MOB-033 合入后基于最新 `dev` 施工。

## 验收记录（2026-09-02）

- PR #91 已 squash merge 到 `dev`，merge commit `eb5f90a02e3362ab35ddeb3ab22eb59b7712b25b`。
- current-head Typecheck / Lint / Jest 全绿。
- Android debug build 成功。
- iOS simulator、unsigned iPhone build、IPA 打包 / 校验 / 上传成功。
- OpenCode current-head review 在 `Run read-only Mira Mobile review` 阶段 cancelled，未产出 verdict；不记录为 review pass，也不视为代码 review failure。
- 合并前较早 Codex review 的两条 P1（Action Sheet VoiceOver 可访问性、Delivery 失败反馈）均已修复并 resolve。
- 仍需 Android/iOS 真机验证 More Sheet、系统 Share Sheet、真实 GitHub Delivery / canonical URL、原音保留策略及 light/dark 视觉后才能 PASS。

## 背景

MOB-030～033 会分别收口首页、确认页、结果页和处理恢复。最后仍需要一张独立的 UI/交互收尾卡，把低频动作放到正确的小入口，统一 Action Sheet / More 菜单的行为，并确保实现完全服从 Mira Mobile 现有 Design Token，而不是照设计图硬编码视觉。

这张卡不负责重新设计主流程，不改 PRD，不重写前四张卡的核心逻辑。它负责“让已经正确的交互看起来是一套产品”。

## Goal

1. 低频动作不与主 CTA 抢层级；
2. 分享、Destination、保留原音、配置、删除等动作通过小按钮 / `···` / Action Sheet 合理归位；
3. Cloud / Stage / canonical URL 等技术语言从普通路径降级；
4. 全部拾言页面使用现有 `src/theme/` Design Token；
5. 清理已经失效的重复入口、旧文案和旧占位实现，但不删除仍被路由或兼容路径依赖的代码。

## Must Read

- `AGENTS.md`
- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/shiyan/GITHUB_DESTINATION_CONTRACT.md`
- `docs/task-cards/MOB-030-shiyan-home-unified-records.md`
- `docs/task-cards/MOB-031-shiyan-confirmation-hierarchy.md`
- `docs/task-cards/MOB-032-shiyan-result-first-review.md`
- `docs/task-cards/MOB-033-shiyan-processing-recovery.md`
- `src/shiyan/ShiyanRecordingScreens.tsx`
- `src/shiyan/ShiyanCaptureSubmitScreen.tsx`
- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/shiyan/ShiyanTaskDetailWithDeliveryScreen.tsx`
- `src/shiyan/ShiyanCloudConfigScreen.tsx`
- `src/shiyan/ShiyanScreens.tsx`
- `src/theme/tokens.ts`
- `src/theme/palette.ts`
- `DESIGN.md`

产品边界以 PRD 为准；实现边界以 TECHNICAL_DESIGN 为准；视觉以现有 Mobile Design Token 为准。设计稿只表达信息层级与交互意图，不是新的视觉真相源。

## Verified Context

- Share 与 Destination 是两个不同产品语义，不能合并。
- GitHub 是 MVP 第一 Destination；成功投递必须使用真实 canonical link / evidence，不能造假成功。
- 原始录音默认按 PRD 保留策略处理，用户可选择 retained；这个能力不能因为 UI 收口而消失。
- `ShiyanCloudConfig` 已存在，不需要新建第二套设置页。
- 项目已有 Lucide、ThemeContext、token / palette，应优先复用。

## Interaction Contract

### A. More / `···` 的定位

低频动作允许通过顶部或局部 `···` 打开受控 Action Sheet / Bottom Sheet。

原则：

- 主 CTA 不放进 `···`；
- 删除等 destructive action 放 Sheet 底部并明确红色 / destructive 语义；
- 一个页面尽量只有一个主要 More 入口，避免多个 `···` 互相不知所云；
- Sheet 内容只包含当前页面真实可执行动作。

### B. 首页 More

拾言首页右上角小入口可包含：

- 拾言 Cloud / 服务配置；
- 自定义场景配置（若当前导航仍保留）；
- 其它 PRD 内、当前已实现且低频的设置项。

不要把历史任务、本地草稿、开始录音重新塞进 More；这些属于主导航/记录路径。

### C. 结果页 More

根据当前 task 状态动态提供合法动作：

- 分享 Final Draft；
- 投递到 GitHub / 当前可用 Destination；
- 打开真实投递去向（已成功投递且有 canonical URL 时）；
- 原始录音保留设置（若当前 task / API 支持）；
- 处理详情可以是页面小入口，不强制塞进 More。

要求：

- 没有 Final Draft 时不得出现会误导为可投递的 enabled action；
- 投递失败不隐藏 Final Draft；
- 已投递时不要显示“暂无真实投递链接”；有 URL 就显示可打开入口，没有就不伪装成功。

### D. 分享 vs 投递

- `分享`：调用系统 Share Sheet，临时发送当前 Final Draft。
- `投递`：调用 Destination API，形成长期 Delivery Record。
- UI 可以把它们放同一个 Action Sheet，但文案、图标和结果反馈必须区分。
- 投递动作必须基于用户确认后的 Final Draft。

### E. 原始录音保留

- 不把保留策略做成结果页大卡片。
- 可以在 `···` -> `原始录音` / `保留设置` 中通过 Action Sheet / Modal 选择：使用默认清理策略 / 保留原始录音。
- 更新成功后用轻反馈确认，不要用一长段 Cloud 实现说明轰炸用户。
- 不改变默认 3 天和 retained 的 PRD 语义。

### F. 文案收口

普通用户路径优先使用：

```text
全部记录
正在上传
正在转写
正在整理
待你确认
整理稿
原文
处理详情
已投递
需要处理
```

避免在首层 UI 反复出现：

```text
Cloud Task
CaptureTask
Stage status
canonical destination URL
AI Draft version
lifecycle
```

这些技术术语可存在 Debug / code / contract，不作为普通交互主要文案。

### G. Design Token

所有视觉实现必须从现有主题 / token 取值：

- background / surface；
- text hierarchy；
- primary / active / disabled；
- status error / success；
- spacing；
- radius；
- typography；
- border。

禁止：

- 因设计稿是绿色 / 紫色就新增硬编码品牌色；
- 为某一屏复制一套局部 spacing / radius 常量；
- 为了“更像稿子”绕过 ThemeContext；
- 新建与现有 token 语义重复的 token，除非确有系统级缺口且先报告。

### H. 旧 UI / 文案清理

当前仓库可能同时存在早期 `ShiyanScreens.tsx` 中的旧壳与后来真实 Recording / History / TaskDetail 页面。

施工时：

1. 先通过 `App.tsx` / navigation / imports 确认真实运行路径；
2. 仅删除确定无引用、无兼容职责的重复代码；
3. 若某旧导出仍被其它 route / test 使用，先保留或做安全迁移；
4. 删除“录音能力接入后…”、“Cloud Stage 真相…”等已经过期的占位文案；
5. 不做无关 Chat / Settings / Remote Host 重构。

## Hard Constraints

- PRD 不改。
- 不新增功能。
- 不改变 MOB-030～033 已确定的主路径。
- 不把分享与投递合并成同一 domain action。
- 不伪造 Destination 成功或 canonical URL。
- 不改变原始录音保留策略。
- 不引入新的 UI 框架 / bottom-sheet 大依赖，优先复用现有受控 Modal / React Native 能力。
- 视觉必须以现有 Design Token 为准。

## Execution Entry Points

- `src/shiyan/ShiyanRecordingScreens.tsx`
- `src/shiyan/ShiyanCaptureSubmitScreen.tsx`
- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/shiyan/ShiyanTaskDetailWithDeliveryScreen.tsx`
- `src/shiyan/ShiyanCloudConfigScreen.tsx`
- `src/shiyan/ShiyanScreens.tsx`
- `src/theme/tokens.ts`
- `src/theme/palette.ts`

原则上本卡不应修改 Cloud repo。

## Acceptance

1. 首页、确认页、结果页各自只有明确主动作；低频动作通过小入口 / Sheet 出现。
2. 分享与投递在同一 Sheet 内也保持不同语义和反馈。
3. Final Draft 未准备好时不会提供误导性的投递成功路径。
4. 已投递时真实 canonical URL 可打开；没有 URL 不显示伪占位。
5. 原音保留能力仍可访问，但不抢主视觉。
6. 普通 UI 不再大量暴露 Cloud / Stage / lifecycle 等实现词。
7. 拾言全部改动使用现有 Design Token，无新增硬编码主题视觉。
8. 旧占位文案和确认无用的重复 UI 已清理；真实兼容路径不误删。
9. Android / iOS 下 Sheet / More 交互都成立。

## Validation

至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

人工 / 真机 smoke：

- 首页 More -> 配置 -> 返回；
- 结果页 More -> Share Sheet；
- Final Draft -> GitHub Delivery -> 成功 / 失败反馈；
- 已投递 -> 打开真实链接；
- 原音保留策略修改；
- destructive action 二次确认；
- light/dark（若当前主题支持）均无硬编码视觉破坏。

如果真实 GitHub Destination / Secret 不可用，明确 integration gap，不伪造投递通过。

## Parallel / Integration

- 本卡建议最后施工，不与 MOB-030～033 并行抢 UI 文件。
- 如果前四张尚未全部合入，先等待或以最新合并结果 rebase；不要基于旧结构做一次“漂亮但必冲突”的重排。
- 若发现前卡实现违反 PRD / Technical Design，不自行用本卡偷偷修合同；先报告冲突。

## Unknown / Human Decision

None。

## Handoff

这张卡是 UI/交互收口，不是重新设计。先接受 MOB-030～033 的主结构，再用小按钮、Sheet、文案和 Design Token 把它们统一成一套克制的拾言体验。
