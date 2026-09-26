# Mobile 任务卡索引

本目录补充 `docs/workbench/00-work-ledger.md` 的 Mobile / 跨仓任务。旧任务编号不改号、不重开；拾言（Shiyan）虽然跨 `uichat-mira-mobile`、`mira-shiyan-cloud`、`mira-shiyan` 三仓施工，但任务编号、状态、依赖与验收统一回写 Mobile 总台账。

> `docs/workbench/00-work-ledger.md` 是唯一状态台账。本页只做索引与快速状态镜像。

## 当前状态

| ID | 任务 | 状态 | 执行仓库 / 下一动作 |
|---|---|---|---|
| MOB-007 | 本机线程置顶 | **完成** | Mobile |
| MOB-008 | 本机未读状态 | **完成** | Mobile |
| MOB-009 | 简化桌面配对页与 Mira 链接兜底 | **完成** | Mobile；2026-09-04 真机五路径人工验收通过 |
| MOB-010 | Desktop Remote 合同接入收口 | **有条件完成** | Mobile；真实 Desktop 配对联调待验收 |
| MOB-011 | 0.2.0 会话交互回归修复 | **有条件完成** | Mobile + Host；0.2.1 真机回归待验收 |
| MOB-012 | Agent 手机审批闭环 | **有条件完成**：PR #57 已合入 | Mobile；真实 Desktop + Android / iOS 联调挂账 |
| MOB-013 | 会话媒体与附件读取 | **有条件完成**：PR #58 已合入 | Mobile；真机 / Host 媒体联调挂账 |
| MOB-014 | 会话手机工具 | **有条件完成**：PR #62 已合入 `dev` | Mobile；真实 Share Sheet / 长会话查找 smoke |
| MOB-015 | 设备设置与连接收口 | **有条件完成**：PR #54 已合入 | Mobile；真机设置 / system / 重配对验收 |
| MOB-016 | 拾言插件入口与任务壳 | **有条件完成**：PR #55 已合入 | Mobile；MOB-023 统一 UI smoke |
| MOB-017 | 拾言录音与本地恢复 | **有条件完成**：PR #56 已合入，自动化平台 Gate 通过 | Mobile；40 分钟真机录音 / 重启恢复 |
| MOB-018 | 拾言 Cloud 基础与 CaptureTask / 上传闭环 | **有条件完成**：基础实现已进入当前 Cloud `dev` 祖先基线 | `mira-shiyan-cloud`；真实 Cloud 资源 / Secret smoke |
| MOB-019 | 拾言 STT Workflow 与 Transcript 证据层 | **有条件完成**：Cloud PR #3 已进入 `dev`，自动门禁通过 | `mira-shiyan-cloud`；40 分钟真实 Provider smoke |
| MOB-020 | 拾言 LLM 整理与 AI 调整 | **PR #6 待合入**：合同审查可接受；fork Actions 尚待批准执行 | `mira-shiyan-cloud`；批准 CI -> Review -> merge |
| MOB-021 | 拾言处理状态、结果编辑与历史任务 | **已合入 `dev`**：Mobile PR #63，merge `72f854d`；CI 全绿 | Mobile；真实 Cloud/device smoke 挂 MOB-023 |
| MOB-022 | 拾言 GitHub Destination | **核心已合入，最终接线待完成** | `mira-shiyan-cloud` + `mira-shiyan`；待 MOB-020 合入后接 Final Draft / public routes + real GitHub smoke |
| MOB-023 | 拾言 MVP 端到端验收与加固 | **待启动** | 三仓；等 MOB-020 / 022 达到可联调基线 |
| MOB-024 | Mobile 新建会话与动态 Remote Capability | **有条件完成**：Desktop #88 / Mobile #65 已合入 | Mobile + Desktop Host；真实已配对设备新建 Thread 跨端 smoke |
| MOB-025 | 线程右滑操作与 Drawer 置顶分组修复 | **完成** | Mobile；2026-09-05 Android 真机 dogfood 验收通过（8 项全过） |
| MOB-026 | 全局搜索命中消息正文 | **待实施** | Mobile；不新增虚构 Host search route |
| MOB-027 | 设置页插件入口恢复可用 | **待实施** | Mobile；最小接线现有 `Plugins` route |
| MOB-028 | 关于页版本更新检查与确认下载 | **待实施** | Mobile；release channel 隔离 + signed APK 下载 |
| MOB-029 | 拾言确认页播放器 / 场景 Action Sheet / Cloud 配置入口 | **完成** | Mobile；2026-09-04 真机验收通过验收条目 1–9 |
| MOB-037 | Mobile 双入口与 Local Provider Agent Runtime | **进行中** | 阶段 A：运行时抽象、Provider 适配边界与独立凭据存储；Tool Gateway/UI 接线待协议确认 |
| MOB-038 | Local Provider 多配置与选定 Provider 新建对话 | **待验收** | Mobile；多配置、独立 Key、选定 Provider 创建会话与聊天来源展示 |
| MOB-039 | 双入口来源选择与统一新建会话 | **待验收** | Mobile；主列表来源菜单、Drawer 双来源与统一新建入口 |
| MOB-040 | 本地对话可靠发送与重试 | **待验收** | Mobile；本地消息幂等写入、取消/超时语义与失败重试 |
| MOB-041 | Tool Gateway / MCP 协议与凭据合同确认 | **待开始** | Mobile + Host；确认工具发现、鉴权、审批、取消、结果和凭据边界 |
| MOB-042 | 本地 Agent Loop UI 与运行状态呈现 | **待开始** | Mobile；工具调用、暂停、取消、超时和失败状态接入聊天 UI |
| MOB-043 | Host / Pi 持久运行时适配 | **待开始** | Mobile + Host/Pi；长任务、后台继续、审批暂停与恢复 |
| MOB-044 | 双入口真机验收与发布加固 | **待开始** | Android/iOS；真实 Provider、Host、凭据、网络和发布矩阵 |
| MOB-045 | Local Provider 会话生命周期闭环 | **待验收** | Mobile；PR #99 已合入 `dev`，本地会话删除、pin/read 清理、Provider 删除解锁及 Review 修复已完成；真机验收挂 MOB-044 |
| MOB-046 | OpenAI-compatible URL / SSE / Tool Call 兼容性修复 | **待验收** | Mobile；PR #100 已合入 `dev`，Base URL、finish/[DONE]、indexed/interleaved/split tool-call 兼容性与回归测试已完成；真实 Provider / 真机矩阵挂 MOB-044 |
| MOB-047 | Provider API Key 配置 UX 与凭据状态安全修复 | **待开始** | Mobile；移除掩码 sentinel，补 preserve/replace/clear |
| MOB-048 | 双链路提交窄范围代码卫生收尾 | **待开始** | Mobile；等待 045–047 后执行，不启动 broad refactor |

