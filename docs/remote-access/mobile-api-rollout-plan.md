# Mira Mobile API 接入清单与排期

> 状态：Current plan  
> 基线日期：2026-08-12  
> Mobile 分支：`dev`  
> 主站真相源：`dangjingtao/uichat-mira@dev`

## 1. 规则

Mobile 只消费 Mira Host 已定义的 canonical HTTP contract，不使用 Desktop 用户名/密码/JWT 绕过 Remote Gateway。

“主站已有接口”不等于 `mira_device_*` 当前可调用。除当前 Remote Host V1 allowlist 外，所有新增能力都必须先由 Mira 主项目 `dev` 明确 Remote scope、allowlist、资源归属和错误语义，然后 Mobile 才接入。

当前聊天只接普通 Chat：Thread / Message / `POST /proxy/chat/default`。本排期不扩 Agent UI。

**Relay 是业务能力之前的 Transport 前置工程。** Mobile 先完成 Direct / Relay 统一传输层，再继续 Memory、文件库、Workspace 等业务接入。详细 Relay 施工计划见：

- [`relay-mobile-rollout.md`](relay-mobile-rollout.md)

## 2. 当前已经可用：Chat + Tailscale 基线

以下接口已经在 Remote Host V1 canonical allowlist 中，可由 Mobile 的设备凭证直接调用：

| Mobile 功能 | Method | Route | 状态 |
| --- | --- | --- | --- |
| 校验设备授权 / 能力 | GET | `/remote/v1/manifest` | 已接入 |
| 会话列表 | GET | `/threads` | 已接入 |
| 会话详情 | GET | `/threads/:id` | 已接入 |
| 消息列表 | GET | `/threads/:id/messages` | 已接入 |
| 普通聊天发送 / SSE | POST | `/proxy/chat/default` | 已接入 |
| Thread 内媒体读取 | GET | `/threads/:id/media/:mediaId/content` | Host 已允许；按消息媒体需要接入 |

当前边界继续保持：不开放 Thread 新建、重命名、删除；不把 Agent 当 Chat 一起接入。

当前配对仍然是 Tailscale-gated：Desktop 创建 pairing challenge 时要求 Tailscale `ready`。这只是当前基线，不是 Relay 最终产品形态。

## 3. Transport 前置：Mira Relay — 优先级 P0

目标不是再造一套 Mobile API，而是让同一个 `RemoteMiraHostClient` 可以运行在两种 Transport 上：

```text
RemoteMiraHostClient
  -> DirectRemoteTransport -> HTTP / SSE -> Tailscale Serve
  -> RelayRemoteTransport  -> WSS Relay Frames -> Desktop Relay Connector
```

两种 Transport 共用同一个 `mira_device_*` 业务 credential、scope、manifest 与业务 route。

当前主站 `dev` 已有：

- Relay Worker / Durable Object POC；
- Desktop Relay Connector；
- request / response / chunk / complete / cancel / error frame；
- Relay 产品配置；
- Desktop 自动生成 relayId / hostToken / clientToken；
- pairing URI 可追加 `relay` / `relayId`。

当前仍缺：

- Mobile `RelayRemoteTransport`；
- Relay client credential 的安全下发与保存合同；
- Relay-only pairing；
- 同一设备多 endpoint；
- Direct -> Relay 自动 fallback；
- pairing 去掉 Tailscale ready 硬耦合。

Mobile Relay 分阶段：

```text
R0 RemoteTransport 抽象
R1 Relay JSON / manifest / threads
R2 Chat stream / cancel / reconnect
R3 Relay-only pairing + pairing endpoint 解耦
R4 Auto Direct -> Relay fallback
```

Mobile 不得自行发明 clientToken 下发方式；必须等待 Mira 主项目 `dev` canonical contract。

## 4. 主站已有、Mobile 可以排期接入的业务接口

### 4.1 Memory — 优先级 P0

对应 Mobile：设置 → 我的 Mira →「记忆」。

主站已有完整 Memory surface：

```text
GET    /memory
PUT    /memory/settings
POST   /memory
PATCH  /memory/:id
DELETE /memory/:id
```

Mobile 目标：

- 展示记忆开关和记忆列表；
- 支持新增、编辑、删除手工记忆；
- 由 Host 返回真实状态，不做本地伪同步。

依赖：主项目新增设备凭证可用的 Memory Remote contract。

### 4.2 文件库 / Knowledge Base Documents — 优先级 P0

产品定义：Mobile「文件库」优先映射 Mira Host 的 Knowledge Base documents，不等同于聊天附件目录。

第一批建议开放：

