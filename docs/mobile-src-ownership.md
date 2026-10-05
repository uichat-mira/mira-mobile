# Mira Mobile `src/` Ownership Map

本文件是 `src/` 顶层目录的 ownership 速查表，用于判断新文件应放在哪里。它只描述“谁负责什么”，不复制实现细节。

约定：

- 只有 `src/screens` 承载导航 Screen 与 screen-private presentation。
- 业务 / 领域逻辑放在对应 feature 目录，不散落在 Screen 目录。
- 只有真正跨 feature 复用的 UI 放在 `src/components`；单一 feature 私有组件放在对应 feature 目录。
- `src/screens` 与 feature 目录内的 `*.contract.test.js` 属于 screen registration / navigation / 领域合同测试，按被测对象归属。

## 目录职责

| 目录 | 负责 | 不负责 |
|---|---|---|
| `agent/` | Agent 领域：远程 Agent 审批逻辑、本地 Agent 运行卡片 UI | 会话消息渲染、Tool 执行权威 |
| `api/` | Mira Host / Desktop API 适配层（HTTP / SSE / Relay / workspace / role / thread media） | 页面状态、协议类型定义 |
| `bootstrap/` | 应用启动、生命周期、启动恢复目标 | 页面导航栈、会话列表状态 |
| `chat/` | 对话领域：发送编排、会话内工具、聊天错误文案、对话 UI（菜单 / 查找栏 / Markdown / 附件） | Session 集合与导航、Host 状态 |
| `components/` | 真正跨 feature 复用的共享 UI（当前为通用空状态插画） | 单一 feature 私有组件 |
| `connectivity/` | 网络与连接：Tailscale / 系统网络监控、远程连接诊断、连接状态 UI | 配对凭据、会话列表 |
| `data/` | 静态数据与常量（mock 数据、公共反馈邮箱） | 运行时状态 |
| `haptics/` | 触感反馈 | 设置持久化 |
| `hooks/` | 跨 feature 的通用 React hook | feature 专属 hook |
| `local/` | 本地会话仓库（Local Provider 会话持久化） | 本地 Provider 配置 / 凭据 |
| `media/` | 附件类型与预览策略 | 附件读取网络实现 |
| `memory/` | 本地记忆运行时、策略与仓库 | 服务端记忆事实 |
| `pairing/` | 配对 URI 解析、配对 hook、扫码 UI | 配对凭据存储（见 `security/`） |
| `protocol/` | 移动端与 Host 的线协议类型与解析 | 网络调用、UI |
| `provider/` | Local Provider 配置与 OpenAI-compatible 客户端 | Provider 凭据（见 `security/`） |
| `runtime/` | Agent / 对话运行时编排（本地与远程） | 协议定义、页面呈现 |
| `screens/` | 导航 Screen、screen-private presentation（如 `SessionSwipeRow`）、screen 合同测试 | settings / session / diagnostics / storage 等领域逻辑 |
| `search/` | 全局搜索 | 会话内查找（见 `chat/`） |
| `security/` | 设备侧凭据存储与安全状态聚合 | 业务会话状态 |
| `session/` | Session 集合 / 导航 / 投影、会话滑动策略、上次打开会话指针、workspace 列表 / 详情状态、会话 UI（类型图标、Drawer） | 会话消息内容渲染 |
| `settings/` | 设置领域：常规 / 个性化 / 通知设置持久化、报告诊断、设置页 UI 组件 | 其他 feature 的领域状态 |
| `share/` | 会话分享卡片与系统分享适配 | 会话数据事实 |
| `shiyan/` | 拾言功能（Screen、录音、播放、客户端、提交） | 其他 feature 的通用能力 |
| `storage/` | 本地键值存储与设备存储占用统计 | 各类业务数据的语义 |
| `store/` | 跨页面 Zustand store（Host、线程置顶、未读进度） | 持久化格式定义 |
| `test/` | 跨测试复用的 test helper | 生产逻辑 |
| `theme/` | 主题上下文、Token、调色板、设备主题设置 | 业务状态 |
| `tools/` | Tool Gateway 客户端与工具策略 | 工具实际执行（属 Host / Harness） |
| `types/` | 跨模块共享类型（含导航参数） | 协议类型（见 `protocol/`） |
| `update/` | 应用更新检查、semver 与渠道隔离 | 下载安装实现 |

## 边界提醒

- `src/screens` 不得承载 settings 持久化、session 领域策略、diagnostics、storage 计算等独立 domain / service 职责。
- `src/components` 中的共享组件必须有真实跨 feature 复用；feature 私有组件通过路径即可识别 owner。
- 迁移后不得保留旧路径的 re-export / compatibility shim。
