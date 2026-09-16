# MOB-033：拾言处理详情与单阶段失败恢复交互

状态：**REVIEW · 待真机验证**

负责人：`mob_033_shiyan_processing_recovery`

执行仓库：`dangjingtao/uichat-mira-mobile`

依赖：**MOB-032 先合入或至少先固定 TaskDetail 的结果优先结构。**

施工基线：从施工时最新 `dev` 创建独立 feature 分支；若 MOB-032 合入后 `dev` 前进，必须以新 HEAD 为准。

## 背景

拾言的 Stage 模型是 MVP 的可靠性核心：上传失败、STT 失败、AI 整理失败、Destination 失败都不能抹掉前序产物，也不能粗暴变成“整个任务失败”。现有 UI 已能展示完整 Stage list 和 retry，但默认暴露过多技术细节。

MOB-032 负责把结果页改成“内容优先”；本卡负责把 Stage、错误和恢复能力放到正确层级，同时保持完整可操作性。

## Goal

1. 正常状态：Stage 详情默认折叠，不压过整理稿；
2. 处理中：用户看到一句清晰当前进度，而不是内部流水线；
3. 单 Stage 失败：在当前页面给出明确、局部、可恢复的错误；
4. 点 `处理详情` 后能查看完整 Stage 事实与 retry 证据；
5. 已成功产物永远优先保留和可访问。

## Must Read

- `AGENTS.md`
- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/task-cards/MOB-019-shiyan-stt-transcript.md`
- `docs/task-cards/MOB-020-shiyan-llm-organization.md`
- `docs/task-cards/MOB-021-shiyan-mobile-results-history.md`
- `docs/task-cards/MOB-023-shiyan-e2e-hardening.md`
- `docs/task-cards/MOB-032-shiyan-result-first-review.md`
- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/shiyan/taskPresentation.ts`
- `src/shiyan/client/ShiyanClient.ts`
- `src/shiyan/client/contracts.ts`

若卡片描述与 PRD 冲突，以 PRD 为准；Stage / retry / artifact 保留语义以 TECHNICAL_DESIGN 与现有 contracts 为准。

## Verified Context

- UI 不能只消费一个笼统 task.status；客户端拥有 lifecycle、current stage、各 stage status、retryable error、available artifacts。
- Stage failure 不等于 Task failure。
- STT 成功后 Transcript 即使 organize 失败也必须继续可看。
- Final Draft 已存在时 Delivery 失败也不能影响 Final Draft。
- 当前已有 `retryStt()`、`retryOrganize()` 等恢复入口；Destination retry 由现有 Delivery 合同决定，不在本卡虚构 API。

## Interaction Contract

### A. 正常 / Ready 状态

- 结果页只显示一个轻量状态，例如 `整理完成` / `已准备好确认`。
- 完整 Stage list 默认不展开。
- 页面提供 `处理详情 >` 小入口。
- 点击后展开内联区域、Bottom Sheet 或独立轻量详情层均可；优先复用现有页面结构，避免新建重型页面。

### B. Processing 状态

用户主文案按产品语言归纳：

```text
正在上传录音
正在转写
正在整理
等待你确认
```

不要把 `creating_task`、`registering_scene`、`persist-transcript`、`workflow step` 等实现词作为主文案。

允许在“处理详情”中保留更精确的 Stage 名称，只要用户可理解。

### C. Stage 详情

展开后每个 Stage 至少呈现：

- 用户可理解的 Stage 名称；
- 当前状态；
- 若失败，精确错误事实；
- 若可重试，对应重试入口；
- retry count 可作为次级信息，不作为主视觉。

不得用红色边框把整个 Task 卡片都塑造成“全局失败”状态。

### D. 单阶段失败

失败时，结果页主区域应出现轻量局部提示，例如：

```text
AI 整理遇到问题
原文已经保存，可重新整理。
[ 重试整理 ]   [ 查看处理详情 ]
```

或：

```text
投递 GitHub 未完成
最终稿仍然安全，可以再次投递。
```

要求：

- 明确哪个阶段出了问题；
- 明确哪些已有内容仍安全；
- 只对该 Stage 提供合法 retry；
- 不重新执行已成功 Stage，除非现有 canonical API 本来如此定义。

