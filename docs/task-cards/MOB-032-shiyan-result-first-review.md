# MOB-032：拾言结果优先的 Review / Final Draft 交互

状态：**PASS（2026-09-04 真机验收通过）**

负责人：`mob_032_shiyan_result_review`

执行仓库：`dangjingtao/uichat-mira-mobile`

施工基线：从施工时最新 `dev` 创建独立 feature 分支；本卡首次派发基于 2026-09-01 当前 `dev`。

## 背景

现有 `ShiyanTaskDetail` 已经具备 task 状态、Transcript、AI Draft、AI 调整、Final Draft、分享与 Delivery 等能力，但页面结构仍偏“技术对象顺序”：先看状态 / Stage，再看内容。烟测通过后，产品需要进入第二阶段——正常情况下让用户先看到“整理结果”，技术状态退到需要时再看。

本卡只调整 Review 页面信息层级与交互，不改变 Transcript / AI Draft / Final Draft / Delivery 合同。

## Goal

当任务已经具备可用整理结果时，详情页默认以内容为主：

1. 标题 + 轻状态；
2. 整理稿作为主内容；
3. 原文 Transcript 作为可随时打开的证据层；
4. AI 调整与最终编辑围绕当前整理稿进行；
5. Stage / retry 的详细处理交给 MOB-033，不在本卡重做状态机。

## Must Read

- `AGENTS.md`
- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/task-cards/MOB-020-shiyan-llm-organization.md`
- `docs/task-cards/MOB-021-shiyan-mobile-results-history.md`
- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/shiyan/ShiyanTaskDetailWithDeliveryScreen.tsx`
- `src/shiyan/content.ts`
- `src/shiyan/client/contracts.ts`
- `src/shiyan/taskPresentation.ts`
- `src/theme/tokens.ts`

涉及产品边界时以 PRD 为准；AI Draft / Final Draft / candidate / authoritative state 以 TECHNICAL_DESIGN 与现有 contracts 为准。

## Verified Context

- Transcript 是长期保留、只读的证据层。
- AI 调整只能生成候选，不能静默覆盖人工 Final Draft。
- Final Draft 是用户最终控制的可投递内容。
- 当前代码已经能读取 transcript/content、生成 adjustment candidate、进入 final editor、保存 Final Draft。
- 本卡不要求新增原文时间点引用或音频定位；PRD 已把这类能力放在 MVP+1。

## Interaction Contract

### A. Ready / Completed 状态默认布局

当已有 AI Draft 或 Final Draft 可用时，默认首屏顺序应接近：

```text
< 任务标题                               ···
轻状态 / 时间

整理稿
[ 当前可读内容 ... ]

[ AI 调整 ]   [ 编辑最终稿 ]

原文 Transcript                         > / 展开
处理详情                                >
```

- 不要求照抄具体按钮样式；视觉以现有 token 为准。
- 不默认把完整 Stage list 放在整理稿之前。

### B. “整理稿”UI 语义

UI 可以对用户统一使用“整理稿”这个产品语言，但内部数据仍必须区分：

```text
AI Draft
Adjustment Candidate
Final Draft
```

展示优先级：

1. 已保存 Final Draft -> 默认显示 Final Draft，并明确是已确认 / 已编辑版本；
2. 无 Final Draft 但有当前 candidate -> 可展示 candidate，并明确它尚未替代最终稿；
3. 否则展示 AI Draft。

不得因为 UI 统一叫“整理稿”而合并、覆盖或丢失版本语义。

### C. AI 调整

- `AI 调整` 是围绕当前整理稿的次级动作，不做独立大工作流入口。
- 点击后可在当前页展开轻量输入区或打开 Bottom Sheet / Modal。
- 允许用户输入现有自由指令；不在本卡新增 PRD 外模板系统、Prompt 市场或额外 AI 功能。
- AI 返回 adjustment candidate 后，页面必须让用户清楚它是候选结果；用户仍需决定是否进入最终编辑 / 采用。
- 若已有 Final Draft，AI candidate 绝不能静默替换 Final Draft。

### D. Final Draft 编辑

- `编辑最终稿` 是结果阶段的主要人工动作。
- 可复用现有 inline editor / controlled editor，不要求新建独立页面。
- 打开编辑器时以当前合法 base version 初始化。
- 用户有未保存修改时返回 / 关闭必须沿用现有 dirty-state 保护，不能静默丢编辑。
- 保存成功后，整理稿区域立即回显保存后的 Final Draft。

### E. Transcript

- 默认不需要在首屏展开全文。
- 显示一个清晰的 `原文` / `Transcript` 入口；点击后可展开当前页、打开抽屉/Sheet，或进入现有只读区域。
- Transcript 必须保持只读、完整可查看。
- 不实现“点击某条结论跳到原文时间点”；这是 PRD 外 / MVP+1 能力。
- Transcript 读取失败不能让已存在的 Draft / Final Draft 消失。

### F. 非 Ready 状态

- task 尚在上传 / STT / organize 时，不伪造整理稿。
- 页面可显示轻量处理中状态与已有产物；详细 Stage UI 由 MOB-033 收口。
- 若 Transcript 已成功但 AI Draft 未就绪，允许用户查看 Transcript，不能因为后续 organize 未完成而隐藏已有证据。

### G. More / Delivery

- 顶部 `···` 或低频动作区域可以保留分享 / 投递 / 保留原音等入口，但本卡不重构 Delivery；最终统一由 MOB-034 收口。

