# Mira Mobile Tool Gateway V1

状态：MOB-041 implementation contract  
日期：2026-09-07  
范围：Mira Mobile Local Provider Agent -> paired Mira Host -> Harness / remote tools

## 1. V1 结论

Mira Mobile 的 Local Provider Agent 不在手机内启动 MCP、Shell、脚本或任意本地工具进程。

V1 工具链固定为：

```text
Local Provider on Mobile
  -> MobileAgentLoop
  -> ToolGatewayClient
  -> paired Mira Host Remote Gateway
  -> Harness
  -> built-in tools / approved external MCP
```

工具以远程执行为主。需要人工审批的具体调用在手机端完成批准或拒绝；真正的 Policy 校验、凭据持有和工具执行仍由 Mira Host / Harness 负责。

## 2. 身份与凭据

V1 Tool Gateway 是现有 paired Mira Host Remote Gateway 的一个受控能力面，不额外签发第三套用户可配置 Gateway secret。

认证继续使用配对后的 device credential，但工具权限使用独立 scope：

- `tools:read`
- `tools:invoke`
- `tools:approve`
- `tools:control`

Provider API Key 仍只保存在 Mobile Provider secure storage 中，不发送给 Host。

MCP Server 自身的 Bearer Token、环境变量或其它 secret 仍只由 Host 持有，不投影给 Mobile。

### 2.1 既有设备迁移

旧设备凭据不会静默获得新增 `tools:*` 权限。

缺少工具 scope 时：

- 既有 Remote Host 会话能力继续可用；
- Tool Gateway 返回本地可解释的权限缺失状态；
- Mobile 不因本地发现 scope 缺失而删除现有 pairing credential；
- 用户需要通过明确的重新配对 / 权限升级流程取得工具 scope。

## 3. Capability discovery

### 3.1 Manifest

`GET /remote/v1/manifest`

Host 在 `routes.tools` 中声明当前 Tool Gateway routes。

当前 V1 snapshot：

```text
GET  /remote/v1/tools
POST /remote/v1/tool-invocations/stream
POST /remote/v1/tool-invocations/:invocationId/approval
POST /remote/v1/tool-invocations/:invocationId/cancel
```

静态文档不是永久 allowlist。真实可调用条件同时依赖：

1. Remote Gateway 的 method/path -> scope 映射；
2. 当前 device credential 的实际 scope；
3. manifest 当前声明；
4. Harness 当前真实 exposure / availability；
5. exact invocation 的 Policy / approval 结果。

### 3.2 Tool list

`GET /remote/v1/tools`

只投影当前 Agent exposure 中的工具，不暴露 MCP Server 配置、secret、stdio command、远端 endpoint 或内部 compatibility primitive。

单个工具：

```ts
interface RemoteToolManifest {
  id: string;                    // Host canonical tool id
  name: string;                  // model-safe alias
  description: string;
  parameters: Record<string, unknown>;
  destructive: boolean;
  requiresApproval: boolean;
}
```

`id` 是 Host 真正执行的 canonical id。

`name` 是可传给 OpenAI-compatible `tools[].function.name` 的稳定安全别名。External MCP canonical id 可能包含 `:` 等模型 function name 不接受的字符，因此 Mobile 不允许自行从 name 猜回 id；真实映射由本次 discovery 保持。

## 4. Invocation

### 4.1 Request

`POST /remote/v1/tool-invocations/stream`

```json
{
  "toolId": "web_search",
  "args": {
    "query": "Mira"
  }
}
```

Mobile 只能提交 discovery 中出现的 canonical `toolId`。

Host 重新核对当前 Agent exposure，并通过现有 Harness 做 schema validation、Policy、approval 和 execution。

### 4.2 SSE events

V1 Mobile projection 只暴露：

```ts
type RemoteToolGatewayStreamEvent =
  | { type: "tool:start"; invocationId: string; toolId: string }
  | { type: "tool:progress"; invocationId: string; message: string }
  | {
      type: "tool:approval_required";
      invocationId: string;
      message: string;
      scope?: string;
    }
  | {
      type: "tool:error";
      code: string;
      message: string;
    }
  | {
      type: "tool:complete";
      invocation: RemoteToolInvocationProjection;
    };
```

Host 内部 stdout、trace、credential、MCP transport detail 和未经裁剪的 artifact 不直接进入 Mobile Agent context。

`tool:error` 是终止性安全错误事件：用于已经提交 SSE 响应后、但还未获得可投影 invocation 终态的失败。事件不得携带 raw secret-bearing error；发送后该 SSE 流结束。不可用 `toolId` 等可在提交 SSE 前确认的错误应继续使用普通 HTTP 4xx，而不是伪造 `tool:error`。

## 5. Result envelope

```ts
type RemoteToolInvocationProjection = {
  invocationId: string;
  toolId: string;
  status:
    | "completed"
    | "awaiting_approval"
    | "failed"
    | "cancelled";
  content?: string;
  approval?: {
    message: string;
    scope?: string;
  };
  error?: {
    code: string;
    message: string;
    retryable?: boolean;
    suggestedAction?: string | null;
  };
};
```

