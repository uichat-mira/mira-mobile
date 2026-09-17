# MOB-051：设置 → 记忆 真实接入与真机验收

状态：**待验收**（代码已提交 PR；本卡只负责真机人工验收）

负责人：待指派（真机验收人）

执行仓库：`uichat-mira/mira-mobile`

首次派卡基线：PR（feat/memory-screen → dev，待提交）

关联 Issue / 合同：
- `mira-desktop/dev:server/src/routes/memory.ts`（Host `/memory` 5 个路由，已存在）
- `mira-desktop/dev:server/src/services/remote-device-auth.service.ts`（当前 Remote Gateway scope 列表，**未包含 memory:read / memory:write**）
- `mira-mobile/dev:docs/remote-access/mobile-api-rollout-plan.md` §4.1（Memory M1 阶段 P0）

## 背景

设置页「记忆」按钮在 MOB-024 之前的实现是静态占位。本卡把它接成一条真实的 Remote Host 通路：

- 全部增 / 改 / 删 / 开关都打 Host `/memory` 系列路由；
- 由 Host 返回真实状态，本机不做任何本地副本；
- 没有 Host 端 Memory 远程合同（`memory:read` / `memory:write` scope + `manifest.routes.memory`）时，移动端按 `REMOTE_SCOPE_REQUIRED` / `REMOTE_MEMORY_ROUTE_UNAVAILABLE` 真实失败，UI 给出"Host 未开放"提示 + 重试入口，**不**做本地假同步。

## 已知边界（先读，避免误报）

1. **当前 Host Remote Gateway 没有放行 memory scope 与 /memory 路由**，所以未升级的 Host 上记忆页会显示「当前 Mira Host 尚未对移动端开放记忆能力」并提供重试。这不是 Mobile 缺陷，是 Desktop 端尚未发布的合同；本卡对此不视为失败。
2. 设置项完全是设备 + 配对身份作用域内的；**不**做跨设备同步，**不**写到设备本地存储。Mira Host 才是事实来源。
3. 自定义指令属于「个性化」页（PR #142），不在本卡范围。Memory 与 Personalization 是两个独立合同，不得互相顶替（这是 Mobile API 排期合同的硬约束）。
4. 编辑弹窗里**不**提供切换 kind 的入口：手动添加的默认 `kind=preference`，对话提炼的 kind 由 Host 权威决定，移动端不应擅自覆盖。
5. 删除走二次确认；删除返回 `MEMORY_DELETE_UNCERTAIN` 时不要直接重试，请刷新当前列表再判断。

## 安装包来源（合并前 dev release 不含本功能）

- **Android 真机（必须）**：PR → Checks → *Android debug build* → 下载 artifact `uichat-mira-mobile-android-debug`。
- **iOS 模拟器**：同 PR → *iOS simulator and unsigned device builds*。
- **iOS 真机（可选）**：同 job 的 unsigned device IPA，自签侧载；无条件用模拟器替代即可，结果注明。

## 真机环境前置

- 配对的 Desktop Host 必须是**已经放行 Memory 远程合同**的版本（含 `memory:read` / `memory:write` scope，且 `manifest.routes.memory` 列出 5 个路由）；否则验收停在「禁用 + 重试」路径，记录为"Host 未升级"，不能算缺陷。
- 配对成功且 Host 处于 connected 状态；桌面端至少预置 ≥1 条 `origin=manual` 与 ≥1 条 `origin=conversation` 的记忆以便核对。

## 验收用例

