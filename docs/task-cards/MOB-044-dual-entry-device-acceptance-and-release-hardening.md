# MOB-044：双入口真机验收与发布加固

状态：**DOING**（2026-09-07 已开始总验收；先收自动化/发布链证据，Android/iOS 真机矩阵持续补齐；2026-09-12 Android 真机档位 1 基础链路（1/3/9/10/11）已 PASS，iOS 全挂）

范围：Mira Mobile；Android / iOS；真实 Mira Host 与真实 OpenAI-compatible Provider

依赖：MOB-038、MOB-039、MOB-040；MOB-042；如验收真实远程工具或持久任务，还依赖 MOB-041、MOB-043

## 目标

用真实设备、真实安全存储、真实 Provider 和已批准的远程服务完成双入口功能验收，并把发现的问题回流到对应实现卡或新修复卡。

## 验收矩阵

- Android / iOS 保存、读取、掩码和清除 Provider API Key。
- 多 Provider 切换、选定 Provider 新建会话和会话归属。
- 远程 Host / 本地 Provider 来源菜单、Drawer、聊天头部和空状态。
- 本地流式输出、弱网、网络切换、取消、超时、失败重试和幂等 transcript。
- App 前后台切换、挂起恢复和本地 Agent 状态解释。
- 使用 MOB-041 的真实 `ToolGatewayClient` Adapter 验证工具发现、真实调用、取消、错误映射与审批 envelope，不以 Mock Gateway 代替。
- 使用 MOB-042 的真实审批 UI 验证 approval-required -> 批准/拒绝 -> Agent 继续/终止闭环。
- 如 MOB-043 已具备可用持久运行时，验证真实 Host / Pi durable run 的创建、状态恢复、取消以及 App 重启后的服务端事实重载。
- 真实 Provider 的 401、403、404、429、5xx 和不兼容 SSE 响应。
- 既有 Remote Host 配对、流式消息和 Agent 审批回归。
- 发布构建、日志脱敏、崩溃路径和安装升级检查。

## 非目标

- 不把模拟器结果当作完整真机验收。
- 不用 Mock Gateway 结果替代真实协议联调证据。
- 不因构建环境失败而修改产品安全边界或关闭类型/安全检查。

## 验收标准

- Android 与 iOS 核心矩阵均有可复现记录、截图或录屏和设备信息。
- 关键失败路径有用户可执行的下一步，不只留下日志。
- Local Provider 文本链路、真实 Tool Gateway、审批 UI 与可用的 Host/Pi 持久运行路径按对应前置卡实际能力完成联调验收；不能用局部链路通过替代整套闭环结论。
- 未发现 Provider Key、Host 凭据、Tool Gateway 凭据或完整敏感消息泄漏。
- 通过后才能将 MOB-037 以及 MOB-038、MOB-039、MOB-040、MOB-042、MOB-043 按实际证据升为 `PASS`；未通过项必须回流到对应卡。

## 交付物

- Android / iOS 验收记录。
- 版本、设备、网络条件和服务端合同版本。
- 已知问题、复现步骤、修复卡关联和发布说明。

## 2026-09-07 验收记录

当前验收基线：Mobile `dev@260fbb56`。MOB-044 仍为 **DOING**，以下只把已有证据记为通过，不把 CI / 模拟器结果冒充真机验收。

### A. 自动化 / 静态证据：已通过

- `dev@bc200bae` 的完整 Mobile CI 已成功：
  - Typecheck / Lint 通过；
  - Jest：69/69 suites、428/428 tests；
  - Android debug build 通过；
  - Android arm64-v8a signed release APK 构建与签名校验通过；
  - iOS Simulator build 通过；
  - iOS Release unsigned device build 通过，设备二进制为 arm64；
  - dev prerelease publish job 通过。
- Local Provider 自动回归已覆盖：
  - Provider URL root / `/v1` / `/api/v1`；
  - SSE `[DONE]` 与 `finish_reason`；
  - tool-call 分片、交错分片、缺 index fallback；
  - 用户取消与 Provider timeout 区分。
- Local Agent 自动回归已覆盖：
  - tool result 回灌；
  - approval-required -> approve / reject；
  - approval timeout；
  - tool result truncation；
  - app suspension；
  - uncertain approval 不误报为取消。
