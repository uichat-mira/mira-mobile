# MOB-053：设置 → 安全真机验收与剩余接线

状态：**待验收**（代码已随本卡 PR 进入 review；本卡只负责真机人工验收，不包含新施工）

负责人：待指派（真机验收人）

执行仓库：`uichat-mira/mira-mobile`

首次派卡基线：`feat/security-screen-credential-overview -> dev`（PR 见下）

关联 PR：https://github.com/uichat-mira/mira-mobile/pull/149

跟踪 Issue：https://github.com/uichat-mira/mira-mobile/issues/150

编号说明：本卡初稿曾用 MOB-050；因维护者侧「设置 → 存储」卡已占用 MOB-050、记忆 / 邮件卡占用 MOB-051 / 052，按 CodeRabbit review finding 改号为 MOB-053，避免合并撞号。

## 背景

「设置 → 通用 → 安全」一行当前只有图标 + 标题，点击没有任何反应；既不展示本机已保存的安全凭据，也不提供"清除 / 管理"入口，是个**纯视觉入口**。这违反 `AGENTS.md` §3 「不为了移动端功能齐全而复制桌面端设置面板」与「失败时给出明确可操作错误信息」两条规则；按 §11 完成定义，UI 入口必须能解释当前凭据状态并提供可操作的管理跳转。

PR 在不引入新协议 / 不改动任何安全存储的前提下，把"安全"行替换成可点击入口，新增只读 `SecurityScreen`，聚合四类凭据：

1. Remote Host 设备凭据（`deviceCredentialStore`）。
2. Desktop Host 登录态（`desktopCredentialStore`）。
3. Local Provider API Key（`providerCredentialStore` × `ProviderConfigStore`）。
4. 拾言 Cloud 设备凭证（`loadShiyanRuntimeConfig`）。

页面**不展示** Token / API Key 本身；只显示"是否存在 / hostUrl / username / 上次保存时间"四个字段。任何修改动作均跳转到既有管理页（`HostConfig` / `LocalProviderConfig` / `ShiyanCloudConfig`），不复制桌面端清除路径。

新增 `securityStatus` 纯函数模块（`src/screens/securityStatus.ts`）负责聚合；新增单测覆盖"凭据不暴露 token"、"load 失败时回退为未保存"、"formatSavedAt 渲染"三组事实。

## 已知边界（先读，避免误报）

1. **本卡不动任何凭据实际删除逻辑**。Remote Host 设备凭据的清除仍是 `Settings → 远程连接 → 退出登录`；Desktop Host JWT 暂时没有"退出登录"UI（这是后续卡的范围，本卡不假装补完）；Provider 删除与 API Key 清除走 `Settings → 本地连接`；拾言 Cloud 凭证清除走 `Plugins → 拾言 → Cloud 配置 → 清除`。本卡在「安全」页只**展示状态 + 跳转**。
2. **不展示 Token / Key 任何片段**。UI 上看到的 `hostUrl` / `username` / `savedAt` 是非敏感元数据；不展示 token 前缀、后缀、长度。
3. **总览"已配对 / 已登录"的语义**：Remote Host 与 Desktop Host **两者取一**——当前 Mobile 路线只可能是 Remote Host（`PairedRemoteMiraHostClient`），Desktop JWT 仅在桌面端旧版残留时存在；两者同时保存属异常，本卡按"任一存在即视为已配对"展示，并在副标题里说明实际是哪一种。
4. **Provider 计数**：聚合层会尝试对每个 Provider 调用 `providerCredentialStore.load(id)`；任何 load 抛错都按"该 Provider 缺少 API Key"展示，不会冒泡到 UI。
5. **本地副本不可信**。本机真机验收记录不构成 PR 合入依据；PR 仍需走 Feature CI（typecheck / lint / Jest / Android debug build / iOS sim & unsigned device build）全绿。

## 安装包来源（合并前 dev release 不含本功能）

- **Android 真机（必须）**：GitHub → 本卡 PR → Checks → *Android debug build* → 下载 artifact `uichat-mira-mobile-android-debug`（下载 PR artifact 需登录 GitHub）。
- **iOS 模拟器**：Checks → *iOS simulator and unsigned device builds* → artifact `uichat-mira-mobile-ios-simulator`。
- **iOS 真机（可选）**：同 job 的 artifact `uichat-mira-mobile-ios-unsigned-device`，按 `docs/ios-free-sideload-windows.md` 自签侧载；无条件时用模拟器替代，但结果须注明。

