# MOB-042：本地 Agent Loop UI 与运行状态呈现

状态：**PASS**（2026-09-07 完成）

范围：Mira Mobile

依赖：MOB-037 运行时；MOB-041 Tool Gateway 协议合同

## 目标

把已有的前台 `MobileAgentLoop` 接入聊天界面，让用户能看懂本地 Agent 当前在做什么，以及为什么暂停、失败、取消或超时。

## 已确认的产品决定

- 本地 Provider Agent 的工具执行暂时以远程工具为主。
- 需要审批的远程工具调用在手机端完成批准或拒绝；Mobile 不直接执行工具，只控制对应远程 invocation 是否获准继续。

## 功能范围

- 本地对话显式开启 Agent 模式的入口和状态保持。
- 展示工具调用请求、调用中、工具结果、继续生成和完成状态。
- 消费 MOB-041 定义的审批 envelope，在协议中立 `RuntimeEvent` 中补齐 approval-required / approval-resolved 状态，并完成用户批准、拒绝后继续或终止本地 Agent Loop 的交互闭环。
- 展示工具被拒绝、参数无效、Gateway 不可用、超时、取消和结果过大的失败状态。
- 展示 App 挂起导致的暂停，并提供重新发送或交给持久运行时的明确动作（若运行时支持）。
- 保持普通本地对话与远程 Host Agent 审批 UI 的边界，不把两种状态混在一起。
- 复用现有 Chat 消息、取消、重试和滚动交互，不另起一套聊天页面。

## 非目标

- 不实现持久后台运行。
- 不实现未经 MOB-041 合同确认的真实 Tool Gateway 传输。
- 不显示完整 API Key、工具凭据或未脱敏工具参数。

## 验收标准

- 用户可以区分普通本地对话和本地 Agent 对话。
- 工具调用状态在流式过程中可见，且不会只依赖颜色表达。
- 需要审批的具体工具调用能够在手机端完成批准或拒绝；批准只能恢复对应的已冻结调用，拒绝后不会继续执行该调用。
- 取消、超时、挂起、工具失败和 Provider 失败均有可操作提示。
- 重试不会重复写入用户消息，也不会把工具结果重复追加到上下文。
- Remote Host 聊天和审批回归不受影响。

## 验收结果

- Mobile PR #104 已 squash merge，merge commit `2af3099af3a83e66722c76029bf012fa52aa7e16`。
- 本地会话 Agent 开关按 session 持久化，普通本地聊天与 Local Agent 仍复用同一 `ChatScreen`；本地 Agent 会话重新打开时不会误套 Remote Agent 的 Workspace 约束。
- `RuntimeEvent` 已形成 protocol-neutral 的 tool requested/running/result、approval-required/resolved、run-paused 与结果截断状态；手机端批准/拒绝恢复的是 MOB-041 冻结的同一 invocation。
- 用户取消、App 挂起/离开前台、总体超时、审批等待/审批请求超时、Gateway/Policy failure 与 approval uncertain 均有明确终态；App 挂起不会误显示为用户取消。
- 连续 Local Agent run 通过 run token 隔离审批状态，并在替换 run 时先取消旧 Provider client，避免旧请求继续消耗 Provider 配额。
- 最终 head `026f58ac`：Typecheck / Lint 全绿，Jest **67/67 suites、416/416 tests** 全绿；维护者最终自审无遗留 P0–P2。
- Android / iOS 真机长文本、键盘、滚动、真实 Host / Provider / Gateway 及网络矩阵继续由 MOB-044 汇总验收；本卡 PASS 不表示 MOB-044 已通过。

## 验证要求

- Runtime/UI 合同测试和状态机测试，覆盖 approval-required -> approve/reject -> continue/stop 闭环。
- Android / iOS 模拟器或设备的长文本、键盘、滚动和取消 smoke。
- 真 Gateway 联调必须引用 MOB-041 的协议版本和测试证据。
