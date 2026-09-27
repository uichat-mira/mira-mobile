# MOB-040：本地对话可靠发送与重试

状态：**REVIEW**（2026-09-06 代码与自动化验证完成，待功能验收）

范围：Mira Mobile

依赖：MOB-037 Local Provider Runtime；MOB-038 Provider 归属会话；MOB-039 双入口来源选择

## 目标

让本地 Provider 对话在网络抖动、用户点击重试和请求取消时保持可解释、可恢复的消息状态，不重复写入同一条用户消息，也不把取消与超时混成同一种结果。

## 功能范围

- 本地会话仓储按消息 ID 幂等追加消息。
- 使用相同 `messageId` 重试时，不重复写入用户消息。
- 重试请求继续使用该会话所属 Provider，不受当前 Provider 配置切换影响。
- 保留 Provider 取消、超时、网络失败的底层错误语义，供聊天层显示可操作提示。
- 不改变 Remote Host 的稳定 `messageId` 重试合同。

## 非目标

- 不实现后台任务续跑。
- 不改变 OpenAI-compatible Provider endpoint 或请求字段。
- 不新增 Tool Gateway / MCP 协议。
- 不自动重试可能产生副作用的 Provider 请求。

## 验收标准

- 相同用户消息 ID 重试后，本地 transcript 中只出现一条用户消息。
- 重试使用原会话的 Provider 和模型。
- Provider 请求取消显示为已取消，超时显示为请求超时，网络失败显示为无法连接 Provider。
- 失败后重新发送不会覆盖或删除已有本地消息。
- Remote Host 会话、流式消息和审批回归保持通过。
- Android / iOS 真机完成弱网、取消、超时和重试验证后才可升为 `PASS`。

## 当前实现

- `LocalSessionRepository.appendMessages` 已按消息 ID 去重。
- `LocalProviderRuntime.sendMessage` 在发送前检查消息是否已经记录，避免重试重复追加并保持原会话上下文。
- 新增仓储幂等测试；Provider 取消和超时沿用 `OpenAiCompatibleClient` 的明确错误码。

## 自动化验证结果

- `src/local/localSessionRepository.test.ts`：消息 ID 幂等追加通过。
- `src/provider/openAiCompatibleClient.test.ts`：正常 SSE、取消、超时和 HTTPS 策略通过。
- `src/screens/chatSessionState.test.ts`：本地 Provider 发送失败文案映射通过。
- 全量 Jest：65 个测试套件、359 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 error；保留仓库既有 warning。
- `git diff --check`：通过。

## 待功能验收

- Android / iOS 真机弱网、取消、超时和重试行为。
- 真 Provider 失败响应与恢复后的本地 transcript 检查。