## Hard Constraints

- PRD 不改。
- 不新增 summary 模板、Mind Map、speaker diarization、时间点引用等 PRD 外功能。
- 不覆盖 Final Draft。
- 不允许编辑 Transcript。
- 不删除 Stage / retry 能力，只是本卡不让它默认压过内容；MOB-033 会负责正确的处理详情层级。
- 不改变 Cloud public API / schema。
- 视觉以现有 Design Token 为准。

## Execution Entry Points

- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/shiyan/ShiyanTaskDetailWithDeliveryScreen.tsx`
- `src/shiyan/content.ts`
- `src/shiyan/taskPresentation.ts`

如页面过重，可做小型 presentational component 拆分，但不要借机建立新的全局 UI 框架。

## Acceptance

1. task ready/completed 时，用户打开详情首先看到整理内容而不是完整 Stage 流水线。
2. Final Draft 存在时默认展示 Final Draft；AI Draft / candidate 不会覆盖它。
3. 无 Final Draft 时能正确展示 AI Draft / candidate 的当前语义。
4. AI 调整仍产生候选；人工最终稿保护不回归。
5. Final Draft 编辑、dirty-state、保存语义不回归。
6. Transcript 默认轻入口，可完整展开查看且只读。
7. Transcript 失败不影响已有 Draft / Final Draft 展示。
8. processing 状态不伪造结果；已有产物优先显示。
9. UI 文案尽量用户化，不直接要求用户理解 `AI Draft version`、`Cloud lifecycle` 等实现名词。

## Validation

至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

测试至少覆盖：

- AI Draft only；
- adjustment candidate；
- Final Draft saved；
- Final Draft + new candidate 不覆盖；
- transcript ready / not ready / read failure；
- final editor dirty / save；
- task processing with partial artifact。

真机 smoke 至少验证：整理完成 -> 查看整理稿 -> 展开原文 -> AI 调整 -> 编辑并保存最终稿。

## Implementation / Review Evidence

- PR #88 `feat: make Shiyan review result-first` 已于 2026-09-02 squash merge 到 `dev`，merge commit：`27411813b8585a94bbf40320d3db47ab624674f1`。
- 已落地 result-first 信息层级；Transcript / 处理详情默认折叠；Final Draft > adjustment candidate > AI Draft 的展示优先级保持独立语义。
- 已补 Final Draft dirty-state / beforeRemove 保护、编辑器重复进入保护、active processing partial-artifact 刷新，以及保存 Final Draft 与并发 content refresh 的竞态保护。
- current head `9d63cc92da94cded51b7a2232970c264ba0425f1` 的 Mobile CI 已成功：Typecheck、Lint、全量 Jest、Android debug、iOS simulator 与 unsigned device 构建通过；signed release job 按现有条件跳过。
- current head OpenCode Review：`NO_BLOCKING_FINDINGS`，无高置信 P0-P2 finding；此前发现的 dirty baseline、partial artifact polling、stale refresh 与 editor re-entry 问题均已修复。
- 产品侧交互检查仍记录两项待真机观察/后续收口点：`编辑最终稿` 与 `AI 调整` 的视觉主次需在真实渲染中确认；Final Draft 有未保存编辑时“系统分享 Markdown”仍指向已保存版本，其实际理解成本与是否需要进一步保护待真机流程确认。Delivery 已保持 dirty/saving 阻断。
- 尚未取得 Android / iOS 真机的长文滚动、键盘遮挡、Transcript 展开、AI 调整、Final Draft 编辑/保存、分享/投递完整 smoke 证据，因此本卡保持 **REVIEW · 待真机验证**，不得记为 PASS。

## Parallel / Integration

- 可以与 MOB-030 / MOB-031 并行，主要代码区域不同。
- **MOB-033 依赖本卡的详情页结构先稳定**；MOB-033 应在 MOB-032 合入后基于最新 `dev` 开始或 rebase 后施工。
- MOB-034 在最后统一收 Secondary action / Delivery / token。

## Unknown / Human Decision

None。若需要改变 PRD 的 Draft / Final Draft 行为才能实现界面，停止施工并报告；不允许以 UI 简化为理由改合同。

## Handoff

先读当前代码确认已经存在的 content / candidate / final editor 能力；本卡目标是重排信息层级，不是重写内容系统。

## Acceptance Evidence — 2026-09-04

真机验收（Android/iOS）全部通过，本卡标 PASS：

1. ready/completed 打开详情先看到整理内容，Stage 流水线折叠 ✅
2. 有 Final Draft 时默认展示 Final Draft，AI candidate 不覆盖 ✅
3. 无 Final Draft 时正确展示 AI Draft / candidate 语义 ✅
4. AI 调整仍为候选，人工最终稿保护不回归 ✅
5. Final Draft 编辑、dirty-state、保存语义不回归 ✅
6. Transcript 默认轻入口，可完整展开且只读 ✅
7. Transcript 读取失败不影响已有 Draft / Final Draft 展示 ✅
8. processing 状态下不伪造结果，已有产物优先显示 ✅
9. 文案用户化，无 `AI Draft version` / `Cloud lifecycle` 等实现名词 ✅

> 注：验收中发现一个独立 bug（拾言列表页显示「待你确认」，点进去却是「已确认最终稿」），另立 issue #95 跟踪（Cloud 侧修复 PR mira-shiyan-cloud#8 待合并）。本卡验收要点通过，不受该 bug 阻塞。
