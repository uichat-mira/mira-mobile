# MOB-055：设置 → 报告错误 mailto 反馈通道真机验收

状态：**待验收**（代码已随本卡 PR 进入 review；本卡只负责真机人工验收，不包含新施工）

负责人：待指派（真机验收人）

执行仓库：`uichat-mira/mira-mobile`

关联 Issue：https://github.com/uichat-mira/mira-mobile/issues/153

## 背景

「设置 → 通用 → 报告错误」此前是纯视觉占位：`ReportErrorScreen` 的发送按钮硬编码 `disabled`，描述只存 React state，「晃动手机以报告错误」开关无手势监听、不持久化，反馈发不出去。这违反 `AGENTS.md` §3 「失败时给出明确、可操作的错误信息」。

本卡 PR 在**不引入新协议、不新增依赖**的前提下，把报告错误页接到设备侧 mailto 过渡通道（收件 `hello@mira.io`）：

1. 发送按钮真实启用：描述 trim 非空才可点，带「发送中」状态防连点。
2. 发送 = `Linking.openURL('mailto:hello@mira.io')`，主题预填 `Mira Mobile 报告错误 v<appVersion>`，正文 = 用户描述 + 白名单诊断块（App 版本 / 平台 / 系统版本 / 语言 / 连接模式 / 报告时间）。
3. 设备无邮件客户端时 `Alert` 回退提示手动发信，描述保留。
4. 草稿经 `localKeyValueStore` 持久化（`mira.report-error.draft.v1`），退出重进不丢。
5. 移除假的「晃动手机」开关（无加速度计依赖，不做不工作的 UI）。

新增 `src/screens/reportDiagnostics.ts` 纯函数模块与单测（白名单 key 精确断言、敏感词防泄露断言、mailto 编码断言）。

## 已知边界（先读，避免误报）

1. **mailto 是过渡通道，不是 Host feedback/report surface**。`mobile-api-rollout-plan.md` §7 的「报告错误：需要 feedback/report surface」仍未排期；本卡不伪造 Host API，主站合同到位后按 rollout plan 进入对应阶段。
2. **不采集任何敏感数据**。诊断字段仅白名单（版本 / 平台 / OS 版本 / 语言 / 连接模式 / 时间）；不含 hostUrl、token、API Key、会话内容；单测含防泄露断言。
3. **草稿在唤起邮件客户端后保留**。App 无法确认用户真的发出了邮件；用户可手动清空输入框，视为放弃草稿。
4. **mailto 长度**。正文上限 = 描述 2000 字 + 诊断块约 200 字，主流邮件客户端可处理；个别客户端对超长 mailto body 截断属客户端行为。
5. **App 无法确认送达**，也没有自动附截图（本卡不含该能力）。
6. **本地副本不可信**。本机真机验收记录不构成 PR 合入依据；PR 仍需 Feature CI（typecheck / lint / Jest / Android debug build / iOS build）全绿。

## 安装包来源（合并前 dev release 不含本功能）

- **Android 真机（必须）**：GitHub → 本卡 PR → Checks → *Android debug build* → 下载 artifact `uichat-mira-mobile-android-debug`（下载 PR artifact 需登录 GitHub）。
- **iOS 模拟器**：Checks → *iOS simulator and unsigned device builds* → artifact `uichat-mira-mobile-ios-simulator`。
- **iOS 真机（可选）**：同 job 的 `uichat-mira-mobile-ios-unsigned-device` artifact，按 `docs/ios-free-sideload-windows.md` 自签侧载；无条件时用模拟器替代，但结果须注明。

## 验收用例

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 入口 | 设置 → 通用 → 报告错误 | 进入报告页，标题「报告错误」居中，返回按钮回设置页 |
| 2 | 禁用态 | 空描述 / 纯空格时观察发送按钮 | 按钮 disabled 灰色，点击无响应 |
| 3 | 启用态 | 输入非空描述 | 按钮变主色可点；再次清空回禁用态 |
| 4 | mailto 内容（Android 真机，已装邮件客户端） | 点发送 | 邮件客户端打开：收件人 `hello@mira.io`；主题 `Mira Mobile 报告错误 v<版本>`；正文 = 描述 + 诊断块（版本 / 平台 / 语言 / 连接模式 / 时间）；无 token / hostUrl / baseUrl / 会话内容 |
| 5 | 无客户端回退 | 模拟器或卸载邮件客户端后点发送 | `Alert`「无法打开邮件客户端」含 `hello@mira.io` 手动路径；返回后描述仍在 |
| 6 | 草稿持久化 | 输入描述 → 返回设置 → 重进报告页 | 描述还在；清空后退出重进为空 |
| 7 | 假开关移除 | 检查页面 | 无「晃动手机以报告错误」开关 |
| 8 | 外观联动 | 切深色模式与不同重点色 | 按钮、输入框边框、文字在深 / 浅色下可读，无穿帮 |
| 9 | 凭据泄露检测（developer-only） | 真机 logcat / 调试器观察页面与 mailto URL，**仅检查「———」分隔线之后的诊断块** | 诊断块只允许出现版本 / 平台 / OS / 语言 / 连接模式 / 时间，不含凭据值、Host URL、API Key、会话内容；用户在描述框主动填写的内容（如「token 无效」「hostUrl 配置失败」）不算泄露 |

## Hard Constraints

- 没有真机证据不得标 PASS；模拟器只能覆盖用例 5 的回退路径，不得替代用例 4。
- 用例 4 必须实际核对收件人 / 主题 / 正文三要素；「邮件客户端打开了」不算。
- 发现失败时记录：设备型号、系统版本、包来源 / commit、复现步骤、截图或录屏；从最新 `dev` 开 fix 分支，不在验收记录里直接宣称已修。

## 结果记录（验收人填写）

设备：＿＿＿＿＿＿（型号 / 系统版本 / 包来源 / commit）

| 用例 | Android | iOS |
|---|---|---|
| 1 入口 | | |
| 2 禁用态 | | |
| 3 启用态 | | |
| 4 mailto 内容 | | |
| 5 无客户端回退 | | |
| 6 草稿持久化 | | |
| 7 假开关移除 | | |
| 8 外观联动 | | |
| 9 凭据泄露 | | |

## Handoff

用例 1–8 全部 ✅（Android 真机；iOS 至少覆盖 1、2、3、5）+ **用例 9 ✅ 或标注「未验证」** → 本卡标 PASS，PR 合入 `dev`，状态回写 `docs/workbench/00-work-ledger.md`。

用例 4 在 iOS 无邮件账号时允许以「Android 真机 + iOS 模拟器回退路径」组合覆盖，但须在结果记录注明。任一核心项 ❌ → 失败项回到施工方修复，本卡重新进入待验收。