```text
GET  /knowledge-bases
GET  /knowledge-bases/:knowledgeBaseId
GET  /knowledge-base/documents
GET  /knowledge-bases/:knowledgeBaseId/documents
GET  /knowledge-base/documents/:id/status
GET  /knowledge-bases/:knowledgeBaseId/documents/:id/status
GET  /knowledge-base/documents/:id
GET  /knowledge-bases/:knowledgeBaseId/documents/:id
POST /knowledge-base/documents/upload
POST /knowledge-bases/:knowledgeBaseId/documents/upload
```

第二批按 Mobile UI 需要再开放，不作为首轮阻塞项：

```text
POST   /knowledge-base/documents
POST   /knowledge-bases/:knowledgeBaseId/documents
PATCH  /knowledge-base/documents/:id
PATCH  /knowledge-bases/:knowledgeBaseId/documents/:id
DELETE /knowledge-base/documents/:id
DELETE /knowledge-bases/:knowledgeBaseId/documents/:id
```

Mobile 首轮目标：知识库切换、文档列表、详情/状态、手机文件选择与上传。首轮不急着做复杂编辑和删除。

依赖：主项目定义 Knowledge Base read/upload 的 Remote 权限边界和上传限制。

### 4.3 项目 = Chat Workspace — 优先级 P0

产品定义已确认：Mobile UI 的「项目」就是 Mira Host 的 **Chat Workspace**；UI 可以继续显示“项目”，代码/协议使用 `workspace` / `workspaceId`。

主站已有：

```text
GET    /chat-workspaces
POST   /chat-workspaces
PATCH  /chat-workspaces/:id
DELETE /chat-workspaces/:id
```

现有 Thread mutation model 已包含 `workspaceId`。Mobile 首轮目标：

- 项目列表；
- 创建 / 重命名 / 删除 Workspace；
- 展示属于 Workspace 的会话；
- Search 页「项目」tab 使用 Workspace 语义。

注意：当前 `GET /threads` 没有 `workspaceId` 查询参数。若 Thread list 响应包含 `workspaceId`，Mobile 可先在客户端分组；如果主站希望服务端筛选，应由主站另行增加 canonical query contract，Mobile 不猜字段。

依赖：主项目新增 Workspace Remote contract；若需要“把现有 Thread 移入项目”，还需同时决定是否对设备凭证开放对应 Thread update 能力。

### 4.4 Plugins / MCP — 优先级 P1

对应 Mobile：Drawer / 设置里的「插件」。

首轮只做浏览和状态，避免手机端直接承担复杂 MCP 管理：

```text
GET /mcp/marketplace/servers
GET /mcp/marketplace/sync-status
GET /mcp/external/servers
```

第二批再考虑安装/连接/启停等 mutation。Mobile 不直接暴露 stdio 命令、Host 文件路径或敏感 MCP config。

依赖：主项目定义 Mobile-safe 的 MCP projection 和可管理边界。Desktop 全量 MCP API 不应原样放行给设备凭证。

### 4.5 Voice / Host TTS — 优先级 P1

对应 Mobile：设置 →「语音」，以及后续 Assistant 消息朗读。

> 现状：设置页中的「语音」占位行已移除（无 actionId、点击无行为），本节的 Voice / TTS 入口随该能力真正落地时重新加入设置 IA。

Mobile 只需要消费 Host 已配置好的 TTS，不管理 Provider 密钥和模型配置：

```text
GET  /microapps/tts/overview
GET  /microapps/tts/voices?providerId=...
POST /microapps/tts/syntheses
GET  /microapps/tts/syntheses/:id
GET  /microapps/tts/syntheses/:id/audio
```

GPT-SoVITS/Provider 配置、参考音频管理等高级接口暂不进入 Mobile 首轮。

依赖：主项目定义 Mobile-safe TTS contract，避免把 provider administration 一起放行。

### 4.6 Images — 优先级 P2

对应 Mobile：Drawer「图片」与 Search「图片」。

主站已有 Image Generation job surface，可作为“生成图片”能力基础：

```text
POST /microapps/image-generation/generations
GET  /microapps/image-generation/generations/:id
GET  /microapps/image-generation/generations/:id/progress
```

主站也已有 Thread-scoped media read：

```text
GET /threads/:id/media/:mediaId/content
```

但当前没有一个已经确认的“全局图片库 / 历史图库”查询合同。因此 Mobile 首轮可以做生成任务和 Thread 内媒体展示；Drawer 的「图片」要变成真正图库前，主站还需提供持久化列表/query contract。

依赖：先确认 Mobile「图片」首版是生成入口还是图库，再由主项目补 Remote contract。

### 4.7 About / Host Meta — 优先级 P2

主站已有：

```text
GET /app/meta
```

适合 Mobile 展示“已连接 Host”的版本、仓库/主页等 Host 元信息。

注意：这不是 Mobile App 自身的版本更新接口；Mobile 版本仍以移动端 package/release 为准。

## 5. 当前不要接的 Desktop 接口

以下主站能力即使存在，也不应直接映射为 Mobile 设备能力：