所有持久化类结论以**杀进程重开 + 重新连接 Host**为准。

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 入口 | 设置 → 我的 Mira → 记忆 | 进入 Memory 页；返回按钮 / 右上 ✓ 均可返回 |
| 2 | capability 未放行兜底 | 在尚未放行 memory scope 的 Host 上进入本页 | 显示禁用盒 + 红色文字「当前 Mira Host 尚未对移动端开放记忆能力」+「重试」按钮；点击无任何写入 |
| 3 | 列表与开关 | Host 已放行，进入页面 | 顶部开关 = Host 当前 `enabled`；列表展示所有 `records`，含 kind 中文标签、origin 中文标签、更新时间 |
| 4 | 开关切换 | 拨动开关 → 杀进程重开 + 重新连 Host → 拉到新列表 | Host 端 `enabled` 已被实际写入；重开后仍是新值 |
| 5 | 添加记忆 | 点「添加记忆」→ 输入 5 字以上文本 → 提交 | 弹窗关闭，列表中出现新行，类型=「偏好 · 手动添加」；Host 端确实新增了一条 `origin=manual` 记录 |
| 6 | 添加空内容拒绝 | 点「添加记忆」→ 输入 < 4 字 → 提交 | 弹窗保持打开，行内提示「记忆内容至少 4 个字符」；不写入 |
| 7 | 编辑记忆 | 在已有记忆上点 ✎ → 改文字 → 保存 | 列表内容立即更新；Host 端 PATCH `/memory/:id` 生效；更新时间刷新 |
| 8 | 编辑空内容拒绝 | 编辑后内容 < 4 字 → 提交 | 弹窗保持打开，行内提示同上 |
| 9 | 删除记忆 | 点 ✕ → 确认对话框 → 删除 | 列表移除该行；Host 端 DELETE 生效 |
| 10 | 删除取消 | 点 ✕ → 确认对话框 → 取消 | 列表不变 |
| 11 | 离线断开 | 飞行模式或断开 Host → 在记忆页操作 | 各操作返回 Host 不可达错误（不静默） |
| 12 | 混合回归 | 同时切开关 + 增 1 条 + 改 1 条 + 删 1 条 → 杀进程重连 | 与 Host 当前事实一致，无残留、无丢失 |
| 13 | 外观联动 | 切换深色模式 / 重点色 | 各控件在深浅色下均可读，错误盒背景正确 |
| 14 | 键盘交互 | 添加 / 编辑时键盘弹起 | 输入框不被遮挡；Android 系统返回键关闭弹窗且不误触"添加 / 保存" |

## Hard Constraints

- 没有真机证据不得标 PASS；不得以"模拟器看起来没问题"代替 Android 真机结论。
- 持久化类用例（4、5、7、9、12）必须以"杀进程重连 + 重新拉 Host 列表"为准，不能用"退出页面再看一眼"代替。
- Host 端 memory 合同未放行的桌面版本不构成 Mobile 缺陷，按用例 2 的预期即可；务必在结果里区分是"Mobile 缺陷"还是"Host 未升级"。
- 发现失败时记录：设备 / 系统 / 包来源 / Host 版本 / 复现 / 截图或录屏 / 期望 vs 实际；从最新 `dev` 开新 fix，不得在验收记录里直接宣称已修。

## 结果记录（验收人填写）

设备：＿＿＿＿＿＿（型号 / 系统 / 包来源 commit / Desktop Host 版本）

| 用例 | Android | iOS |
|---|---|---|
| 1 入口 | | |
| 2 capability 兜底 | | |
| 3 列表与开关 | | |
| 4 开关切换 | | |
| 5 添加记忆 | | |
| 6 空内容拒绝 | | |
| 7 编辑记忆 | | |
| 8 编辑空内容拒绝 | | |
| 9 删除记忆 | | |
| 10 删除取消 | | |
| 11 离线断开 | | |
| 12 混合回归 | | |
| 13 外观联动 | | |
| 14 键盘交互 | | |

## Handoff

- Android 用例 1–14 全部 ✅，且 iOS 用例 1、3、5、7、9、11 全部 ✅ → 本卡标 PASS，PR 合入 `dev`，台账回写。
- 任一核心项 ❌ → 失败项回到施工方修复，本卡重新进入待验收。用例 2 在未升级 Host 上是已知预期，不是失败。
- 同一轮 Desktop 端放行 Memory 远程合同的 PR 完成、用户升级 Host 后，本卡才视为有真实端到端证据；未升级前的 PASS 不得记为产品 PASS。