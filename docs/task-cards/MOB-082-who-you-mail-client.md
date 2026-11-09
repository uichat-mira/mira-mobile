# MOB-082：Who You 邮箱客户端接线（读信 + 草稿确认发送）

状态：**待启动**

执行仓库：`uichat-mira/mira-mobile`（本卡）；服务端契约归 `uichat-mira/who-you`

依赖：Who You S2/S4 已合入 `dev`；Cloud Auth `/v1/service-credentials` 可签发 `mira:who-you` 凭证

## 背景

Who You 是 Mira 的 `@tomlab.cn` 邮箱，服务端通过单一 `/mcp` 资源 + RFC 9728 discovery 暴露 `whoyou_*` 工具。客户端目前没有任何邮箱入口，也没有调用 Cloud Auth 服务凭证的能力。

S5 要求把服务端能力接到用户可见体验：看地址、看收件箱/线程/正文/附件、起草、**对具体草稿确认后才发送**、看到回执与失败状态。

桌面端由 `mira-desktop` 独立卡 `who_you_T001` 承担，本卡不修改 Desktop / Host / 服务端仓库。

## 已定裁决

1. 两端同步推进，各自独立卡与 PR；本卡只负责 Mobile。
2. 确认凭证只在**内存**中持有，发送前即时获取；不写入 secure store、不进日志、不进导航参数、不上报。
3. 首版**不做本地离线邮件缓存**，只走服务端；将来若做必须使用设备安全存储 + 加密并另开卡。
4. 与现有邮件能力**并存**：本卡不新增 IMAP/SMTP 账号路径，也不改动既有 cloud / security 行为。

## 服务端契约（只读依赖）

- 读：`whoyou_whoami`、`whoyou_mailbox_get`、`whoyou_mail_search`、`whoyou_mail_thread_get`、`whoyou_mail_message_get`、`whoyou_mail_attachment_get`。
- 草稿：`whoyou_mail_draft_create` / `_update` / `_discard` / `_get` / `_list`。
- 发送：`whoyou_mail_send { draftId, confirmationCredential, idempotencyKey }`。
- 凭证：`POST {cloudAuth}/v1/service-credentials`
  - 读写：`{ audience: "mira:who-you", scopes: ["whoyou.read", "whoyou.mail.write"] }`
  - 确认：`{ audience: "mira:who-you", confirmation: { actor: "user", draft_id, draft_version, content_hash, nonce } }`
  - 响应：`{ token, tokenType: "Bearer", audience, expiresAt }`
- 必须呈现的错误码：`mailbox_not_provisioned`、`message_quarantined`、`quota_exceeded`、`export_rate_limited`、`recipient_suppressed`、`send_paused`、`confirmation_invalid`、`draft_version_conflict`、`relay_unavailable`。

## 范围

1. 新增 `src/whoYou/`：Cloud Auth 服务凭证获取、MCP JSON-RPC 客户端、读写/确认/发送编排、错误映射。
2. 新增 Who You 页面：地址与邮箱状态、收件箱列表、线程与正文、附件下载入口。
3. 草稿页：全量展示收件人 / 主题 / 正文；未确认时不存在可发送入口；确认后发送并展示回执。
4. 草稿改动产生新 version 后，旧确认失效，必须重新确认。
5. 设置或其他既有入口中增加 Who You 入口的最小接线。
6. 对应单元测试。

## 非范围

- 不实现 IMAP/SMTP、邮件迁移、别名、联系人、日历、规则引擎、富文本编辑器。
- 不新增或修改 Who You 服务端工具、错误码、MCP transport。
- 不修改 Mira Host 协议、Remote 会话、Agent Loop。
- 不做离线缓存与后台同步。

## 自动化验收

- `npm run typecheck`、`npm run lint`、`npm test` 通过。
- 新增测试覆盖：凭证请求体（scopes / confirmation 两种形态互斥）、凭证不落盘（不调用 secure store 写入路径）、未确认无可发送入口、改稿后需重新确认、错误码 → 用户文案映射。
- 日志与埋点断言：不含地址、主题、正文、附件名；确认凭证不进入任何持久化或上报字段。

## 真人验收（最小集）

Android 真机 + 真实 Cloud 账号 + 已部署 Who You：

1. 打开 Who You 入口，看到 `@tomlab.cn` 地址与收件箱。
2. 打开一封真实邮件，看到正文；有附件时可下载。
3. 打开一张草稿，看到最终形态；未点击确认前没有发送入口。
4. 确认 → 发送 → 看到回执。
5. 发送前改稿，旧确认不再可用，需要重新确认。

iOS 真机与隔离/配额/relay 失败的真实注入路径：如无环境，明确记录为 validation gap，不写成已通过。

## 风险

- Cloud Auth 与 Who You 未在本机部署，凭证签发与真实发送只能以部署环境 + 真机旅程证明。
- MCP 远程调用需要新网络层：只允许在 `src/whoYou/` 内实现，不得扩散到页面组件或改动既有 `src/api/` 约定。
- 若 Remote / 本地 Provider 链路需要复用该网络层，先停下与维护者确认真实协议边界。