## 既有产品决策

- 线程置顶与未读首轮均为**设备级本地状态**，不伪装成账户级 / 跨设备状态。
- 全局最近 Thread 是一等入口；`workspaceId` 表示归属 / 运行上下文，不要求先经过 Workspace 页面。Drawer「项目」仍保留项目层级浏览。
- 0.2.1 不为“入口能点”制造假成功；优先把当前手机已有、现有 Host 已授权的能力接成真实功能。
- 自 2026-08-29 起，Remote Host V1 的旧固定 route allowlist 不再是规范权限真相；客户端能力判断以 Remote Gateway 显式 scope 映射 + 当前设备 scope + Host runtime manifest 为准。协议版本仍为 1，未授权 route 仍默认拒绝。

## 2026-08-29 Dogfood Follow-up

- MOB-025 是 MOB-007 之后的交互回归 / Drawer 展示收口，不改变 device-local pin 合同。
- MOB-026 是新的**跨会话消息正文搜索**；MOB-014 仍只负责当前会话查找，不重开旧卡。
- MOB-027 是明确的 Settings -> Plugins 接线回归，保持最小改动。
- MOB-028 必须区分 dev / prod release channel；用户确认后触发系统 / 浏览器下载，不在本卡实现静默安装。
- MOB-029 保持拾言“录音结束 -> 确认标题 / 场景 -> 提交”产品合同，仅收口确认页播放器、场景修改方式与 Cloud 配置入口。

