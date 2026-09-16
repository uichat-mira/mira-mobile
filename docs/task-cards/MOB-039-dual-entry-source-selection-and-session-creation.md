# MOB-039：双入口来源选择与统一新建会话

状态：**REVIEW**（2026-09-06 代码与自动化验证完成，待功能验收）

范围：Mira Mobile

依赖：MOB-037 运行时路由；MOB-038 Local Provider 多配置与选定 Provider 新建会话

## 目标

用户在现有会话列表和 Drawer 内可以明确区分 Remote Host 与 Local Provider，并从统一的新建入口选择要创建的会话来源。现有 Remote Host 创建合同保持不变；Local Provider 复用已实现的 Provider 选择和本地会话创建能力。

## 功能范围

- 主列表来源标题打开明确的来源选择菜单，不再依赖循环点击猜测当前来源。
- 来源菜单提供“全部任务”“远程 Host”“本地 Provider”三个选项，并标记当前选项。
- Drawer 同时展示 Remote Host 与 Local Provider 会话。
- Drawer 增加 Local Provider 配置入口。
- Drawer 新建会话时先选择“远程 Host”或“本地 Provider”。
- 远程来源继续调用既有 Host 创建会话合同。
- 本地来源进入 Local Provider 页面，由用户选择 Provider 后创建本地会话。
- 本地会话行显示可读的 Provider 与模型来源，不出现乱码。
- 空列表说明随当前来源变化，不把本地列表误写成 Remote Host 状态。

## 非目标

- 不新增或猜测 Mira Host endpoint。
- 不实现 Tool Gateway、MCP 协议或 Agent Loop UI。
- 不在本卡实现 Provider 在线探测、模型发现或配置导入。
- 不改变 Remote Host 配对、认证、审批或权限合同。

## 验收步骤

1. 打开主会话列表，点击顶部来源标题。
2. 确认菜单同时显示“全部任务”“远程 Host”“本地 Provider”，当前来源有明确标记。
3. 依次切换三个来源，确认列表与空状态说明相符。
4. 打开 Drawer，确认最近会话包含本地与远程来源，且本地会话可直接打开。
5. 点击 Drawer 的“Local Provider”，确认进入 Provider 配置页。
6. 点击 Drawer 底部“聊天”，确认先出现远程与本地来源选择。
7. 选择“远程 Host”，确认沿用既有远程新建会话并进入聊天页。
8. 选择“本地 Provider”，确认进入 Provider 选择页；选定 Provider 后可新建本地会话。
9. 确认本地会话行显示“本地 Provider · 模型”，无乱码。
10. 回归远程会话打开、流式消息和 Agent 审批。

## 验证要求

- 来源选择和新建入口合同测试。
- `npm run typecheck`。
- `npm run lint`，不得新增 error。
- 全量 Jest。
- Android / iOS 真机完成步骤 1–10 后才可升为 `PASS`。

## 自动化验证结果

- `src/screens/sessionSourceEntry.contract.test.js`：来源菜单、Drawer 双来源、新建来源选择和本地 Provider 文案合同通过。
- 全量 Jest：65 个测试套件、355 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 error；保留仓库既有 warning。
- `git diff --check`：通过。

## 待功能验收

- Android / iOS 真机确认来源菜单、Drawer 双来源列表和远程/本地新建路径。
- 真 Provider 流式对话与既有 Remote Host 回归。