- `GET /me`：这是 Desktop 用户 JWT 语义，不是 paired-device profile contract；
- `/account/change-password`：Mobile 不使用 Desktop 账号密码作为连接身份；
- `/general-settings`：包含 Host/Backend 设置（例如 SOCKS5），不是通用 Mobile 设置；
- TTS Provider / API key 管理；
- MCP stdio / Host 本地路径等敏感配置；
- Provider / Model / secret 管理；
- Agent / Tool 全量接口（当前聊天排期明确只接普通 Chat）。

## 6. Mobile 总排期

排期原则：日期是 **Mobile 实施窗口**，前提是对应 Mira Host canonical contract 已在主项目 `dev` 落地。若 Host contract 未到位，该项标记 Blocked，不能通过 Desktop JWT 或自定义私有 endpoint 绕过。

| 阶段 | 日期 | Mobile 交付 | Host 依赖 |
| --- | --- | --- | --- |
| M0 | 已完成，至 2026-08-12 | Tailscale 配对、manifest、会话读、消息读、普通 Chat SSE、重连 | Remote Host V1 |
| R0 | 2026-08-12 | `RemoteTransport` 抽象 + `DirectRemoteTransport`，行为不变 | 无新协议依赖 |
| R1 | 2026-08-13 ～ 08-14 | `RelayRemoteTransport`、manifest、threads 经 Relay | Relay client credential + endpoint + hello/auth canonical contract |
| R2 | 2026-08-15 | Chat SSE/chunk、cancel、reconnect 经 Relay | Relay streaming contract |
| R3 | 2026-08-16 | Relay-only pairing；配对 UI 去 Tailscale 硬耦合 | pairing endpoint / Relay credential delivery canonical contract |
| R4 | 2026-08-16 | 多 endpoint + Auto Direct -> Relay fallback | endpoint persistence / selection contract |
| M1 | 2026-08-17 ～ 08-18 | Memory 页面真实接入；Host Meta adapter | Memory + app meta Remote contract |
| M2 | 2026-08-19 ～ 08-21 | 文件库：KB 列表、文档列表/详情/状态、手机文件上传 | KB read/upload Remote contract |
| M3 | 2026-08-22 ～ 08-23 | 项目/Workspace：列表、CRUD、Workspace 会话分组；Search 项目 tab | Workspace Remote contract；必要时 Thread workspace mutation |
| M4 | 2026-08-24 ～ 08-25 | Plugins 首轮只读；Voice 列表、合成、音频播放 | Mobile-safe MCP projection + TTS Remote contract |
| M5 | 2026-08-26 ～ 08-28 | Images 生成任务、进度、Thread media；决定是否启用图片搜索/图库入口 | Image Generation Remote contract；图库 query 若需要则另补 |

### 每一期 Mobile 的固定完成条件

每个阶段只有同时满足以下条件才算完成：

1. main Mira `dev` 文档已经定义对应 Remote / Relay route、credential、scope、ownership；
2. `RemoteMiraHostClient` 只消费类型化 Transport / adapter，不允许页面直接 fetch；
3. `manifest` 能表达 Mobile 实际获得的业务能力，UI 根据 capability 显示/禁用；
4. 401/403 与普通网络失败分开处理，不因断网或 Relay 故障清除设备凭证；
5. Android/iOS 共用业务协议层；平台差异只放设备能力层；
6. `npm run typecheck`、`npm run lint`、`npm test` 通过；涉及原生能力时再要求对应平台构建/真机验证。

## 7. 后续未排期能力

这些 Mobile 视觉项目前没有足够的 Host canonical surface，不给假日期：

- 「已计划」：需要真正的 scheduler / automation domain；不能拿 Agent planner 冒充；
- 「通知」：需要 push / notification settings contract；
- 「个性化」：需要 tone / traits / quick answer / custom instructions 的持久化 contract；不能拿 Memory API 顶替；
- 「报告错误」：需要 feedback/report surface；
- 全局 Search 的图片/文档/项目统一搜索：需要各 domain 的可查询 contract 或统一 search contract；
- 泛化「设备同步」：当前只有 Remote Host canonical state replay，不代表所有设置跨设备同步。

## 8. 实施顺序

Mobile 后续开发按下面顺序执行，不因页面已经画出来而跳级：

```text
Chat / Tailscale baseline
  -> Relay Transport
  -> Memory
  -> File Library
  -> Workspace
  -> Plugins (read-first)
  -> Voice
  -> Images
```

业务 adapter 必须运行在统一 `RemoteTransport` 之上，不能分别维护“一个 Tailscale API client + 一个 Relay API client”。

主站合同晚于 Mobile 排期时，Mobile 保留真实 placeholder/disabled 状态；主站合同一旦到位，按本表进入对应阶段，不重新讨论产品映射。