## 拾言（Shiyan）MVP 规则

唯一真相目录：

- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/shiyan/README.md`
- `docs/shiyan/GITHUB_DESTINATION_CONTRACT.md`

核心约束：

- Mobile First，但拾言云端不依赖 Desktop / Host 在线；
- 本地先可靠录音，结束后确认标题 / 场景，再创建 CaptureTask；
- D1 保存服务端事实，R2 保存音频 / 原始资产；
- Transcript 长期保留且只读，原始录音默认 3 天；
- Stage 失败不等于整个 Task 失败；
- AI 调整生成候选，Final Draft 不得被后台 AI 静默覆盖；
- GitHub 是 MVP 第一 Destination，不是数据库；成功投递必须产生真实 URL + commit SHA；
- 下游仓库不得独立修改产品 / 跨仓合同。

## 当前拾言依赖

```text
MOB-016 ✓
MOB-017 ✓
MOB-018 ✓
   ↓
MOB-019 ✓
   ↓
MOB-020  PR #6
   ├── MOB-021 ✓ Mobile dev
   └── MOB-022  core ✓ / integration pending
             \ /
           MOB-023
```

MOB-021 已基于 MOB-020 PR #6 冻结的内容合同完成施工并合入 Mobile `dev`；正式集成仍要求 MOB-020 合入 Cloud `dev`。MOB-023 是最终集成验收卡，不与上游实现卡并行施工。

## MOB-023 启动条件

正式开始 MOB-023 前至少满足：

1. MOB-020 合入 Cloud `dev`，其 Cloud CI / Review 形成可引用证据；
2. MOB-021 已合入 Mobile `dev`；
3. MOB-022 完成 Final Draft -> Delivery 的 public API 接线，并具备可调用真实 GitHub Destination 的路径。

40 分钟真机会议、真实 Provider / Cloud Secret、真实 GitHub URL 属于 MOB-023 的验收矩阵，不需要提前伪造成上游“完成”。

## 详细任务卡

- `MOB-007-local-thread-pinning.md`
- `MOB-008-device-local-unread.md`
- `MOB-009-pairing-screen-simplification.md`
- `MOB-010-desktop-remote-contract-alignment.md`
- `MOB-011-conversation-ux-regression-repair.md`
- `MOB-012-agent-mobile-approval.md`
- `MOB-013-media-attachment-reading.md`
- `MOB-014-mobile-conversation-tools.md`
- `MOB-015-device-settings-connection.md`
- `MOB-016-shiyan-plugin-shell.md`
- `MOB-017-shiyan-recording-local-recovery.md`
- `MOB-018-shiyan-cloud-foundation.md`
- `MOB-019-shiyan-stt-transcript.md`
- `MOB-020-shiyan-llm-organization.md`
- `MOB-021-shiyan-mobile-results-history.md`
- `MOB-022-shiyan-github-destination.md`
- `MOB-023-shiyan-e2e-hardening.md`
- `MOB-024-mobile-thread-creation.md`
- `MOB-025-thread-swipe-drawer-pinning.md`
- `MOB-026-global-message-search.md`
- `MOB-027-settings-plugin-entry.md`
- `MOB-028-app-update-check-download.md`
- `MOB-029-shiyan-confirmation-ux.md`
- `MOB-037-mobile-dual-entry-local-provider-agent-runtime.md`
- `MOB-038-local-provider-profiles-and-session-creation.md`
- `MOB-039-dual-entry-source-selection-and-session-creation.md`
- `MOB-040-local-conversation-reliable-send-and-retry.md`
- `MOB-041-tool-gateway-protocol-and-credential-contract.md`
- `MOB-042-local-agent-loop-ui-and-run-state.md`
- `MOB-043-durable-host-pi-runtime-adapter.md`
- `MOB-044-dual-entry-device-acceptance-and-release-hardening.md`
- `MOB-045-local-provider-session-lifecycle.md`
- `MOB-046-openai-compatible-stream-compatibility.md`
- `MOB-047-provider-credential-ux-safety.md`
- `MOB-048-dual-entry-code-hygiene.md`