## 验收用例

以下 1–8 在 **Android 真机** 必测；iOS 至少覆盖 1、2、3、5。"保持 / 记住"类用例不需要杀进程（凭据状态由 `SecurityScreen` 实时拉取）。

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 入口 | 设置 → 通用 → 安全 | 进入安全页，标题"安全"居中；返回按钮回到设置页 |
| 2 | 总览卡片渲染 | 进页 | 顶部三张总览卡（Remote / Desktop 合一、Provider、Shiyan）均渲染，无凭据时副标题含"前往 X"指引 |
| 3 | 总览语义（Remote 与 Desktop 互斥） | a) 未配对任意 Host 时 b) 仅配对 Remote Host 后重进 c) 仅 Desktop Host JWT 存在时 | a) 显示"尚未连接 Mira Host"且副标题指向"远程连接"；b) 显示"已配对 Mira Host"且副标题含 hostUrl；c) 显示"已登录 Desktop Mira Host"且副标题含 username + hostUrl |
| 4 | 总览：Provider 计数 | a) 0 Provider b) 2 Provider 但只 1 个有 API Key | a) "尚未配置 Local Provider"且副标题指向"本地连接"；b) "1/2 个 Provider 已保存 API Key"且副标题说明需前往"本地连接"补全 |
| 5 | 总览：Shiyan | a) 未配置拾言 Cloud b) 已配置 | a) "拾言 Cloud 未配置"且副标题指向 Plugins；b) "拾言 Cloud 已配置"且副标题含 baseUrl + "已在设备安全存储中保存" |
| 6 | 「安全凭据」段四行 | 每行副标题与状态一致：未保存 → "尚未保存"；已保存 → hostUrl/username + savedAt | 四行均正确渲染；「关于设备安全存储」行可跳到 About |
| 7 | 跳转管理页 | 点 "Local Provider API Key" 行；点 "Remote Host 设备凭据" 行；点 "拾言 Cloud 设备凭证" 行 | 分别进入对应管理页并能正常返回（不修改任何凭据） |
| 8 | 外观联动 | 切深色模式与不同重点色 | 卡片边框、文字、图标色在深 / 浅色下均可读；无穿帮 |
| 9 | 凭据泄露检测（developer-only） | 在真机 logcat / 调试器中确认 `SecurityScreen` 不打印 token / API Key | 只允许打印 hostUrl / username / savedAt / Provider id / Provider name / baseUrl；任何凭据本身字段名出现都算 ❌。无 logcat 条件时可标"未验证"，不阻塞 PASS |
| 10 | 读取失败（developer-only） | 调试环境注入 `deviceCredentialStore.load` 抛错 → 进页面 | 总览 Remote 卡显示"尚未连接 Mira Host"且页面其余段仍可正常展示；不出现空白屏 |

## Hard Constraints

- 没有真机证据不得标 PASS；不得用"模拟器看起来没问题"替代 Android 真机结论。
- 跳转用例（7）必须实际打开目标页并能正常返回；"看起来点了"不算。
- 发现失败时记录：设备型号、系统版本、包来源 / commit、复现步骤、截图或录屏；从最新分支开 fix，不在验收记录里直接宣称已修。

## 结果记录（验收人填写）

设备：＿＿＿＿＿＿（型号 / 系统版本 / 包来源 / commit）

| 用例 | Android | iOS |
|---|---|---|
| 1 入口 | | |
| 2 总览渲染 | | |
| 3 Remote/Desktop 互斥 | | |
| 4 Provider 计数 | | |
| 5 Shiyan | | |
| 6 安全凭据段 | | |
| 7 跳转管理页 | | |
| 8 外观联动 | | |
| 9 凭据泄露 | | |
| 10 读取失败 | | |

## Handoff

1–8 全部 ✅（iOS 按上述最小集）+ 用例 9、10 至少一个 ✅ / 已标注未验证 → 本卡标 PASS，PR #149 可合入 `dev`，状态回写 `docs/workbench/00-work-ledger.md`。任一核心项 ❌ → 失败项回到施工方修复，本卡重新进入待验收。