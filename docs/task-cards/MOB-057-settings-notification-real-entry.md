# MOB-057：设置 → 通知基础能力与真机验收

状态：**施工中**（2026-10-04 根据 Redmi K70 真人验收发现扩大范围；原“仅跳系统通知设置页”实现不足以构成真实通知功能）

负责人：待指派

执行仓库：`uichat-mira/mira-mobile`

关联 Issue：#168

历史实现 PR：#169

## 背景

原实现只把“通知”占位行接到了系统通知设置页。2026-10-04 在 Redmi K70 / HyperOS 真人验收时，虽然跳转目标正确，但系统页全部灰置，并显示“此应用未发布任何通知”。

代码核对后确认根因不是单纯 OEM 异常，而是 Mobile 当时：

- Android manifest 未声明 `POST_NOTIFICATIONS`；
- 未创建 NotificationChannel；
- iOS 也没有 UserNotifications 基础桥；
- App 没有任何本地 / 远程通知发送能力。

维护者决定：既然 UI 已存在，就补足**真实通知基础能力**；但 AI / Agent 回复完成通知不在本卡内。

## 本卡交付

### 通用 UI

设置 → 通用 → 通知进入独立通知页面，页面提供：

1. 真实通知权限状态；
2. 主动请求通知权限；
3. 发送一条真实系统测试通知；
4. 打开系统通知设置。

### Android

- 声明 `android.permission.POST_NOTIFICATIONS`；
- App 启动时创建 `mira_messages` channel；
- Android 13+ 仅在用户主动操作时请求运行时通知权限；
- 权限状态同时考虑系统 master 与 channel 是否被禁用；
- 测试通知标题为“**Mira 通知测试**”；
- 点击测试通知回到 Mira；
- 系统通知设置页可以真实管理声音、振动、锁屏和 channel。

### iOS

- 使用系统 `UserNotifications`；
- 读取 / 请求通知权限；
- 可发送真实本地测试通知；
- App 在前台时测试通知仍可展示；
- 点击通知由系统回到 Mira；
- 当前无 iOS 真机，CI build / Simulator / 自动化作为基础证据。

## 明确不做

- FCM / APNs 远程推送；
- AI / Agent 回复完成通知；
- Host Run completion push；
- 设备 push token 注册；
- Local Provider / Agent 后台持续执行；
- 会话 deep-link；
- 应用内多种通知分类偏好开关。

## 自动化验收

- `notificationSettings.test.ts` 覆盖：
  - 真实权限状态读取；
  - Android 13+ runtime permission；
  - Android < 13 无 runtime permission 路径；
  - iOS native permission；
  - 测试通知 native bridge；
  - Android / iOS 系统设置跳转；
  - unsupported platform。
- Typecheck / Lint / Jest 全绿。
- Android debug build 全绿。
- iOS Simulator + unsigned device build 全绿。
- Mira Gate 全绿。

## Android 真人验收（当前主验收面）

设备：Redmi K70 / HyperOS

只需要测以下核心流程：

1. **进入通知页**
   - 设置 → 通用 → 通知；
   - 应进入 Mira 自己的通知页面，而不是立即跳系统设置。

2. **权限**
   - 若未授权，页面显示“未允许 / 尚未授权”；
   - 点“通知权限”，Android 13+ 应出现系统通知权限请求；
   - 允许后页面显示“已允许”。

3. **测试通知**
   - 点“发送测试通知”；
   - 应收到标题“**Mira 通知测试**”的真实系统通知；
   - 通知正文为“通知功能已正常启用。”；
   - 点击通知应回到 Mira。

4. **系统通知设置**
   - 点“系统通知设置”；
   - 应进入 Mira 对应系统通知页；
   - 不应再是“应用未发布任何通知”的空壳；
   - `Mira 消息` channel 应可见 / 可管理（OEM 页面命名与层级可不同）。

5. **关闭后状态同步**
   - 在系统设置里关闭 Mira 总通知或关闭 `Mira 消息` channel；
   - 返回 Mira 通知页；
   - 页面状态应反映为未允许；
   - 重新开启后再回 Mira，应恢复为已允许。

## iOS 验收口径

当前没有 iOS 真机，不要求维护者额外准备设备。

- iOS CI build 必须通过；
- native UserNotifications bridge 与 JS contract 必须有自动化证据；
- 真机结果记 `validation gap: iOS real device unavailable`；
- 不得把 Android PASS 写成 iOS 真机 PASS。

## Handoff

Android 真人核心 1–5 通过 + CI / 自动化绿色，即可判 MOB-057 PASS 并关闭 #168。

AI / Agent 回复完成通知即使尚未实现，也**不阻塞**本卡；那是后续独立通知产品能力。
