# Mira Mobile 远程连接唯一真相源 V1

状态：Current canonical contract

适用分支：`dev`

最近修订：2026-11-24（MOB-092：退役旧配对 Relay）

本文定义 Mira Mobile 首次配对、配对后远程连接与 Remote capability discovery 的权威行为。其他移动端远程连接文档必须引用本文；如有冲突，以本文为准。

## 1. Transport 边界

Tailscale Direct 配对使用 `mira_device_*` 设备凭据和 scope；官方 Cloud Relay 使用独立的云身份、Client ticket 与 Host Grant。两者不互为备用通道。

自 MOB-092（2026-11-23）起，**扫码 / 粘贴 / `mira://pair` 深链这一新设备配对入口只面向 Tailscale Direct**：

- 配对 URI 必须携带可解析、满足既有安全要求的 `host`（Tailscale Direct HTTPS endpoint）；新配对入口识别 `*.ts.net` Tailscale Serve 域名及 `100.64.0.0/10` Tailnet IPv4 origin；拒绝普通公网 HTTPS、额外路径或 URL 参数。其他 Tailnet 广告格式需实际验证后再扩展；
- `relay`、`relayId`、`relayToken` 属于历史 Desktop 生产者字段；即使出现也只被忽略，不能参与 claim、poll 或新凭据的 Transport 选择；
- Relay-only 链接、缺少 Host 或 Host 无效时不发起 claim，并提示重新生成包含 Tailscale Direct 地址的二维码。

