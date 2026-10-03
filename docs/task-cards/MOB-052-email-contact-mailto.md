# MOB-052：设置 → 电子邮件 真实功能与真机验收

状态：**验收中（有条件通过，缺口见结果记录）**（PR #159 已于 2026-09-26 合入 dev，验收为事后补记；本卡不含新施工）

负责人：待指派（真机验收人）

执行仓库：`uichat-mira/mira-mobile`

首次派卡基线：`feat/settings-contact-email`（基于 `dev @ a56531a5`）

关联 PR：https://github.com/uichat-mira/mira-mobile/pull/159

## 背景

设置 → 账户分组下的「电子邮件」按钮历史上是一个无 `actionId` 的占位行 —— `SettingsRow` 检测到没有 actionId 时整行 `disabled` 并隐藏 chevron，看起来像按钮，按下没有任何响应。本次改动把按钮接通到系统 `mailto:` 出口，并把邮箱地址收敛到 `CONTACT_EMAIL` 常量；无邮件客户端时弹一次 Alert 兜底，避免「按了按钮什么都没发生」。

按仓库规则，**自动化不能替代真机交互验收**。本卡把剩余的人工验收项显式列出，验收通过前 PR 不得合入 `dev`。

## 已知边界（先读，避免误报）

1. **目标地址是公开反馈入口**：`dangjingtao@gmail.com` 由 `CONTACT_EMAIL` 常量持有，不承载凭据或身份敏感信息。
2. **客户端由系统决定**：调用的是 `Linking.openURL('mailto:...')`，最终唤起哪个邮件 App 由系统 URL Scheme handler 决定，移动端不强绑 Gmail / Outlook / 系统邮件等具体 Provider。
3. **iOS「邮件」未配置的回退**：iOS 上若用户从未在系统设置里添加过邮件账户，第一次按按钮会先由系统弹「未配置邮件账户」sheet，然后跳回 App；我们的 Alert 兜底不会覆盖系统 sheet，这是预期行为。
4. **本卡验收的是 UI 接线 + 真机唤起行为**，不是邮件服务器端可达性 —— 后者由维护者在邮箱侧验证。
5. **未通过该 PR 构建的情况下不要伪造包**：本卡所有用例一律基于该 PR 的 CI artifact。

## 安装包来源（合并前 dev release 不含本功能）

- **Android 真机（必须）**：该 PR → Checks → *Android debug build* → artifact `uichat-mira-mobile-android-debug`（下载 PR artifact 需登录 GitHub）。
- **iOS build / Simulator（自动化基线）**：Checks → *iOS simulator and unsigned device builds*。当前不要求维护者额外准备 iPhone；有设备时可补真机 smoke，没有设备则记录 `validation gap: iOS real device unavailable`。
- Android 真机结果不可被模拟器替代。

## 验收用例

当前真人只要求 **Android 真机主路径**：至少完成用例 1、2，并在邮件撰写界面确认收件人预填正确。主题 / 正文留空可顺手核对，也可由源码 / 自动化证据补足。iOS 不设人工硬门槛。凡「按下后唤起什么」以实际系统行为为准。

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 入口可达 | 设置 → 账户 → 电子邮件 | 行副标题显示 `dangjingtao@gmail.com · 发送反馈`；右侧 chevron 正常显示；行无 disabled 灰态 |
| 2 | 唤起系统邮件 App（Android） | 安装了任意一个邮件客户端（Gmail / 系统邮件 / Outlook 等任一），按下按钮 | 系统打开邮件撰写界面：可能直接进入默认客户端，也可能先弹应用选择器（以系统实际行为为准，不强制必现选择器）；最终撰写界面收件人预填 `dangjingtao@gmail.com` |
| 3 | 唤起系统邮件 App（iOS） | iOS 系统设置里已添加任意邮件账户，按下按钮 | 打开邮件撰写界面，收件人预填 `dangjingtao@gmail.com`；若系统先弹任何账户相关提示，以系统实际行为为准并如实记录（「未配置账户」场景归用例 6） |
| 4 | 主题 / 正文留空 | 同 2 或 3，唤起后 | 主题、正文为空；不允许 App 自动塞入任何文案或营销文案 |
| 5 | 兜底提示：Android 卸载所有邮件客户端 | adb 卸载 / 停用所有能处理 `mailto` 的 App 后按下按钮 | App 内弹出 `Alert.alert("无法打开邮件客户端", ...)`，提示用户可手动发件至该地址；按「确定」关闭 Alert，回到原设置页；之后再按一次行为一致 |
| 6 | 兜底提示：iOS 未配置邮件账户 | iOS 系统设置 → 「邮件」→「账户」清空所有账户后按下按钮 | 系统层先弹 iOS 自己的 sheet 告知未配置账户；用户确认后回到 App；不会显示 App 的兜底 Alert —— 这是预期 |
| 7 | 多次连按 | 连续按按钮 5 次，每次先取消选择 / 关闭 | 不出现重复 Alert 叠加、不出现 App 卡顿；每次行为一致 |
| 8 | 外观联动 | 切到深色模式 + 切重点色，再查看本行 | 行图标、副标题文字、chevron 在深浅色下都可读；Alert 文字在深色背景下对比度可接受 |
| 9 | 网络无关 | 飞行模式下按下按钮 | 与在线时行为一致（mailto 不依赖网络）；不应该出现「网络错误」提示 |
| 10 | 字段恒定（源码范围） | 在 `src/` 实现源码内 grep `dangjingtao@gmail.com`，并检查 `CONTACT_EMAIL` 的使用位置 | `src/` 内邮箱字面量仅命中一处：`CONTACT_EMAIL` 常量定义；`CONTACT_EMAIL` 在设置行副标题中使用。全仓额外命中只允许出现在任务卡 / 台账等协作文档中，不允许出现在其它实现脚本、配置或 PR 注释里 |