- Remote Tool Gateway 自动回归已覆盖：
  - model-safe alias -> canonical Host tool id；
  - approval envelope；
  - frozen invocation approve；
  - uncertain approval；
  - real invocation cancel；
  - delayed `tool:start`；
  - alias collision；
  - 非对象参数拒绝。
- Durable Host 自动回归已覆盖：
  - canonical replay；
  - terminal run 后继续发现新 run；
  - Retry 重启 same-run observer；
  - serialized polling；
  - stale observer 隔离；
  - 前后台仅停止本地观察，不取消 Host run。
- 凭据静态审计：
  - Android：AndroidKeyStore + AES/GCM；应用 `allowBackup=false`；
  - iOS：Keychain + `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`；
  - Provider Key / Remote device credential 使用独立 service namespace；
  - 未发现业务代码把 API Key、device credential 或 Authorization header 写入日志。
- iOS release hygiene：验收发现并已删除未使用且为空的 `NSLocationWhenInUseUsageDescription`；补合同测试防止回归。

### B. 发布链：门禁正常，但尚未可发布

- `R2 Release Truth` 对 `dev@bc200bae` 失败原因已定位：
  - 当前版本仍为 `0.2.14`；
  - R2 已存在不可变 `dev/0.2.14` release；
  - 新 APK 字节不同，脚本按设计拒绝覆盖并要求 bump version。
- 结论：这是**版本不可变门禁正常工作**，不是 R2 权限/上传故障。
- MOB-044 未通过前不提前 bump 版本；总验收通过后再升版本并重新发布。
- 当前 iOS target 声明 `TARGETED_DEVICE_FAMILY = "1,2"`，即同时支持 iPhone / iPad，但 AppIcon catalog 缺 iPad 152x152 与 167x167 尺寸，Xcode Release build 有明确 warning。此项在发布 PASS 前必须二选一：
  1. 补齐 iPad AppIcon；或
  2. 明确产品改为 iPhone-only，并同步 target family。
  当前不在验收中擅自改变产品支持范围。

### C. 真机 / 真实服务硬门槛：待验收

以下项目必须分别在 Android 与 iOS 真实设备记录结果，CI、模拟器和 Mock 不可替代：

1. Provider API Key：保存 -> 杀 App -> 重开 -> 读取状态 -> 掩码 -> 清除；确认日志/界面不出现完整 Key。
   - ✅ Android 1-a PASS：本地 secure-store 写入、掩码回显、清除；界面/日志无完整 Key 泄漏。
   - ✅ Android 1-b PASS：杀 App 重开后 Key 状态回显正确，掩码持续，清除后真的被删。
   - ❌ iOS PENDING
2. 多 Provider：至少两个真实 OpenAI-compatible Provider 配置，切换后新建会话归属正确，不串 Key / model / transcript。
   - ✅ Android PASS：两个 Provider URL 实测；会话归属各自 Provider，model 和 transcript 不串。
   - ❌ iOS PENDING
3. 双入口 UI：Remote Host / Local Provider 来源菜单、Drawer、聊天头部、空状态与删除后状态。
   - ✅ Android PASS
   - ❌ iOS PENDING
4. Local Provider 文本链路：真实流式输出、取消、超时、失败重试；弱网/断网恢复后 transcript 不重复。
   - ✅ Android PASS：真实 Provider 流式输出、前台取消、弱网切换后 transcript 幂等。
   - ❌ iOS PENDING
5. Provider 错误：真实或可控服务返回 401 / 403 / 404 / 429 / 5xx / 不兼容 SSE，UI 有可执行下一步。
   - ❌ Android FAIL（**bug 记录，不降级**）：owner 实测填错 URL 或 Key 时 Provider 返回真实错码，但 UI 只模糊"指出错误"、不阻断会话也不给可执行下一步。根因：`openAiCompatibleClient.ts:368` 统一用 `code: 'PROVIDER_REQUEST_FAILED'` 不区分 401/403/404/429/5xx；`getChatSendErrorMessage()` 在 `chatSessionState.ts:64-67` 已按 status 写好映射，但 error 对象没有正确携带 status 到 UI 层。**必须回流修复卡后才能重新验收**。
   - ❌ iOS PENDING
6. Remote Host 回归：既有扫码配对、Direct/Relay、会话读取、流式消息保持正常。
   - ❌ Android PENDING（需要已配对 Mira Host）
   - ❌ iOS PENDING
