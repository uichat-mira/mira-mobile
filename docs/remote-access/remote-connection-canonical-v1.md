# Mira Mobile 远程连接唯一真相源 V1

状态：Current canonical contract

适用分支：`dev`

最近修订：2026-08-29

本文定义 Mira Mobile 首次配对、配对后远程连接与 Remote capability discovery 的权威行为。其他移动端远程连接文档必须引用本文；如有冲突，以本文为准。

## 1. Transport 边界

Mira Mobile 与 Mira Host 共用同一套 `mira_device_*` 设备凭据和 scope。Relay 与 Tailscale Direct 都只是 Transport，不负责业务授权、scope 判定、Agent、Provider 或消息事实。

二维码可以携带：

- `host`：可选的 Tailscale Direct HTTPS endpoint；
- `relay`、`relayId`、`relayToken`：可选的 Mira Relay endpoint。

必须至少存在一种可达 endpoint。Relay-only 配对不要求 Tailscale 已开启。

对用户而言，Relay 与 Tailscale Direct 不是两种需要选择的连接模式，而是客户端内部自动选择的传输路径。

## 2. 首次配对：Relay-first

```text
有 Relay endpoint
  -> Relay /health preflight
  -> 成功：只通过 Relay 提交一次 claim
  -> Relay transport error：claim 前检查 Direct
      -> Direct 成功：只通过 Direct 提交一次 claim
      -> Direct 失败：显示连接失败，不提交 claim

无 Relay endpoint
  -> 检查 Direct
  -> Direct 成功：提交一次 claim
```

`claim` 是一次性副作用。claim 发出后，即使响应超时、断网或状态不确定，也不得跨 Transport 自动重发；用户应回到 Desktop 确认是否已收到申请。

## 3. claim 通道字段

Mobile 可在 `/remote/pairing/claim` body 中发送：

```json
{ "transport": "relay" }
```

允许值为 `relay`、`direct`。字段只用于 Desktop 展示和诊断，不参与认证、poll token、设备凭据、scope、审批或 endpoint 判定。旧版 Mobile 缺少该字段时，Desktop 显示“未知”，并继续完成配对。

## 4. 配对后日常请求

配对完成后的业务请求使用 Direct-first：

```text
Direct 可用 -> Direct
Direct 网络/传输失败 -> Relay
401/403、业务 HTTP 错误、协议解析错误 -> 不跨 Transport fallback
```

Transport 切换不能删除、重建或改变已经批准的 `mira_device_*` 身份。

## 5. Mobile 界面流程与文案

### 5.1 交互原则

- 用户只需要扫码或粘贴一条配对链接，不选择 Relay、Tailscale 或其他 Transport。
- 主流程只表达用户任务和当前进度，不要求用户理解 endpoint、preflight、claim 等实现术语。
- 客户端自动按 Relay-first、Direct fallback 执行；只有两条路径都失败时才要求用户介入。
- Relay 与 Tailscale 的实际状态、切换原因和诊断信息放在“连接详情”中，不作为主流程标题或前置条件。

### 5.2 推荐主流程文案

```text
设备配对
扫描 Mira Desktop 上的二维码

正在连接桌面…
我们会自动选择可用的安全连接

等待桌面端批准

设备已连接
```

### 5.3 失败与不确定状态

两条 Transport 都不可用时：

```text
暂时无法连接桌面
请确认桌面端仍在等待配对。
我们已尝试所有可用连接方式。

重新尝试
查看连接详情
```

claim 已发出但响应不确定时：

```text
配对请求状态未知
请回到桌面端确认是否收到申请，不要重复提交。
```

“连接详情”可以显示当前尝试的 Transport、备用 Transport、失败阶段和可操作建议，例如“当前尝试：Mira Relay”“备用连接：Tailscale Direct”。这些信息不得被设计成用户必须选择的设置。

## 6. Desktop 对应要求

Desktop 创建配对挑战时，只要 Relay connected 或 Direct ready 任一成立即可；二维码同时携带当前可用 endpoint。收到 claim 后展示实际申请通道：Mira Relay、Tailscale Direct 或未知。