成功结果先由 Host 使用 Harness LLM projection 做有界化，再由 Mobile 的既有 tool-result byte limit 做第二层约束。

失败信息使用结构化 failure code 和安全摘要，不把 raw secret-bearing error 直接返回给模型。

## 6. Mobile approval

产品决定：需要人工审批的远程工具调用由手机端批准或拒绝。

### 6.1 Approval required

Host 返回：

```text
tool:approval_required
  -> tool:complete(status=awaiting_approval)
```

Mobile 保存：

- original `invocationId`
- model `callId`
- model-safe tool `name`
- 原始 arguments 字符串
- approval message / scope

MOB-042 负责把这些协议中立状态接进 UI。

### 6.2 Approve / reject

`POST /remote/v1/tool-invocations/:invocationId/approval`

```json
{
  "decision": "approved",
  "toolId": "terminal_session",
  "args": {
    "command": "pwd"
  }
}
```

拒绝时 `decision = rejected`。

批准不是一个裸 `approved: true`。

Host 必须：

1. 找到原始 awaiting-approval invocation；
2. 验证 invocation owner 等于当前 paired-device owner；
3. 验证 toolId 未变化；
4. 重新计算 args fingerprint；
5. 要求 fingerprint 与原 invocation 的 `inputHash` 完全一致；
6. 仅把这一 exact invocation 作为 approved invocation 重新交给 Harness；
7. 把原 invocation 链接到 resumed invocation。

参数变化后旧批准无效。

当前 Harness exact approval matcher 的真实实现仍是：

```text
toolId + inputHash
```

本卡不把 settled-but-not-yet-implemented 的 `toolCallId` matcher 漂移偷偷包装成已完成事实。

## 7. Cancellation

`POST /remote/v1/tool-invocations/:invocationId/cancel`

- running invocation：Host abort 对应真实 Harness `AbortController`；
- awaiting approval：按取消处理，不再执行；
- completed / failed：返回不可再取消的真实状态；
- invocation owner 不匹配时按不存在处理，不泄露其它用户 invocation。

Mobile 本地 AbortSignal 同时：

1. 终止本地 SSE；
2. 已知 invocationId 时请求远端 cancel。

## 8. Transport reliability

Discovery / manifest 等幂等读取可继续使用当前 Direct -> Relay fallback 规则。

可能真正执行工具的 mutation 不允许在“请求已发送但响应丢失”后盲目换 transport 重放：

- Tool invocation SSE：先用 manifest probe 选择可达 transport，再只在该 transport dispatch；Mobile 关闭 SSE 时 Host 必须把连接关闭绑定到该 invocation 的 Harness AbortSignal；
- Approval：先 probe，再单次 dispatch；响应不确定时返回 `TOOL_APPROVAL_UNCERTAIN`；
- Cancel：是针对同一 invocation 的幂等控制请求，可沿用 Remote JSON fallback。

## 9. Error semantics

Mobile 至少区分：

- pairing / scope unavailable
- tool unavailable
- schema invalid
- policy denied
- approval mismatch
- workspace escape
- timeout
- cancelled
- tool runtime failed
- incomplete stream
- uncertain approval dispatch

这些状态不能通过 raw provider/MCP error text 直接暴露 secret。

## 10. Credential and logging rules

不得进入 Mobile Tool Gateway payload、日志或模型上下文：

- Provider API Key
- device credential
- Relay token
- MCP bearer token
- MCP env secret
- Authorization header
- Host private MCP configuration

External MCP 继续使用 Host 已有 redaction。

## 11. Version and compatibility

本合同属于现有 Remote protocol V1 的 capability expansion，不另造第二套 session / pairing protocol。

兼容策略：

- 新 route 必须同时更新 Remote Gateway scope mapping、manifest、Mobile parser 和测试；
- 老 Mobile 不认识 `tools` route 时继续使用原 Remote 会话能力；
- 老 paired device 不自动获得 `tools:*`；
- Provider adapter、MobileAgentLoop 和 ToolGatewayClient 继续保持 transport-neutral，未来可以替换具体远程实现而不改 Chat UI。

## 12. MOB-041 与后续卡边界

MOB-041 完成：

- 本合同；
- Host Mobile-safe tool projection；
- exact approval / cancel / result contract；
- Mobile 真实 `ToolGatewayClient` Adapter；
- 合同与行为测试。

MOB-042 继续负责：

- `approval_required` / approval resolution 的 RuntimeEvent；
- 手机审批 UI；
- tool call / running / result / failure 的聊天状态呈现；
- approve/reject 后继续或终止 Agent Loop。

MOB-043 负责 durable Host / Pi Runtime，不由本合同伪装成长任务后台运行。

MOB-044 用真实 Android/iOS、真实 Provider、真实 Host/Gateway 做最终验收。
