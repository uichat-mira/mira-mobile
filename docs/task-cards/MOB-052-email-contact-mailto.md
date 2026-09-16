# MOB-052：设置 → 电子邮件 真实功能与真机验收

状态：**待验收**（代码已随 PR #151 进入 review；本卡只负责真机人工验收，不包含新施工）

负责人：待指派（真机验收人）

执行仓库：`uichat-mira/mira-mobile`（原始指令目标仓库 `uichat-mira/uichat-mira-mobile` 的 dev 头与本仓相同，PR 合入后请按 Mira 同步流程把同一 commit SHA 带回 `uichat-mira-mobile` 的 dev）

首次派卡基线：`feat/contact-email-button @ 5f8a492`（PR #151）

关联 PR：https://github.com/uichat-mira/mira-mobile/pull/151

## 背景

设置 → 账户分组下的「电子邮件」按钮历史上是一个无 `actionId` 的占位行 —— `SettingsRow` 检测到没有 actionId 时整行 `disabled` 并隐藏 chevron，看起来像按钮，按下没有任何响应。PR #151 把按钮接通到系统 `mailto:` 出口，并把邮箱地址收敛到 `CONTACT_EMAIL` 常量；无邮件客户端时弹一次 Alert 兜底，避免「按了按钮什么都没发生」。

按仓库规则，**自动化不能替代真机交互验收**。本卡把剩余的人工验收项显式列出，验收通过前 PR 不得合入 `dev`。

## 已知边界（先读，避免误报）

1. **目标地址是公开反馈入口**：`dangjingtao@gmail.com` 由 `CONTACT_EMAIL` 常量持有，不承载凭据或身份敏感信息；不要把任何账号密钥、个人识别信息写入常量。
2. **客户端由系统决定**：调用的是 `Linking.openURL('mailto:...')`，最终唤起哪个邮件 App 由系统 URL Scheme handler 决定，移动端不强绑 Gmail / Outlook / 系统邮件等具体 Provider。
3. **iOS「邮件」未配置的回退**：iOS 上若用户从未在系统设置里添加过邮件账户，第一次按按钮会先由系统弹「未配置邮件账户」sheet，然后跳回 App；我们的 Alert 兜底不会覆盖系统 sheet，这是预期行为。
4. **本卡验收的是 UI 接线 + 真机唤起行为**，不是邮件服务器端可达性 —— 后者由维护者在邮箱侧验证。
5. **未通过 PR #151 构建的情况下不要伪造包**：本卡所有用例一律基于 PR #151 的 CI artifact。

## 安装包来源（合并前 dev release 不含本功能）

- **Android 真机（必须）**：GitHub → PR #151 → Checks → *Android debug build* → 下载 artifact `uichat-mira-mobile-android-debug`（下载 PR artifact 需登录 GitHub）。
- **iOS 真机 / 模拟器（必须）**：Checks → *iOS simulator and unsigned device builds* → artifact `uichat-mira-mobile-ios-simulator`；或同 job 的 `uichat-mira-mobile-ios-unsigned-device`（未签名 IPA，按 `docs/ios-free-sideload-windows.md` 自签侧载）。
- 无条件做真机时可用模拟器，但 Android 真机结果不可被模拟器替代。

## 验收用例

1–3 在 **Android 真机**必测；iOS 至少覆盖 1、2、3。凡"按下后唤起什么"以**实际系统行为**为准，不接受"看起来触发了就 PASS"。

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 入口可达 | 设置 → 账户 → 电子邮件 | 行副标题显示 `dangjingtao@gmail.com · 发送反馈`；右侧 chevron 正常显示；行无 disabled 灰态 |
| 2 | 唤起系统邮件 App（Android） | 安装了任意一个邮件客户端（Gmail / 系统邮件 / Outlook 等任一），按下按钮 | 系统弹出应用选择器；选择任一客户端后跳到"撰写新邮件"，收件人预填 `dangjingtao@gmail.com` |
| 3 | 唤起系统邮件 App（iOS） | iOS 系统设置里已添加任意邮件账户，按下按钮 | iOS 弹出"未配置邮件账户"或直接跳转到默认邮件 App 的撰写界面；收件人预填 `dangjingtao@gmail.com` |
| 4 | 主题 / 正文留空 | 同 2 或 3，唤起后 | 主题、正文为空；不允许 App 自动塞入任何文案或营销文案 |
| 5 | 兜底提示：Android 卸载所有邮件客户端 | adb 卸载 / 停用所有能处理 `mailto` 的 App 后按下按钮 | App 内弹出 `Alert.alert("无法打开邮件客户端", ...)`，提示用户可手动发件至该地址；按"确定"关闭 Alert，回到原设置页；之后再按一次行为一致 |
| 6 | 兜底提示：iOS 未配置邮件账户 | iOS 系统设置 → "邮件" → "账户" 清空所有账户后按下按钮 | 系统层先弹 iOS 自己的 sheet 告知未配置账户；用户确认后回到 App；不会显示 App 的兜底 Alert —— 这是预期 |
| 7 | 多次连按 | 连续按按钮 5 次，每次先取消选择 / 关闭 | 不出现重复 Alert 叠加、不出现 App 卡顿；每次行为一致 |
| 8 | 外观联动 | 切到深色模式 + 切重点色，再查看本行 | 行图标、副标题文字、chevron 在深浅色下都可读；Alert 文字在深色背景下对比度可接受 |
| 9 | 网络无关 | 飞行模式下按下按钮 | 与在线时行为一致（mailto 不依赖网络）；不应该出现"网络错误"提示 |
| 10 | 字段恒定 | 查 SettingsScreen.tsx，确认邮箱地址仅出现在 `CONTACT_EMAIL` 常量 | 全仓 grep `dangjingtao@gmail.com` 仅命中该常量 + 行副标题一处；不允许在 PR 注释、其它脚本、文档中再次散落 |

## Hard Constraints

- 没有真机证据不得标 PASS；不得用"模拟器看起来没问题"替代 Android 真机结论。
- 用例 5 必须在**真机**上卸载 / 停用邮件 App 后做一次，模拟器的"无 handler"不能等价证明。
- 失败项回到施工方修复，本卡重新进入待验收；不在验收记录里直接宣称已修。
- 邮箱地址变更不在本卡范围；如需改地址或加多收件人，新建独立任务卡，不要在 MOB-052 上改 `CONTACT_EMAIL`。

## 结果记录（验收人填写）

设备：＿＿＿＿＿＿（型号 / 系统版本 / 包来源 / commit SHA）

| 用例 | Android | iOS |
|---|---|---|
| 1 入口可达 | | |
| 2 唤起（Android） | | |
| 3 唤起（iOS） | | |
| 4 主题/正文 | | |
| 5 兜底（Android 无 handler） | | |
| 6 兜底（iOS 未配置） | | |
| 7 多次连按 | | |
| 8 外观联动 | | |
| 9 飞行模式 | | |
| 10 字段恒定 | | |

## Handoff

用例 1–9 全部 ✅（iOS 按上述最小集）→ 本卡标 PASS，PR #151 可合入 `dev`，状态回写 `docs/workbench/00-work-ledger.md`。用例 10 是结构化检查，PASS 也并入 PASS 项。任一核心项 ❌ → 失败项回到施工方修复，本卡重新进入待验收。