### E. 已有产物优先

- STT failed：原始录音仍可恢复 / 保留；若已有旧 transcript evidence，不静默清掉。
- organize failed：Transcript 仍可看。
- Delivery failed：Final Draft 仍可读、编辑、分享。
- Transcript read failure：Draft / Final Draft 不受影响。
- 任何 retry UI 不得清空当前可用内容制造“重新开始”假象。

### F. 刷新 / Polling

- 保留现有 polling / refresh 事实，不为了 UI 简化删除异步刷新。
- 正在处理时可以轻量自动刷新；用户不需要停留在页面等待。
- 手动刷新图标若保留，视觉等级低于当前任务动作。

### G. 历史 / 统一记录状态

本卡需要向 presentation helper 暴露稳定的用户态映射，供 MOB-030 统一记录列表复用：

- processing -> `正在整理` / 对应当前阶段；
- ready -> `待你确认`；
- completed/delivered -> `已完成` / `已投递`；
- stage failed -> `需要处理`，而不是 `任务失败`。

若 MOB-030 已先实现 mapper，优先复用并补齐，不建立第二套。

## Hard Constraints

- PRD 不改。
- 不把 Stage 模型删除或合并成单一 status。
- 不新增不存在的 retry API。
- 不因 UI 简化而重跑已成功 Stage。
- 不修改 Cloud Workflow / schema；如发现后端合同缺口，报告给对应 Cloud 卡，不在 Mobile 猜接口。
- 不隐藏可恢复错误；“默认折叠”不等于“不可发现”。
- 视觉按现有 Design Token，错误色只用于真实错误。

## Execution Entry Points

- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/shiyan/taskPresentation.ts`
- `src/shiyan/client/ShiyanClient.ts`（原则上只使用已有能力）
- `src/shiyan/history.ts` / MOB-030 presentation helper（若需要统一状态映射）

## Acceptance

1. Ready/Completed 页面默认不展示完整 Stage list。
2. `处理详情` 可以查看完整 Stage 状态。
3. processing 状态主文案使用用户语言。
4. STT / organize 等已有 retry 能正常工作且只影响对应 Stage。
5. organize 失败时 Transcript 仍显示；Delivery 失败时 Final Draft 仍显示。
6. Stage failure 不被映射为全局 Task failed。
7. 失败提示明确“哪个阶段 + 什么仍然安全 + 下一步”。
8. polling / refresh 不回归。
9. 统一记录列表能复用同一用户态映射。

## Validation

至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

测试至少覆盖：

- upload / STT / organize processing presentation；
- STT failed + retry；
- organize failed + transcript preserved + retry；
- Delivery failed + Final Draft preserved（如当前 Mobile 已具备该状态）；
- failed stage -> history/unified record 不显示 global failure；
- processing polling 后状态更新。

真机 / 集成 smoke：至少人工模拟或使用真实 dev Cloud 验证一个 retryable stage failure；无法制造真实 Provider failure 时明确 validation gap，不得伪造。

## Implementation Evidence

- PR #89 已 squash-merge 到 `dev`，merge commit `680de1221316414c83eb3cb8e2e421d948427206`。
- current-head Typecheck / Lint / Jest、Android debug、iOS simulator、unsigned iPhone / IPA 均通过。
- 两次 latest-head OpenCode Review 均在工作流 18 分钟超时后被取消，没有产出 verdict；按产品负责人决定，本次不将“无结果”视为代码失败。
- 仍需真实 Android/iOS 与真实 dev Cloud 验证 retryable stage failure、upload recovery、内容保留与恢复交互，完成前不得标记 PASS。

## Parallel / Integration

- **依赖 MOB-032。** 不建议在 MOB-032 尚未稳定时同时大改 TaskDetail。
- 可以与 MOB-030 / MOB-031 在不同代码区域并行。
- MOB-034 最后统一 Secondary action、文案与视觉 token。

## Unknown / Human Decision

- Destination 的具体 retry UI 仅在当前 public contract 已有合法入口时接入；若没有，标注 gap，不为完成本卡发明 route。

## Handoff

先基于 MOB-032 合入后的最新 TaskDetail 结构定位；本卡是“把可靠性能力藏到正确层级”，不是弱化可靠性合同。
