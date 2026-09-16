# MOB-045：Local Provider 会话生命周期闭环

状态：**REVIEW**（2026-09-07 PR #99 已合入 `dev`；自动化与 AI Review 收口，真机验收挂 MOB-044）

范围：Mira Mobile

Base：`dev@7bc3556`

依赖：MOB-037、MOB-038、MOB-039

## 目标

补齐 Local Provider 本地会话的删除生命周期。当前本地会话可以创建和持久化，但列表不允许删除；同时 Provider 仍有本地会话时禁止删除配置，导致用户一旦创建过会话就无法正常清理该 Provider。

## Must Read

- `AGENTS.md`
- `docs/workbench/00-work-ledger.md`
- `docs/task-cards/MOB-037-mobile-dual-entry-local-provider-agent-runtime.md`
- `docs/task-cards/MOB-038-local-provider-profiles-and-session-creation.md`
- `src/local/localSessionRepository.ts`
- `src/runtime/localProviderRuntime.ts`
- `src/runtime/runtimeRegistry.ts`
- `src/screens/SessionListScreen.tsx`
- `src/screens/SessionSwipeRow.tsx`
- `src/screens/LocalProviderConfigScreen.tsx`

## Verified Context

- Local Provider transcript 是设备本地事实，不属于 Remote Host canonical state。
- `LocalSessionRepository` 当前没有单会话删除能力。
- `SessionListScreen` 当前对 Local Provider 隐藏删除动作，并且删除实现直接调用 `miraHostClient.deleteSession`。
- Provider 配置存在本地会话时会阻止删除，这是正确的数据归属保护；缺失的是先删除本地会话的闭环。
- 置顶 / 未读是设备本地状态；删除会话后不得留下孤儿状态。

## Hard Constraints

- 不把 Local Provider 删除请求发到 Mira Host。
- 不因为方便而级联删除 Provider 下全部会话。
- 不改变 Remote Host 删除合同和确认语义。
- 页面不直接绕过 Runtime / Repository 边界拼接存储 JSON。
- 不修改 Tool Gateway、Agent Loop 或 Provider 协议。
- 不顺手做目录重构。

## 功能范围

- 为本地仓储增加按 `sessionId` 删除单个会话的能力。
- 通过明确的 runtime/registry 边界让列表能够删除 Local Provider 会话。
- Local Provider 删除确认文案明确“仅删除当前设备上的本地对话”，不得写成“同步删除桌面端线程”。
- 删除成功后清理对应本机 pin / unread 状态。
- 删除最后一个本地会话后，Provider 配置可以按既有规则正常删除。
- 删除失败必须保留会话并显示可操作错误，不伪装成功。

## Execution Entry Points

- `src/local/localSessionRepository.ts`
- `src/local/localSessionRepository.test.ts`
- `src/runtime/localProviderRuntime.ts`
- `src/runtime/runtimeRegistry.ts`
- `src/screens/SessionListScreen.tsx`
- `src/screens/SessionSwipeRow.tsx`
- 相关 session source / swipe contract tests

## Acceptance

1. Local Provider 会话显示删除动作。
2. 删除确认明确说明仅影响当前设备本地会话。
3. 确认删除后，该会话从本地列表和 Drawer 消失。
4. 同一会话的本机 pin / unread 状态被清理。
5. 删除失败时列表不消失，用户看到错误。
6. 删除 Provider 前仍有会话时继续阻止；会话全部删除后可删除 Provider。
7. Remote Host 删除行为与文案保持原合同。

## Validation

- 新增 LocalSessionRepository delete 测试：成功、未知 session、其它 Provider 会话不受影响。
- 增加 Local / Remote 删除路由合同测试。
- `npm run typecheck`
- `npm run lint`
- 全量 Jest。
- Android debug build 至少一轮。
- 真机删除交互留给 MOB-044 汇总验收。

## Unknown / Human Decision

None。

## Parallel / Integration

可与 MOB-046、MOB-047 从共同 base `7bc3556` 并行。不得修改它们负责的 OpenAI SSE / API Key UX 逻辑。合入后 MOB-048 必须基于最新 dev 重新读取代码再施工。

## Handoff

施工前先核对 Must Read 与当前 HEAD；若当前代码已变化导致上述事实不成立，先报告冲突，不要按旧卡强行覆盖。


## Implementation Evidence

- PR #99 squash-merged into `dev` as `1062e0c2`.
- `LocalSessionRepository` 支持按 `sessionId` 删除单个本地会话；未知会话删除失败且不改写存量数据。
- `RuntimeRegistry.deleteSession` 按显式 `SessionSource` 路由 Local / Remote；仅在 source 缺失时使用 `local-` 前缀兜底，避免远程会话误路由。
- Local Provider 删除确认明确“仅删除当前设备上的本地对话，不影响 Mira Host”；Remote Host 原删除合同与文案保持不变。
- 删除成功后清理本机 pin / unread；删除失败保留会话并展示错误。删除最后一个本地会话后，既有 Provider 删除保护自然解除。
- CodeRabbit 首轮提出两项有效问题并已在 `e0a99c0` 修复：本地仓储复合写竞争、显式 source 被 ID 前缀覆盖。两项均获 CodeRabbit 后续确认，review thread 已 resolved。
- 最终 head `e0a99c0`：Typecheck、Lint、全量 Jest 通过；Android debug build 通过。
- Android / iOS 真机删除交互、Provider 删除解锁与跨页面刷新继续由 MOB-044 汇总验收，因此本卡保持 `REVIEW`，不提前标记 `PASS`。
