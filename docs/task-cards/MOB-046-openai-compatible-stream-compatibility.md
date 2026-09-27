# MOB-046：OpenAI-compatible URL / SSE / Tool Call 兼容性修复

状态：**PASS**（2026-09-07 PR #100 已合入 `dev`；自动化、CodeRabbit Review 与卡内验收已收口；真实 Provider / 真机矩阵独立归 MOB-044）

范围：Mira Mobile Local Provider adapter

Base：`dev@7bc3556`

依赖：MOB-037、MOB-040

## 目标

修复当前 OpenAI-compatible adapter 在真实 Provider 上的三个协议兼容缺口：Base URL 重复 `/v1`、`[DONE]` 覆盖真实 `finish_reason`、多 tool-call streaming 按数组位置错误拼接。

## Must Read

- `AGENTS.md`
- `docs/remote-access/local-provider-agent-runtime-design.md`
- `docs/task-cards/MOB-037-mobile-dual-entry-local-provider-agent-runtime.md`
- `docs/task-cards/MOB-040-local-conversation-reliable-send-and-retry.md`
- `src/provider/openAiCompatibleClient.ts`
- `src/provider/openAiCompatibleClient.test.ts`
- `src/runtime/mobileAgentLoop.ts`
- `src/runtime/mobileAgentLoop.test.ts`
- `src/tools/toolPolicy.ts`

## Verified Context

- 当前 client 固定请求 `${baseUrl}/v1/chat/completions`。
- 用户填入常见的版本化 Base URL（如 `https://host/v1` 或 `https://host/api/v1`）会重复追加 `/v1`。
- 当前 `[DONE]` 会生成 `finish(reason: null)`；真实流若此前已经返回 `finish_reason: "tool_calls"`，Agent Loop 最后可能看到被覆盖的结束语义。
- 当前 streaming tool call 聚合 key 使用本次数组位置，而不是 delta 中的 `tool_calls[].index`；多工具并发分片可能串参。
- Tool Gateway 真实协议仍属于 MOB-041，本卡只修 Provider stream normalization，不实现 Gateway。

## Hard Constraints

- 继续保持 Chat Completions V1，不切 Responses API。
- 不新增厂商私有 SDK。
- 不改变 HTTPS / embedded credential 安全策略。
- 不把 Provider 特有字段泄漏到 ChatScreen。
- 不实现或猜测 MOB-041 的 Tool Gateway endpoint、鉴权或审批。
- 不用“只让现有测试通过”的方式保留错误的真实 SSE 语义。

## 功能范围

### Base URL

建立单一 URL resolver，至少兼容：

- `https://host` -> `https://host/v1/chat/completions`
- `https://host/v1` -> `https://host/v1/chat/completions`
- `https://host/api/v1` -> `https://host/api/v1/chat/completions`

不得生成 `/v1/v1/chat/completions`。若支持完整 endpoint 输入，必须有明确测试和文档，不得模糊猜测。

### SSE finish

- `finish_reason` 是模型轮次结束语义。
- `[DONE]` 只表示 SSE 传输结束，不得覆盖已经收到的 `finish_reason`。
- Tool calls 在真实 `finish_reason: "tool_calls"` + `[DONE]` 序列下必须进入下一轮 Agent Loop。

### Tool call aggregation

- 优先使用协议中的 `tool_calls[].index` 聚合分片。
- 若 Provider 不提供 index，可保留明确、测试覆盖的兼容 fallback。
- 多个 tool call 交错增量时 id/name/arguments 不得串到另一个 call。

## Execution Entry Points

- `src/provider/openAiCompatibleClient.ts`
- `src/provider/openAiCompatibleClient.test.ts`
- `src/runtime/mobileAgentLoop.ts`
- `src/runtime/mobileAgentLoop.test.ts`

## Acceptance

1. root Base URL 与 versioned Base URL 都得到正确 Chat Completions endpoint。
2. 标准 `finish_reason: "stop"` + `[DONE]` 只保留一次正确完成语义。
3. 标准 `finish_reason: "tool_calls"` + `[DONE]` 能让 Agent Loop 实际执行工具轮次。
4. 两个 tool call 的交错 streaming fragments 按 index 正确还原。
5. 现有取消、超时、网络错误、HTTPS 限制继续通过。
6. 普通文本 Local Provider 流式输出无回归。

## Validation

- 用接近真实 OpenAI Chat Completions SSE 的 fixture 补测试，不只手写单帧 happy path。
- Base URL table-driven tests。
- 多 tool-call interleaving test。
- `npm run typecheck`
- `npm run lint`
- 全量 Jest。
- Android debug build 至少一轮。
- 真 Provider matrix 留给 MOB-044。

## Unknown / Human Decision

None。本卡不决定 Tool Gateway 协议。

## Parallel / Integration

可与 MOB-045、MOB-047 从共同 base `7bc3556` 并行。若需要修改 RuntimeEvent 公共语义，必须先说明影响，避免和后续 MOB-042 形成隐式合同漂移。

## Handoff

先用测试复现上述三个兼容缺口，再修改实现。若真实仓库已经修复其中某项，不重复重写，只补缺失证据。


## Implementation Evidence

- PR #100 squash-merged into `dev` as `3ad288da`.
- Base URL endpoint resolution now covers `https://host`, `https://host/v1`, and path-prefixed `https://host/api/v1` without producing duplicate `/v1/v1`; Chat Completions V1 remains the only supported protocol.
- SSE `finish_reason` remains the model-turn semantic. `[DONE]` is treated as transport completion and no longer overwrites an already received `stop` / `tool_calls`; the legacy `finish: null` fallback is retained only for providers that finish with `[DONE]` and never emit a finish reason.
- Streamed tool calls are aggregated by protocol `tool_calls[].index`; array position is used only when the provider omits `index`. Interleaved fragments are kept separate and flushed deterministically by index.
- Split tool-call metadata is supported: an `id`-only fragment can be followed by a `function`-only fragment for the same index without losing the final `callId`.
- CodeRabbit identified one valid protocol edge case (dropping `id`-only tool-call fragments). It was fixed in `aa470112`, confirmed as addressed by CodeRabbit, and the review thread is resolved.
- Final head `aa470112`: Typecheck, Lint, full Jest, and Android debug APK build/upload all passed.
- `RuntimeEvent`, Tool Gateway / MCP contracts, HTTPS policy, embedded-credential rejection, and Provider-to-UI boundaries were not broadened.
- Real OpenAI-compatible Provider coverage and Android/iOS device matrix remain independently tracked under MOB-044 and do not block this card's PASS status.