7. Real Tool Gateway：真实工具 discover -> invoke -> approval-required -> 手机批准 / 拒绝 -> 继续 / 终止；真实 cancel 生效。
   - ❌ Android PENDING（需要 Host + Tool Gateway）
   - ❌ iOS PENDING
8. Durable Host：长任务运行中切后台、返回前台、杀 App / 重开后从 Host 读取同一 Run；cancel 后不继续误写终态。
   - ❌ Android PENDING（需要 Host 持久运行时）
   - ❌ iOS PENDING
9. 会话生命周期：删除 Local 会话后 pin/unread 清理，最后一个该 Provider 会话删除后 Provider 可删除。
   - ✅ Android PASS
   - ❌ iOS PENDING
10. 安装 / 升级：release build 覆盖安装旧版本后，Provider 配置、secure-store credential、Remote pairing 不丢失。
    - ✅ Android PASS
    - ❌ iOS PENDING
11. 崩溃 / 前后台：核心路径无崩溃；后台不伪装持续执行本地 Agent；Remote durable run 可恢复解释。
    - ✅ Android PASS（本地 Agent 前台/后台语义已验证）
    - ❌ Android PENDING（Remote durable run 恢复解释需要 Host）
    - ❌ iOS PENDING

### D. 当前判定

- 自动化 / 静态层：**PASS**
- Android 真机：**部分 PASS + 1 条 FAIL**（1-a/1-b/2/3/4/9/10/11 通过；5 FAIL 需回流修复；6/7/8 需 Mira Host）
- iOS 真机：**PENDING**
- 真实 Provider：**PASS（Android 已走通，错误映射 FAIL 除外）**
- 真实 Host / Tool Gateway / Durable Run：**PENDING**
- 发布：**BLOCKED BY ACCEPTANCE + VERSION BUMP**
- iPad release hygiene：**OPEN DECISION / FIX**
- 新发现：**Provider HTTP status 错误映射 bug，归位 MOB-047**

因此 MOB-044 当前保持 **DOING**，不能升 PASS。Android 第 5 条需修复后重新验收。

### E. 2026-09-12 Android 真机验收记录

验收基线：Mobile `dev@8c74550`（`v0.3.0-dev`）。Android 真机分两档实测。

#### 档位 1：无服务端凭据依赖

| 条目 | 结果 | 备注 |
| --- | --- | --- |
| 1-a Provider Key 本地写入/掩码/清除 | ✅ PASS | secure-store 读写、UI 掩码、日志无完整 Key 泄漏 |
| 3 双入口 UI | ✅ PASS | 来源菜单、Drawer、聊天头、空状态与删除后状态 |
| 9 会话生命周期 | ✅ PASS | Local 会话删除后 pin/unread 清理；最后一个 Provider 会话删完后 Provider 解锁删除 |
| 10 安装/升级覆盖 | ✅ PASS | release build 覆盖安装旧版本后 secure-store credential 未丢失 |
| 11 本地 Agent 前后台语义 | ✅ PASS | 核心路径无崩溃；App 挂起/切后台时不伪装后台执行本地 Agent |

#### 档位 2：真实 Provider API Key

| 条目 | 结果 | 备注 |
| --- | --- | --- |
| 1-b Provider Key 杀 App 回显/重开/清除 | ✅ PASS | secure-store 跨进程重开正确回显；掩码持续；清除后真的删除 |
| 2 多 Provider 切换归属 | ✅ PASS | 两个 Provider URL；会话归属各自 Provider，model 和 transcript 不串 |
| 4 Local Provider 文本链路 | ✅ PASS | 真实流式输出、前台取消、弱网切换后 transcript 幂等 |
| **5 Provider 错误映射** | **❌ FAIL** | 填错 URL 或 Key 时 Provider 返回真实 HTTP 错码（401/404），但 UI 只模糊"指出错误"不阻断，也不给可执行下一步。根因：`openAiCompatibleClient.ts:368` 所有非 2xx 统一 `code: 'PROVIDER_REQUEST_FAILED'`，不区分 status；`chatSessionState.ts:64-67` 已按 status 写好错误文案映射，但 error 对象 status 没正确传到 UI 层。**回流到 MOB-047**（Provider 配置 UX + 错误提示边界） |

未完成：6/7/8/11-Remote 需 Mira Host + Tool Gateway；iOS 全部 11 条。第 5 条修复后需重新验收 Android 和 iOS。
