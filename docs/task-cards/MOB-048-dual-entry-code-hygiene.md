# MOB-048：双链路提交窄范围代码卫生收尾

状态：**PASS**（2026-09-07 PR #102 squash-merged as `1f3b7938`；targeted cleanup、自审与卡内机器验收已收口；broad refactor 继续 deferred）

范围：Mira Mobile；仅针对 2026-09-06 双链路基础提交及其相邻收尾

依赖：MOB-045、MOB-046、MOB-047

## 目标

在三张正确性修复卡合入后，对 `7bc3556` 引入/触碰的代码做一次窄范围卫生清扫：移除明显死代码和提交残留、修正新增的 Design Token 违例、检查未使用 import / 重复分支 / 测试只验字符串不验行为的问题。**本卡不是架构重写，也不启动此前 deferred 的 Conversation / Host gateway 大重构。**

## Must Read

- `AGENTS.md`
- `docs/workbench/00-work-ledger.md`
- `docs/engineering/mobile-code-health-initial-assessment.md`
- MOB-045 / MOB-046 / MOB-047 的最终实现与验证
- `git show 7bc3556` 对应 touched-file 范围
- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/runtime/`
- `src/provider/`
- `src/local/`
- `src/screens/LocalProviderConfigScreen.tsx`
- `src/screens/SessionListScreen.tsx`

## Verified Context

- `7bc3556` 一次触碰 58 个文件，包含 Local Provider / Runtime / UI / task docs，同时混入拾言 UI 收尾。
- 当前 `ShiyanTaskDetailScreen` 存在类似 `condition ? null : null` 的无效 JSX 残留。
- 新增 tab 样式存在硬编码 `#ddd`，未使用现有 design token。
- 仓库已有 Code Health Assessment 明确反对仓库级重写；该判断继续有效。
- 维护者本次明确授权的是“这次提交的卫生收尾”，不是此前候选的 Conversation orchestration / Host gateway / App composition 全量治理批次。

## Hard Constraints

- 必须基于 MOB-045/046/047 合入后的最新 dev 开始，不得继续用 `7bc3556` 旧工作树直接改。
- 不改变产品行为、Remote Host 协议、Provider wire contract、Shiyan 产品合同。
- 不移动大目录、不批量重命名、不做“顺手架构升级”。
- 不以减少行数为 KPI。
- 不修改未被本次双链路提交或其直接相邻代码触碰的稳定模块，除非是修复编译/测试所必需。
- 发现行为 bug 时停止把它包装成“卫生”，另报具体缺陷。

## 功能范围

- 删除明显无效 JSX / unreachable / stale helper / unused import。
- 新增 UI 样式中的颜色、spacing、radius 等回到现有 token；不得重新设计视觉。
- 检查本次新增 contract tests：凡只验证源代码字符串、而对应行为已有可测试边界的，优先补/转为行为测试；不要求一次消灭仓库所有 source-string tests。
- 检查 Runtime / Provider / Local 文件职责是否出现重复实现或屏幕层直接越过 adapter；只修本次提交造成的明显越界。
- 对最终 diff 做 scope audit，确保没有再次混入拾言以外的无关修改。

## Execution Entry Points

优先由最终 `git diff <pre-dual-entry-base>...dev` 与 MOB-045/046/047 diff 确定，不预设全仓扫描。

已知起点：

- `src/shiyan/ShiyanTaskDetailScreen.tsx`
- `src/provider/openAiCompatibleClient.ts`
- `src/runtime/localProviderRuntime.ts`
- `src/runtime/mobileAgentLoop.ts`
- `src/runtime/runtimeRegistry.ts`
- `src/screens/LocalProviderConfigScreen.tsx`
- `src/screens/SessionListScreen.tsx`
- 对应新增 tests

## Acceptance

1. 已知死 JSX / stale import 被清理。
2. 本次新增 UI 不再出现无理由硬编码颜色（已存在且有明确例外的不强改）。
3. MOB-045/046/047 的行为测试全部保持通过。
4. Remote Host / Shiyan 现有核心回归无行为变化。
5. 最终 diff 可按“本次双链路卫生”逐项解释，没有大范围文件搬迁或无关格式化。
6. Code Health Assessment 明确记录：MOB-048 是 targeted cleanup， broad refactor 仍 deferred。

## Validation

- `git diff --check`
- `npm run typecheck`
- `npm run lint`
- 全量 Jest。
- Android debug build。
- 若触及 iOS / native 文件才要求对应 iOS build；否则不为“完整感”制造无关 native 改动。
- 复核 Mobile CI。

## Unknown / Human Decision

None。若施工中发现需要启动 Conversation orchestration / Host gateway 大重构，视为超出本卡，停止并报告。

## Parallel / Integration

**不得与 MOB-045/046/047 并行。** 三张卡全部合入 dev 后再开工，并重新读取最新 HEAD。MOB-048 完成后再继续 MOB-041/042 的功能扩张更稳妥。

## Handoff

这张卡的关键词是“收干净”，不是“重构漂亮”。任何会显著扩大 diff 的动作默认不做。


## Completion Evidence

- 施工基线为 MOB-045/046/047 全部合入后的最新 `dev`，未复用旧 `7bc3556` 工作树。
- 对 `7bc3556` touched source 做窄范围机械扫描；确认仍存活的明确卫生问题为 Shiyan 死 JSX 与新增 `#ddd` tab border，均已清理。
- `ShiyanTaskDetailScreen` 删除无效 `condition ? null : null` JSX，并将 tab border 改用 `colors.border.default`；未重设计 Shiyan 行为。
- `ConversationRuntime` 显式声明两个既有 Runtime 都已经实现的 `deleteSession`，`RuntimeRegistry` 直接委派给已选 runtime，删除重复 kind 分支。
- 新增 RuntimeRegistry 行为测试，验证显式 Local / Remote filter 只查询对应来源；原有删除路由、降级与排序行为测试继续通过。
- source-string contract tests 经复核后仅保留 UI wiring 类断言；当前没有现成 render-level harness，因此没有为“消灭字符串测试”扩大组件重构。
- PR #102 最终 diff 为 7 files、+50/-9；无目录搬迁、协议变化、无关格式化或新增依赖。新增 patch 无 trailing whitespace、无新增硬编码 hex / debug 残留。
- Mobile CI：Typecheck、Lint、全量 Jest 通过；Android unsigned-release guard、Android debug build 与 APK upload 通过；iOS simulator build/upload 亦通过。MOB-048 未触及 iOS/native 文件，因此 unsigned-device build 不作为本卡 PASS 前置。
- 维护者最终自审未发现新的 P0–P2。Codex Review 因额度不可用，不作为本卡验收依赖。
- Conversation orchestration、Host gateway、App/navigation composition 的 broad refactor 继续 deferred，需未来单独决策与派卡。