Cloud Relay 不依赖扫码。它通过 Mira Cloud 账号、Host 授权和既有 Cloud Relay 合同进入，由 [MOB-080 #274](https://github.com/uichat-mira/mira-mobile/issues/274) 等合同负责；本入口不得以 Relay 代替 Direct 完成配对。

2026-11-24 维护者裁决：旧配对的 Relay 兼容彻底退役。保留既有 Direct 身份，移除旧 Relay endpoint/token 与自动回退；Cloud Relay 和业务会话合同保持独立。活动 Tailscale / Cloud Relay 互斥与来源路由属于 A2，不在本文新入口语义内。

## 2. 新设备首次配对：Tailscale Direct-only

```text
扫码 / 粘贴 / mira://pair 深链
  -> 解析必须包含有效 host（Tailscale Direct）
  -> Direct /health preflight
  -> Direct /app/meta 识别 Mira Host 身份
      -> 成功：只通过 Direct 提交一次 claim
      -> /health 成功但不是 Mira Host：拒绝配对，不提交 claim
      -> Direct 网络不可达：显示 Tailscale 直连失败，不提交 claim
      -> Host 无效/不满足 HTTPS 要求：显示链接错误，不提交 claim
  -> claim 后只通过同一 Direct transport poll

relay / relayId / relayToken 出现时：
  -> 作为历史字段忽略
  -> 不探测 Relay、不提交 Relay claim、不把 Relay token 保存进新凭据

Relay-only / 缺少 host：
  -> 拒绝配对，提示在 Desktop 重新生成包含 Tailscale Direct 地址的二维码
```

`claim` 是一次性副作用。claim 发出后，即使响应超时、断网或状态不确定，也不得跨 Transport 自动重发，也不得改走 Relay；用户应回到 Desktop 确认是否已收到申请。

历史 Relay-first / Direct fallback 已退役，不再有执行入口。

## 3. claim 通道字段

Mobile 在 `/remote/pairing/claim` body 中发送：

```json
{ "transport": "direct" }
```

新配对入口只允许 `direct`。字段只用于 Desktop 展示和诊断，不参与认证、poll token、设备凭据、scope、审批或 endpoint 判定。旧版 Mobile 缺少该字段时，Desktop 显示“未知”，并继续完成配对；历史 Relay claim 不再由当前 Mobile 的新配对入口发起。

## 4. 配对后日常请求

所有 paired Remote Host 请求（JSON、SSE、角色、工作区、工具及恢复连接）只走保存的 Direct Host。Direct 不可达即明确报错；不会改走 Relay。一次性请求结果不确定时仍不得自动重放。

升级时安全存储将旧记录规范化：有 Direct Host 的记录保留 device credential、device ID、scope 和保存时间，擦除旧 Relay endpoint/token；仅 Relay 的记录删除本地配对凭据，用户须重新完成 Tailscale 配对。不会删除 Local Provider 或 Cloud Session，不调用 Cloud Relay，也不撤销服务端的 Host 授权。

## 5. Mobile 界面流程与文案

### 5.1 交互原则

- 用户只需要扫码或粘贴一条配对链接，不选择 Relay、Tailscale 或其他 Transport。
- 新配对链接必须包含 Tailscale Direct Host；页面明确这是 Tailscale 直连入口，不把 Mira Cloud 登录当作扫码配对前提。
- 主流程只表达用户任务和当前进度，不要求用户理解 endpoint、preflight、claim 等实现术语。
- 客户端只对所选 Direct Host 做可达性检查；Relay 不可作为新配对的静默兜底。
- 连接状态、失败原因和诊断信息放在配对结果与“连接详情”中，不作为主流程的设置项。

### 5.2 推荐主流程文案

```text
设备配对
仅通过 Tailscale 直连扫描 Mira Desktop 上的配对二维码

正在通过 Tailscale 直连提交设备申请…
等待桌面端批准

设备已连接
```

### 5.3 失败与不确定状态

Direct Host 不可达或无效时：

```text
无法通过 Tailscale 直连 Mira Desktop
请确认手机已加入同一 Tailscale 网络、Desktop 在线，
或让 Desktop 重新生成包含 Tailscale 直连地址的二维码。

重新尝试
```

仅含 Relay / 缺少 Direct Host 时：

```text
该配对链接缺少 Tailscale 直连地址
扫码、粘贴或深链配对仅支持 Tailscale 直连，
请在 Mira Desktop 重新生成二维码。
```

claim 已发出但响应不确定时：

```text
配对请求状态未知
请回到桌面端确认是否收到申请，不要重复提交。
```

“连接详情”可以显示当前尝试的 Direct Host、失败阶段和可操作建议。不得把 Relay 显示为新扫码配对的备用连接或可由用户切换的选项。

## 6. Desktop 对应要求

新设备扫码配对要求 Desktop 生成的二维码携带**可用的 Tailscale Direct `host`**。即使 Desktop 同时带有 Relay 字段，Mobile 也只使用 Direct。Desktop 收到 claim 后展示实际申请通道：Tailscale Direct。

如果当前 Desktop 只在二维码中广告 Relay endpoint、不携带 Direct Host，这是 Desktop 生产者缺口，不能由 Mobile 偷偷以 Relay 代替 Direct。需要先记录可复现事实并协调 Desktop 归属处理，不在 Mobile 单方面猜测新接口。

Cloud Relay 与 Cloud Host 授权继续按 Mira Cloud / MITS 合同执行，不通过扫码二维码传递。

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


### 7.2 Canonical Chat 追加合同（DSK-013 / MOB-082）

此合同适用于 **Cloud Auth + Relay** 与 **paired Remote Host（Direct）**，
只统一业务接口，不统一身份凭据或 Transport。

- 远程会话发送走 `POST /proxy/chat/default`，必须只携带**本轮一条 User 消息**、
  稳定 `messageId` 和 `appendAtTail.expectedTailMessageId`。
  后者为 Host 当前 canonical 末尾消息 ID；只有空线程才允许 `null`。
- 当前 Mobile 在发送前读取 Host `GET /threads/:id/messages` 来取得该游标。
  因此可用的 Chat 发送能力同时要求 `messages:read` 与 `messages:write`，
  以及 manifest 声明 `POST /proxy/chat/default`。
  此条件不改变 Thread 创建/删除自己的权限要求。
- Host 在同一 SQLite 事务检查 owner、线程末尾、重复消息 ID、上轮未完成状态。
  过期游标和未完成回合返回 409，不删历史、不新开 Provider/Agent/Tool。
  Mobile 不得因网络结果不确定自动把失败请求重放为新消息。
- 模型 Chat / RAG / Agent 上下文由 Host canonical 历史构造。
  Mobile 不上传 UI 全量历史；Desktop 本地明确选择祖先编辑分支的行为保持独立。
- 仅 Host 明确确认生成错误、标记 `failed` 后，用户才可以主动追加新回合。
  尚未判明结果的断线回合继续 `pending`，不能自动重放工具副作用。
- Agent 模式以 Host canonical 线程为准；`workspaceId=null` 不代表没有可用的
  Host 私有 Agent workspace，更不能绕过已有 Run 审批与 Tool Gateway 权限。

MOB-024 增加当前能力：

```text
## Current Connection Reliability Truth (2026-09-05)

- Relay idle connections have reproduced a 3-4 hour disconnect pattern. Treat
  this as a transport keepalive and app lifecycle defect, not a pairing defect.
- Desktop keeps its host WebSocket alive with native WebSocket control pings;
  the Relay V1 business frame contract is unchanged.
- Historical paired Relay resume refresh is retired; Cloud Relay owns its own socket lifecycle.
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

- 新扫码 / 粘贴 / `mira://pair` 深链：必须包含有效 Tailscale Direct Host；
- `host` + 历史 `relay` / `relayHint` / `relayToken`：只做 Direct preflight/claim/poll，不调用 Relay；
- Relay-only / 缺少 `host` / 无效 Host：准确报错且不产生 claim 副作用；
- Direct 不可达：无 claim；claim 已发出但响应不确定：保持 uncertain，不向 Relay 重发；
- 新配对成功保存的凭据带 Direct Host、不带二维码 Relay token，设备身份/manifest 校验继续执行；
- 旧混合凭据清除 Relay 字段并保留 Direct 身份；仅 Relay 凭据本地清除、需重新配对；Direct 断线不回退；
- Cloud Relay、远程会话与 Agent path 不因本卡被静默撤权或全局禁止；
- capability discovery 以实时 manifest + device scope 为准，不以旧固定 route 表为准；
- 已持有 `messages:write` 且 Host manifest 声明 `POST /threads` 的现有设备，无需重新配对即可创建 canonical Thread；
- manifest 未声明 route 或设备缺 scope 时，Mobile 不得尝试创建；
- 未显式映射的 Thread / Workspace 写 route 继续拒绝。
