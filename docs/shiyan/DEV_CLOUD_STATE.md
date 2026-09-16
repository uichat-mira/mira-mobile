# 拾言（Shiyan）Dev 云环境真相

状态：当前 dev 环境事实（Mutable Environment Truth）

最近核对：2026-08-31

适用环境：Shiyan dev / `dangjingtao/mira-shiyan-cloud` `dev`

> 本文只记录“当前 dev 云环境已经真实存在什么、还缺什么”。产品行为以 `PRD.md` 为准，稳定技术合同以 `TECHNICAL_DESIGN.md` 为准。环境资源变化后应更新本文，不得用旧环境状态反向修改产品合同。

## 1. 已落地 Cloudflare 资源

### D1

- 数据库：`mira-shiyan`
- Database ID：`5f923203-bb4f-40a1-9b83-d6cf493f3114`

远端已应用 migration：

- `0001_capture_foundation.sql`
- `0002_stt_transcript.sql`
- `0004_delivery_records.sql`
- `0005_llm_organization.sql`

### Device

- 已初始化设备：`mira-mobile-primary`
- 2026-08-31 已确认现有明文 device credential 与远端 D1 `credential_hash` 精确匹配。
- 设备 `revoked_at IS NULL`。
- 明文 credential 不进入 Git、日志或本文。

### R2

已创建 bucket：

- `mira-shiyan-audio`

### Worker / Workflow

- Public API Worker：`https://mira-shiyan-api.dangjingtao.workers.dev`
- `shiyan-llm` private Worker 已真实部署。
- `shiyan-api` public Worker 与 Capture Workflow 已真实部署。
- D1、R2、Workers AI、Service Binding、Workflow bindings 已进入真实 dev 部署。
- AI SDK v6 + `@ai-sdk/openai-compatible` 方案已通过 Cloudflare Worker dry-run 与真实部署门禁。
- Cloudflare runtime types、TypeScript、拾言 cloud tests、两个 Worker dry-run、本地/远端 D1 migration 校验均已通过。

### 公网可达性

2026-08-31 已从真实公网浏览器访问：

`GET https://mira-shiyan-api.dangjingtao.workers.dev/health`

返回 `ok: true` 且 service 为 `shiyan-api`。因此 public Worker URL 与公网 HTTPS 可达性已确认，不再属于 blocker。

## 2. D1 配置语义

“D1 资源已创建”和“仓库中的 Wrangler 配置如何引用它”是两件事。

当前 `mira-shiyan-cloud/dev` 可以继续在仓库配置中保留 D1 placeholder，并由部署流程通过 `SHIYAN_D1_DATABASE_ID` 注入真实 ID。

因此：

- `REPLACE_WITH_D1_DATABASE_ID` 不得再被解释为“D1 尚未创建”。
- 真正的 dev D1 事实以本文记录的 `mira-shiyan` / `5f923203-bb4f-40a1-9b83-d6cf493f3114` 为准。
- GitHub Actions `shiyan-dev` 已提供 `SHIYAN_D1_DATABASE_ID`，当前部署流水线已实际通过 D1 reachability、remote migration 与真实 deploy。

## 3. LLM 配置合同与当前状态

`shiyan-llm` 不绑定具体厂商，协议层为 OpenAI-compatible。

Primary 最小配置：

- `LLM_PRIMARY_BASE_URL` — Cloudflare Var
- `LLM_PRIMARY_MODEL` — Cloudflare Var
- `LLM_PRIMARY_API_KEY` — Cloudflare Secret
- `LLM_PRIMARY_PROVIDER` — 可选观测标签

Fallback 整组可选：

- `LLM_FALLBACK_BASE_URL`
- `LLM_FALLBACK_MODEL`
- `LLM_FALLBACK_API_KEY`
- `LLM_FALLBACK_PROVIDER` — 可选观测标签

当前 dev 已配置 primary 的 Base URL / Model / Provider label / API Key；fallback 未配置并保持可选。Base URL / Model 等非敏感配置使用 Cloudflare Vars；API Key 使用 Cloudflare Secrets。不得把真实 Secret 写入仓库、日志或本文。

## 4. 当前环境配置结论

截至 2026-08-31，Shiyan dev 环境配置已齐全，不再有“缺少 Key / Var / Worker / D1 / R2 / credential 配对”类 blocker。

已经确认：

- GitHub Actions `SHIYAN_D1_DATABASE_ID` 已同步。
- `shiyan-llm` primary Vars / Secret 已配置。
- `shiyan-api` 所需 R2 credential、device auth pepper、GitHub Destination token 已配置。
- public/private Worker 与 Workflow 已真实部署。
- `mira-mobile-primary` credential 与服务端 hash 合同一致。
- public API `/health` 已从真实公网访问成功。

## 5. 尚待验收

环境 ready 不等价于产品闭环已经验收完成。当前剩余的是运行验证，而不是继续补环境：

- 用真实 authenticated request 验证 device auth。
- CaptureTask 创建。
- R2 presigned upload 与 audio confirm。
- Workflow 启动。
- Workers AI STT。
- primary OpenAI-compatible LLM 整理。
- Final Draft 保存/确认。
- GitHub Destination POST 与 delivery evidence GET。
- Mobile 真机/模拟器使用 API URL + device credential 完成连接与端到端 smoke。
- 最终约 40 分钟真实会议录音 E2E 验收。

除非上述 smoke 暴露新的配置错误，否则不应再以“继续补环境”为下一步工作。

## 6. 相关真相

- 产品：[`PRD.md`](./PRD.md)
- 技术架构：[`TECHNICAL_DESIGN.md`](./TECHNICAL_DESIGN.md)
- 跨仓库治理：[`README.md`](./README.md)
- Cloud Foundation 任务卡：`../task-cards/MOB-018-shiyan-cloud-foundation.md`
