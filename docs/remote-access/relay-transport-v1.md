# Mira Mobile Relay Transport V1

## Current Connection Reliability Truth (2026-09-05)

- Relay connections have reproduced a 3-4 hour idle/background disconnect
  pattern. This is a transport keepalive and lifecycle problem, not a pairing
  credential problem.
- Desktop will send native WebSocket control pings; Mobile will not depend on
  a JavaScript timer to keep a backgrounded app alive.
- When Mobile returns to the foreground, it must invalidate a stale Relay
  connection and allow the next request to establish a fresh connection.
- Active requests and streams remain fail-fast on close; this task does not
  silently replay side-effecting requests.
- The Relay V1 business frame contract remains unchanged. A new JSON
  heartbeat frame is not required for the first remediation.

> 配对与远程连接选择顺序以 [远程连接唯一真相源 V1](remote-connection-canonical-v1.md) 为准；本文保留 Transport frame 和 endpoint 数据结构说明。

## 目标

在不替换 Tailscale Direct 的前提下，让 Mobile Remote Host V1 同时支持：

```text
Direct (Tailscale HTTPS)
Relay  (Mira Relay WSS)
```

业务层继续只调用 `RemoteMiraHostClient`，不感知 Cloudflare、Durable Object 或 WebSocket frame 细节。

## Pairing descriptor

`mira://pair` V1 保持 `challenge/code/version`，endpoint 改为至少存在一种：

```text
host=<optional direct HTTPS endpoint>
relay=<optional relay HTTPS base URL>
relayId=<required with relay>
relayToken=<required with relay>
```

`relayToken` 是 Relay room 的传输凭据，不是 Mira 业务凭据。二维码整体属于短时敏感配对材料。

## Stored credential

安全存储继续保存 `mira_device_*` credential，同时保存可用 endpoint：

```ts
{
  hostUrl: string | null,
  relay: {
    endpoint: string,
    relayId: string,
    token: string
  } | null,
  credential,
  deviceId,
  scopes,
  savedAt
}
```

旧版只含 `hostUrl` 的 Direct-only credential 必须继续可读。

## Selection

首次配对采用 Relay-first，配对后的日常业务请求采用 Direct-first；完整流程、claim 通道字段和禁止跨 Transport 重发规则见唯一真相源。

- Direct 可用时优先。
- Direct 仅在网络层失败时回退 Relay。
- 401/403、业务 HTTP 错误、协议解析错误不触发跨 Transport fallback。
- Direct 网络失败后进入短暂 cooldown，期间优先 Relay；cooldown 后下一次请求重新尝试 Direct。
- Tailscale 恢复后不重新配对。

## Relay frame

Client hello：

```json
{"version":1,"type":"hello","role":"client","relayId":"...","token":"..."}
```

请求继续复用 Desktop Relay V1 的 `request/response/chunk/complete/cancel/error` frame。业务 Authorization 仍是：

```text
Authorization: Bearer mira_device_...
```

Relay 不解释 scopes。

## Streaming

`POST /proxy/chat/default` 经 Relay 时：

```text
response
chunk...
complete
```

Mobile 复用现有 `SseFrameDecoder` 解析 Desktop 原始 SSE bytes。用户 cancel 时发送 Relay `cancel`。

## 边界

- 不修改 Desktop 业务 API。
- 不复制 Agent / Provider / Tool / scope 判定。
- 不删除 Tailscale connectivity 实现。
- 不新增第三方网络依赖。
- Relay endpoint 必须 HTTPS，内部转换为 WSS。
