# MOB-035：远程连接状态诊断与会话错误分层

状态：REVIEW  
优先级：P1  
主责仓库：`dangjingtao/uichat-mira-mobile`  
可能依赖：`dangjingtao/uichat-mira` Desktop Host / Relay presence contract

## 背景

当前会话首页、Drawer 与搜索页在加载 Thread 失败时，最终主要落到同一类「加载会话失败」界面。现有底层其实已经保留了部分结构化事实：

- 无本地设备凭据：`PAIRING_REQUIRED`；
- 凭据失效 / 被拒绝：HTTP `401`；
- scope 不足：HTTP `403`；
- Direct 网络失败后可按既有合同尝试 Relay；
- 普通网络 / Transport 失败：`NETWORK_ERROR` 或 Relay transport error；
- 会话 API、协议解析与服务端业务失败不是连接状态。

产品需要认真区分「根本没连接」「连接已经失效」「手机没网」「暂时无法抵达 Desktop」「Desktop 有权威证据表明离线」和「Desktop 在线但会话加载失败」，不能再全部压成一句，也不能凭一次 timeout 猜设备离线。

## 目标

建立一套可复用的 Remote connection diagnostic result，让会话首页、Drawer、全局搜索及后续 Remote 页面消费同一份结构化状态与用户动作。

## 状态合同

| 状态 | 判定事实 | 标题 / 说明 | 主操作 |
|---|---|---|---|
| `unpaired` | 本地无 device credential；`PAIRING_REQUIRED` | 尚未连接 Mira Desktop | 连接设备 |
| `mobile_offline` | 操作系统网络状态明确不可用 | 手机当前未连接网络 | 检查网络 / 重试 |
| `credential_invalid` | Host 返回 `401`，凭据过期、撤销或失效 | 设备连接已失效 | 重新连接 |
| `permission_denied` | Host 返回 `403` | 当前设备无权读取会话 | 查看连接设置 |
| `host_offline` | Desktop / Relay 返回权威 presence 或 reachability 结果，明确该 Host 已离线 | Mira Desktop 当前离线 | 重试 |
| `host_unreachable` | 已配对，Direct 与可用 Relay 均失败，但没有权威 Host 离线证据 | 暂时无法连接 Mira Desktop | 重试 / 连接设置 |
| `session_service_error` | 已抵达并完成鉴权，但 `/threads` 返回 5xx、业务错误、协议解析错误或非法 payload | 会话加载失败 | 重试；开发构建可查看诊断详情 |

## 硬边界

1. `NETWORK_ERROR`、timeout、DNS、TLS、Tailscale 或 Relay transport failure **本身不能证明 Desktop 离线**。
2. 只有权威 Desktop / Relay 在线事实才可映射 `host_offline`；若当前合同没有该信号，本卡必须先使用 `host_unreachable`，并明确记录最小跨仓依赖，不得伪造判断。
3. 401 / 403 与业务错误继续遵守 canonical Remote 合同，不触发 Transport fallback。
4. 不向普通用户暴露 token、credential、Host URL、内部堆栈或原始响应正文。
5. 不改变现有配对、Direct 优先 / Relay 回退、credential 清理与 Remote scope 合同。
6. 不因一次列表请求失败清空此前可安全保留的会话数据；是否保留旧数据必须显式设计并有测试。

## 施工范围

### Mobile

- 增加 Remote / session load 的结构化诊断类型，禁止 UI 层只传一段字符串作为状态真相；
- 在错误映射前检查本地是否已配对及系统网络状态；
- 保留 Direct / Relay 最终失败原因及是否取得 Host 响应；
- 统一改造 `SessionListScreen`、`CustomDrawer`、`SearchScreen` 与 `sessionCollectionState`；
- 每个状态提供匹配的 CTA；「连接设备 / 重新连接 / 查看连接设置」进入现有 HostConfig / pairing 路径；
- 顶部连接指示点不得仅凭列表加载结果改变为误导性状态。

### Desktop / Relay（仅在缺少权威信号时）

- 先审查现有 Relay frame / error code / presence 是否已经能明确区分 Host 未注册、连接已断开与 Relay 自身故障；
- 若不能，提出并实现最小、可鉴权、不可枚举设备信息的 reachability / presence 合同；
- Mobile 只消费规范化结果，不解析 Relay 文案猜状态。

## 不做

- 不重写 Remote Transport；
- 不改变配对二维码和凭据模型；
- 不新增后台常驻轮询；若需要 presence，优先复用现有请求或受控探测；
- 不把 Cloud / 拾言离线状态混入本卡；
- 不为了文案好看伪造「已连接」或「设备离线」。

## 验收矩阵

1. 全新安装、从未配对：显示「尚未连接 Mira Desktop」，主操作可进入连接流程；
2. 已配对、手机飞行模式：显示手机离线，不显示 Desktop 离线；
3. 已配对、Desktop 关闭、Relay 有权威离线事实：显示 Desktop 离线；
4. 已配对、Desktop 关闭但无权威事实：显示暂时无法连接，不武断显示离线；
5. Direct 不通、Relay 成功：正常显示会话，不闪错误态；
6. Relay 故障但 Direct 成功：正常显示会话；
7. `401`：显示连接失效并进入重配对；凭据清理行为符合既有合同；
8. `403`：显示权限不足，不伪装连接失败；
9. Desktop 在线、`/threads` 500：显示会话加载失败，不显示设备离线；
10. Desktop 返回非法 Thread payload：显示会话加载失败，并保留可诊断错误码；
11. 首页、Drawer、搜索页对同一故障给出一致分类；
12. 为上述分类补齐单元测试；Android 真机至少验证 1、2、4、5、7、9，iOS 保留等价 smoke 挂账或证据。

## 实施证据

- Mobile PR #92 已 squash merge 到 `dev`，merge commit：`0d5f2c6e6439cd8e484763980f25a6ec547007a8`；
- 最终 head `d7069ae153e6920415acd4d8ab16ad6bf0a2dce0` 的 Mobile CI 完整通过：Typecheck、Lint、Jest、Android debug、iOS simulator、unsigned iPhone / IPA；
- OpenCode Review 最终工作流 `completed / cancelled`，没有形成新的 verdict；此前 Codex 提出的全局搜索 message-fetch P2 已修复、补回归测试并关闭 review thread；
- 已确认 Relay 现有 `HOST_OFFLINE` 可提供权威 Host 离线事实，因此本卡未引入新的 Desktop / Relay 协议；
- Android 复用现有 `MiraNetworkMonitor` 读取系统网络状态；iOS 当前没有等价 native monitor，无法确认手机离线时保守归类 `host_unreachable`；
- 仍需 Android 真机状态矩阵与 iOS 等价 smoke 后才可进入 PASS。

## 完成定义

- 状态模型、错误映射、三处 UI 与自动化测试进入 Mobile `dev`；
- 若新增跨仓 presence 合同，Desktop / Relay 对应实现、合同文档与测试已经合入可依赖分支；
- 产品负责人完成 Android 真机状态矩阵验收后，任务才可从 REVIEW 进入 PASS。
