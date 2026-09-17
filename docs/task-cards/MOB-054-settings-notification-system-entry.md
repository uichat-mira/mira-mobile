# MOB-054：设置 → 通知 真实功能与真机验收

状态：**待验收**（代码已随 PR #152 进入 review；本卡只负责真机人工验收，不包含新施工）

负责人：待指派（真机验收人）

执行仓库：`uichat-mira/mira-mobile`（原始指令目标仓库 `uichat-mira/uichat-mira-mobile` 是同一仓库的改名前地址，GitHub 当前重定向到本仓；dev 头 SHA 相同）

首次派卡基线：`feat/settings-notification-entry`（基于 `dev@0d9f3a0`）

关联 PR：#152

## 背景

设置 → 通用分组下的「通知」行历史上是一个无 `actionId` 的占位行 —— `SettingsRow` 检测到没有 actionId 时整行 disabled 并隐藏 chevron，看起来像设置项，按下没有任何响应。本 PR 把它接通到真实的系统通知管理出口。

## 已知边界（先读，避免误报）

1. **本卡交付的是"系统通知设置管理入口"，不是推送通知能力**：Mira Mobile 当前不发送任何本地 / 远程推送通知。行内不伪造通知列表、应用内偏好开关或"测试通知"按钮。
2. **副标题在各平台恒为「在系统设置中管理」，不显示"已允许 / 已关闭"——这是显式的诚实缺省，不是 bug**：
   - iOS：仓库 `ios/Podfile` 的 `setup_permissions` 只启用了 `'Camera'`，未启用 react-native-permissions 的 `Notifications` 子规格，读不到授权状态。
   - Android：manifest 未声明 `POST_NOTIFICATIONS`，`PermissionsAndroid.check()` 对未声明权限恒返回 `false`，读出来只会是伪造的"已关闭"。
   - 真实授权状态以跳转后的系统页面显示为准。启用 App 内状态展示需要先补 manifest 声明与 iOS 子规格（原生工程变更 + pod install），归未来通知能力卡。
3. **跳转目标由系统决定**：Android 通过 `Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', APP_PACKAGE=io.tomz.mira.mobile)` 直达 Mira 的应用通知设置页（Android 8+）；iOS 通过 `Linking.openSettings()` 打开系统设置中 Mira 的应用设置页，用户从该页的「通知」入口管理。
4. **API < 26 的设备没有"应用通知设置"系统页**：sendIntent 会失败，App 弹一次兜底 Alert 提示手动路径；跳转请求进行中忽略连按（in-flight 锁），失败路径上不会叠出多个 Alert。minSdk 24 / targetSdk 36，此类设备占比可忽略，但兜底路径必须可用。
5. **本卡验收的是 UI 接线 + 真实跳转 + 兜底行为**，不验证"通知是否真的能弹出来"（App 当前无通知可发）；`POST_NOTIFICATIONS` 权限声明与推送链路归未来的通知能力卡。
6. **未通过本 PR 构建的情况下不要伪造包**：本卡所有用例一律基于 PR #152 的 CI artifact。

## 安装包来源（合并前 dev release 不含本功能）

- **Android 真机（必须）**：GitHub → PR #152 → Checks → *Android debug build* → 下载 artifact `uichat-mira-mobile-android-debug`（下载 PR artifact 需登录 GitHub）。
- **iOS 真机 / 模拟器（必须）**：Checks → *iOS simulator and unsigned device builds* → artifact `uichat-mira-mobile-ios-simulator`；或同 job 的 `uichat-mira-mobile-ios-unsigned-device`（未签名 IPA，按 `docs/ios-free-sideload-windows.md` 自签侧载）。
- 无条件做真机时可用模拟器，但 Android 真机结果不可被模拟器替代。

## 验收用例

用例 1–5 在 **Android 真机（含 Android 13+）**必测；iOS 至少覆盖 1、3、6、7、8。凡"按下后跳到哪 / 显示什么"以**实际系统行为**为准，不接受"看起来触发了就 PASS"。