## Hard Constraints

- 没有真机证据不得标 PASS；不得用「模拟器看起来没问题」替代 Android 真机结论。
- 用例 5 调整为 developer-only / 条件项：不要求真人为了验收去卸载或停用所有邮件 App。无环境时标「未验证」，由自动化 / 结构证据守住兜底分支。
- 失败项回到施工方修复，本卡重新进入待验收；不在验收记录里直接宣称已修。
- 邮箱地址变更不在本卡范围；如需改地址或加多收件人，新建独立任务卡，不要在 MOB-052 上改 `CONTACT_EMAIL`。

## 结果记录（验收人填写）

设备：Huawei P30 / EMUI 12（≥Android 10）/ 包来源：PR #159 Checks → uichat-mira-mobile-android-debug / commit 26b6e1e7
验收日期：2026-10-03（Android 真机；iOS 未执行）

| 用例 | Android | iOS |
|---|---|---|
| 1 入口可达 | ✅ 副标题 dangjingtao@gmail.com · 发送反馈、chevron 正常、非 disabled | 未执行 |
| 2 唤起（Android） | ⚠️ 部分验证：已确认唤起邮件撰写界面；收件人预填未核对 | — |
| 3 唤起（iOS） | — | 未执行 |
| 4 主题 / 正文留空 | 未验证（唤起后未核对） | — |
| 5 兜底（Android 无 handler） | 未执行（卡内硬性项，无豁免） | — |
| 6 兜底（iOS 未配置） | — | 未执行 |
| 7 多次连按 | ✅ 无叠加、无卡顿 | — |
| 8 外观联动 | ✅ 深浅色可读 | — |
| 9 网络无关 | ✅ 飞行模式行为一致 | — |
| 10 字段恒定 | ✅ 结构化核实：dangjingtao@gmail.com 仅出现于 CONTACT_EMAIL 常量定义（SettingsScreen.tsx L56）；全树 grep 未跑 | — |

结论：**有条件通过（Android 主路径尚差一个关键确认）** —— 已确认入口和实际唤起；当前只需在一次正常 Android 撰写界面中补核对“收件人预填正确”。用例 5 与 iOS 真机不再是硬阻塞；其余边角由自动化 / 结构证据与 validation gap 承担。完整记录见 PR #159（2026-10-03 评论）。流程事实：PR #159 已于 2026-09-26 合入 dev（merge bd673b1e），本记录为事后补记。
## Handoff

Android 真人核心只看：入口可达、真实邮件撰写界面被唤起、收件人预填正确。其余主题/正文静态语义、字段恒定、no-handler 兜底优先由自动化 / 结构证据覆盖；无条件复现的 developer-only 项允许记 validation gap。iOS 真机当前不阻塞本卡。

Android 核心项 ✅ + CI / 自动化证据绿色 → 可进入 PASS 判断；任一 Android 核心项 ❌ → 回施工方修复。
