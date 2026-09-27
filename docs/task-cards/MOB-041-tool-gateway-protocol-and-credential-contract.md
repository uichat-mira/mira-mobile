# MOB-041：Tool Gateway / MCP 协议与凭据合同确认

状态：**PASS**（2026-09-07 完成）

范围：Mira Mobile + Mira Host / Tool Gateway 协议协作

依赖：MOB-037 阶段 B 基础接口；不依赖移动端具体 UI 实现

## 目标

把 Local Provider 使用远程工具所需的协议边界确认成可实现、可测试、可审计的合同，避免移动端根据页面需求猜测 endpoint、鉴权、工具发现或审批行为。合同确认后，本卡同时负责按该合同完成最小真实 `ToolGatewayClient` Adapter 接通，避免协议完成后留下无人负责的真实传输缺口。

## 已确认的产品决定

- V1 工具能力暂时以远程执行为主；Mobile 不建设本地 MCP / Shell / 任意进程工具执行面。
- 需要人工确认的工具调用由手机端完成批准或拒绝；远程 Gateway / Runtime 负责真实 Policy 校验和工具执行，Mobile 只提交针对具体 invocation 的审批决定。

## 必须确认

- Tool Gateway 属于 Mira Host endpoint、独立服务，还是两者兼容。
- Local Provider 访问 Gateway 使用何种认证、设备授权和凭据轮换方式。
- 工具发现清单、工具名称、描述和 JSON Schema 格式。
- 工具调用请求、取消、超时、结果和错误 envelope，以及支持手机端批准/拒绝所需的 approval-required / approval-resolved 协议字段。
- 工具结果大小、敏感字段和日志脱敏规则。
- MCP 传输方式及其是否由 Gateway 代为承载。
- Tool Gateway 凭据与 Remote Host 凭据、Provider API Key 的存储和清除边界。

## 非目标

- 不在本卡实现移动端页面。
- 不在移动端启动 MCP 子进程、Shell 或任意本地工具。
- 未达成合同前，不新增真实 Gateway endpoint 或生产鉴权代码。
- 不在本卡扩展聊天 UI、Agent 状态 UI 或持久运行时；本卡真实实现仅限 `ToolGatewayClient` 所需的协议 Adapter。

## 交付物

- 版本化协议文档和示例请求/响应。
- 错误码、审批状态、取消和超时语义说明。
- 移动端可引用的 TypeScript 类型或生成来源。
- 脱敏、凭据隔离和兼容策略说明。
- 一组跨仓合同测试或可运行测试夹具。
- 基于已确认合同的最小真实 `ToolGatewayClient` Adapter，至少覆盖工具发现、调用、取消、错误映射与审批 envelope 的协议承接。

## 验收标准

- 移动端真实 `ToolGatewayClient` Adapter 已按确认合同接通，不需要页面或后续任务继续猜测字段、路由或传输语义。
- 认证失败、工具未授权、Schema 错误、超时、取消和结果过大均有明确语义。
- 合同没有允许任意 URL、任意本地进程或把 Provider Key 传给 Gateway 的路径。
- 变更记录包含兼容范围、版本策略和迁移说明。

## 2026-09-07 施工记录

已冻结并开始实现 V1 合同：[Mira Mobile Tool Gateway V1](../remote-access/mobile-tool-gateway-v1.md)。

当前施工结论：

- V1 具体 Gateway 落在已配对 Mira Host 的 Remote Gateway 能力面，底层复用现有 Harness / External MCP，不建设第二套工具执行系统。
- Provider API Key 不进入 Gateway；V1 使用 paired device credential 的独立 `tools:read / tools:invoke / tools:approve / tools:control` scope。
- 旧 paired device 不静默扩权；缺少 `tools:*` 时原 Remote 会话仍可使用，工具能力需要明确权限升级 / 重新配对。
- Host 只投影当前 Agent exposure 的工具定义；External MCP 继续受 connected / discovered / Agent Access 等既有门禁约束。
- Mobile 使用 model-safe tool name，Host canonical tool id 不由模型自行构造。
- Host approval 绑定原 invocation owner、toolId 和 inputHash；Mobile 改参数后旧批准无效。
- Mobile 真实 `RemoteToolGatewayClient` 已接入现有 `ToolGatewayClient` 抽象，批准交互本身继续由 MOB-042 接入 RuntimeEvent/UI。

## 验收结果

- Mira Host PR #117 已 squash merge，merge commit `576f9cb29a85f49e2c7ebf9936b72b90aad90182`。
- Mira Mobile PR #103 已 squash merge，merge commit `c7288610129ebd02a205a3ad88137b7c59ccde36`。
- Host 侧 Branch Policy 与 CodeRabbit 均通过；并发审批一次性消费、owner 绑定、SSE 断线取消、旧设备不静默扩权、External MCP exposure 等高优先级审查项已收口。
- Mobile final-head Typecheck / Lint / Jest 全绿（400 tests）；model-safe alias、manifest capability guard、pending cancel、approval detail fallback、Provider Key / paired credential 隔离均有合同或行为覆盖。
- 本卡不承担真实 Android/iOS + Host/Provider 端到端验收；该证据继续集中到 MOB-044，因此不阻塞本卡 PASS。

## 阻塞关系

MOB-041 的合同与最小真实 Adapter 已完成，MOB-042 的真实工具状态 UI 与后续运行时接线可基于本合同继续实施。MOB-043 的持久 Host / Pi Runtime 仍需其自身稳定运行时协议；MOB-044 继续负责真实 Android/iOS、Host、Provider、凭据与网络矩阵验收。