## 7. Remote capability 合同

自 **2026-08-29** 起，旧 V1 文档中的**固定 route allowlist 失效**，不再具有规范效力。这里失效的是“V1 的能力集合由一张静态 route 表永久冻结”的规则，**不是整个 Remote Host V1 协议**：pairing URI、device credential、Transport、消息协议与 `protocolVersion: 1` 均保持兼容。

Mobile 判断某项远程能力可用时，必须同时满足：

1. Host Remote Gateway 对当前 `method + path` 有显式 scope 映射；
2. 当前 paired device 实际持有该 scope；
3. `/remote/v1/manifest` 在对应 route group 中声明该 route；
4. canonical Host route 继续执行 owner-user 与业务数据边界校验。

因此，**runtime manifest + device scope 是客户端 capability discovery 的权威事实**。文档可以记录当前 route 快照，但不能再用历史静态列表否决已经通过 Gateway + manifest 明确发布的新能力。

### 7.1 Durable Agent Run 控制语义（MOB-043）

- Host `AgentRun` 是长任务、审批暂停、恢复和取消的唯一运行事实源；Mobile 只观察和控制，不在本地重建可执行 Run。
- V1 没有事件游标；Mobile 通过 canonical message + `GET /agent/runs/:runId` 重放当前状态。前后台切换或页面失活只停止本地观察，不等价于取消 Host Run。
- `approve` / `reject` / `cancel` 只有在 device scope 与 manifest route 同时允许时才可调用；Mobile 必须先读取并校验 canonical Run 的线程归属。
- `POST /agent/runs/:runId/cancel` 对已经 `completed`、`failed`、`blocked` 或 `cancelled` 的终态 Run 是幂等操作：HTTP 200 返回原 Run，**不会把终态强行改写成 `cancelled`**。
- 因此客户端不得把“cancel 返回 200”解释成“取消一定成功生效”；必须以响应体中的 `Run.status` 为最终事实。


MOB-024 增加当前能力：

```text
## Current Connection Reliability Truth (2026-09-05)

- Relay idle connections have reproduced a 3-4 hour disconnect pattern. Treat
  this as a transport keepalive and app lifecycle defect, not a pairing defect.
- Desktop keeps its host WebSocket alive with native WebSocket control pings;
  the Relay V1 business frame contract is unchanged.
- Mobile must drop stale Relay sockets when the app returns to the foreground.
  The next request is then allowed to create a fresh Relay connection.
- Background JavaScript timers are not a reliable keepalive mechanism. Active
  requests and streams fail fast on close and are not silently replayed.

POST /threads -> messages:write
```

这是针对现有 0.2.x 已配对设备的显式兼容决定。已经持有 `messages:write` 的设备在 Host manifest 声明 `POST /threads` 后可以直接创建 canonical Thread，**无需重新配对**。

该决定不扩展到以下能力，它们继续保持未授权：

```text
PATCH /threads/:id
POST /threads/:id/archive
POST /threads/:id/restore
DELETE /threads/history
Workspace create / update / delete
```

后续若新增语义更精确的 `threads:write`，必须提供显式 scope 迁移方案，不能让旧设备在无感知情况下获得新的权限集合。

## 8. 验收

- Relay + Direct：先 Relay `/health`，成功后只发 Relay claim；
- Relay preflight 失败：claim 前才切 Direct；
- Relay claim 已发出：不向 Direct 重发；
- Relay-only：无需 Tailscale 完成配对；
- Direct-only：旧二维码继续可用；
- 缺少 `transport`：兼容旧 Mobile；
- 配对后 Direct 网络失败：可回 Relay；
- 401/403 与业务错误：不触发 Transport fallback；
- capability discovery 以实时 manifest + device scope 为准，不以旧固定 route 表为准；
- 已持有 `messages:write` 且 Host manifest 声明 `POST /threads` 的现有设备，无需重新配对即可创建 canonical Thread；
- manifest 未声明 route 或设备缺 scope 时，Mobile 不得尝试创建；
- 未显式映射的 Thread / Workspace 写 route 继续拒绝。