| # | 用例 | 步骤 | 预期 |
|---|---|---|---|
| 1 | 入口可达 | 设置 → 通用 → 通知 | 行右侧 chevron 正常显示，行无 disabled 灰态；副标题恒为「在系统设置中管理」，任何平台 / 任何授权状态下都不出现"已允许 / 已关闭"字样 |
| 2 | 跳转（Android） | Android 13+ 真机按下通知行 | 系统直接打开 Mira 的「应用通知设置」页（个别 OEM 可能先落到应用详情页，以实际行为为准并如实记录）；返回 App 不崩溃 |
| 3 | 跳转（iOS） | iOS 真机按下通知行 | 系统设置中 Mira 的应用设置页打开；页面内「通知」入口可见 |
| 4 | 副标题不伪造状态 | Android 13+：在系统通知设置页关闭（或重新开启）「所有 Mira 通知」→ 返回 App | 行副标题始终为「在系统设置中管理」，不随授权状态变化（App 内没有可读的真实状态源，变化即伪造） |
| 5 | 兜底 Alert（developer-only） | API 24/25 模拟器安装 debug 包后按下通知行（真机无此条件可标「未验证」，不算 FAIL） | App 内弹出 `Alert.alert("无法打开通知设置", ...)`，提示手动路径；按确认关闭后回到原设置页，可重复操作 |
| 6 | 多次连按 | 连续按通知行 5 次（前一次跳转 / 提示未结束时继续按） | 进行中的跳转只触发一次系统页 / 一次 Alert；不出现重复 Alert 叠加、不出现 App 卡顿或崩溃 |
| 7 | 外观联动 | 切到深色模式 + 切重点色，再查看本行 | 行图标、副标题文字、chevron 在深浅色下都可读 |
| 8 | 飞行模式 | 飞行模式下按下通知行 | 与在线时行为一致（跳系统设置不依赖网络）；不应出现"网络错误"提示 |
| 9 | 字段恒定（源码范围） | 在 `src/` 实现源码内 grep `io.tomz.mira.mobile`、`android.settings.APP_NOTIFICATION_SETTINGS`、`android.provider.extra.APP_PACKAGE` | 三个字面量仅出现在 `src/screens/notificationSettings.ts` 的常量定义处；不允许出现在其它实现文件、脚本或配置里（协作文档与 AndroidManifest 等既有文件除外） |

## Hard Constraints

- 没有真机证据不得标 PASS；不得用"模拟器看起来没问题"替代 Android 真机结论。
- 用例 4 必须在**真机**上完成完整的"系统页切换 → 返回"闭环，确认副标题不伪造状态。
- 用例 5 是兜底路径验证，无条件时标「未验证」并在结果记录中说明，不得伪造成 PASS。
- 失败项回到施工方修复，本卡重新进入待验收；不在验收记录里直接宣称已修。
- 启用 App 内授权状态展示（iOS `Notifications` 子规格 + Android manifest `POST_NOTIFICATIONS` 声明与运行时授权）不在本卡范围；如需，新建独立任务卡并同步更新 `Podfile.lock` / Info.plist / AndroidManifest。
- 通知推送能力（本地通知调度、远程推送）不在本卡范围。

## 结果记录（验收人填写）

设备：＿＿＿＿＿＿（型号 / 系统版本 / 包来源 / commit SHA）

| 用例 | Android | iOS |
|---|---|---|
| 1 入口可达 | | |
| 2 跳转（Android） | | |
| 3 跳转（iOS） | | |
| 4 副标题不伪造状态 | | |
| 5 兜底 Alert（API<26） | | |
| 6 多次连按 | | |
| 7 外观联动 | | |
| 8 飞行模式 | | |
| 9 字段恒定 | | |

## Handoff

用例 1–4、6–8 全部 ✅（iOS 按上述最小集）、用例 5 PASS 或如实标注「未验证」→ 本卡标 PASS，PR #152 可合入 `dev`，状态回写 `docs/workbench/00-work-ledger.md`。用例 9 是结构化检查，PASS 也并入 PASS 项。任一核心项 ❌ → 失败项回到施工方修复，本卡重新进入待验收。
