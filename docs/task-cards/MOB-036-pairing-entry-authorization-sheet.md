# MOB-036：桌面配对入口与授权 Bottom Sheet 收口

状态：**PASS（2026-09-04 真机五路径验收通过）**

分支：`dev`

范围：Mira Mobile

## 目标

把当前“连接桌面端”页面收成两个清晰页面和一个临时授权层：

```text
默认配对页
  ├─ 扫码配对 → 全屏扫码页
  └─ 粘贴配对链接

有效配对请求识别成功
  ↓
回到默认配对页 + 自动弹出 Mira 授权 Bottom Sheet
  ├─ 关闭 / 取消 → 清除未提交请求，回默认配对页
  └─ 提交配对申请 → 等待 Desktop 批准
                      ↓
                    成功 Toast
                      ↓
                    回首页
```

## 视觉参考

![MOB-036 pairing UX](./assets/MOB-036-pairing-ux.png)

该图片是 **UI direction / visual reference**，用于约束页面密度、留白、按钮层级和 Bottom Sheet 形态；不是像素级实现合同。若图片与本文交互或数据事实冲突，以本文为准。

## 产品决定

### 1. 默认配对页

默认状态 **不显示 Mira 授权卡片**。

只保留：

- 页面标题：`连接桌面端`
- 主标题：`设备配对`
- 一句说明：`扫描 Mira Desktop 上的配对二维码`
- 主操作：`扫码配对`
- 兜底入口：`或粘贴配对链接`
- Mira pairing URI 输入框
- `继续` 操作
- 必要的输入错误提示

删除当前常驻的：

- `Mira 授权`整块卡片
- `等待桌面配对请求`之类默认状态说明
- scope / challenge / transport 等技术信息
- 重复解释如何生成二维码的辅助文案

### 2. 全屏扫码页

复用现有 `PairingScannerModal` 的相机、权限、二维码识别、scan lock 和错误处理能力。

扫码页保持独立全屏交互，接近常见手机扫码体验：

- 全屏 Camera
- 中央扫码框
- 返回 / 关闭
- 相机权限与系统设置入口
- 无效 Mira QR 轻提示并继续扫描

本卡不重写 Remote Pairing 协议。

### 3. Mira 授权 Bottom Sheet

扫码成功或粘贴有效 Mira pairing URI 后：

1. 解析为现有 `PairingDescriptorV1`；
2. 扫码场景先关闭扫码页，回到默认配对页；
3. 自动弹出 `Mira 授权` Bottom Sheet。

授权 Sheet 只需要：

- 标题：`Mira 授权`
- 简短状态：`已识别配对请求`
- 一句说明：`提交后，请在桌面端确认此设备`
- 主按钮：`提交配对申请`
- 次操作：`取消` / 关闭

**不得显示 Desktop 设备名称。** 当前 `PairingDescriptorV1`、pairing claim response 与 poll response 都不提供 Desktop 名称；UI 不得编造类似“Tomz 的 Mira Desktop”的字段。

默认也不展示 scopes、challenge id、relay/direct、host URL 等工程信息。

### 4. 关闭行为

在尚未提交申请时关闭 / 取消授权 Sheet：

- 关闭 Sheet；
- 清除本次未提交的 `PairingDescriptorV1`；
- 回到默认配对页；
- 不留下可被误提交的 stale request。

如果已经发出 pairing claim，则不得把“关闭 UI”伪装成网络申请从未发生。实现需沿用 `useRemotePairing()` 的真实状态语义，不新增假取消协议。

### 5. 提交后的状态

点击 `提交配对申请` 后复用现有 `useRemotePairing()`：

- `claiming`：Sheet 内显示提交中；
- `waiting_approval`：显示 `等待桌面确认`，说明 `请在 Mira Desktop 上批准此设备`；
- `rejected / expired / error / blocked`：在 Sheet 内给出必要、简短的真实错误与重试/关闭入口；
- 不重新铺回页面常驻状态卡。

### 6. 成功行为

`paired` 后：

1. 保存现有 credential / connection truth，保持当前底层行为；
2. 弹出轻量 Toast：`配对成功`；
3. 自动返回首页 / 会话列表；
4. 不再停留在配对页面展示“设备已配对”成功卡片。

## 代码边界

优先复用：

- `src/components/PairingScannerModal.tsx`
- `src/screens/HostConfigScreen.tsx`
- `src/pairing/useRemotePairing.ts`
- `parsePairingUriV1()` / `PairingDescriptorV1`
- 现有 `RemoteMiraHostClient` pairing claim / poll / credential 流程

本卡不做：

- 不修改 Remote Pairing V1 字段；
- 不要求 Desktop 新增设备名字段；
- 不重写 Direct / Relay transport；
- 不新增第二套 pairing state machine；
- 不把扫码组件泛化成一个没有真实复用场景的万能 QR 框架。

## 验收

### 默认页

- 默认状态看不到 `Mira 授权`卡片。
- 首屏只有扫码主入口和粘贴兜底入口，不堆配对状态说明。
- 无效粘贴链接只显示必要错误，不打开授权 Sheet。

### 扫码

- 扫码是独立全屏页。
- 有效 Mira QR 识别成功后退出扫码页并自动打开授权 Sheet。
- 无效二维码不退出扫码页。

### 授权 Sheet

- 有效扫码和有效粘贴进入同一个授权 Sheet。
- Sheet 可关闭。
- 未提交时关闭会清掉本次 descriptor，回到干净默认页。
- Sheet 不显示无法从当前协议获得的 Desktop 名称。
- Sheet 文案保持最小必要量。

### 提交与成功

- 提交后沿用真实 `claiming → waiting_approval → paired / rejected / expired / error` 状态。
- 成功时 Toast `配对成功` 并回首页 / 会话列表。
- 不出现第二套配对协议或伪成功状态。

## 验收证据要求

代码完成后至少覆盖：

- TypeScript / lint / unit regression；
- Android + iOS 构建；
- 真机：扫码 → Sheet → 关闭；
- 真机：扫码 → 提交 → Desktop 批准 → Toast → 首页；
- 真机：粘贴 → Sheet → 提交；
- Desktop 拒绝 / 请求过期至少各一次真实或可证明的集成路径。

## 实施结果

- PR #90 `feat: refine desktop pairing authorization flow` 已 squash 合入 `dev`。
- Merge SHA：`40a57227d9cd1e6e9ec43edc9a03bc0ebda6465b`。
- 默认页已收口为扫码主入口 + 粘贴兜底；有效扫码/粘贴统一进入同一个 `Mira 授权` Bottom Sheet。
- 未提交时关闭 Sheet 会清除 descriptor 与粘贴 URI，避免 stale request 被再次误提交。
- 已提交 claim 后不会通过关闭 UI 伪装成网络取消；poll 错误恢复优先继续既有 pending claim，不重复提交 claim。
- `PAIRING_CLAIM_UNCERTAIN` 继续禁止自动重试；凭证已领取但本机保存失败的终态要求重新配对，不伪装成普通可重试错误。
- 配对成功显示轻量 `配对成功` Toast 后返回 `SessionList`。
- 未修改 Remote Pairing V1、Desktop/Host、Direct/Relay transport 或设备凭据模型。

## 当前验收证据

PR #90 最新 HEAD `b24d0e437d4215f4b8dd963c872985616f18fd2a`：

- TypeScript / ESLint / Jest：通过；
- Android debug build：通过；
- iOS Simulator build：通过；
- unsigned iPhone app build、IPA package/verify、artifact upload：通过；
- Mira Mobile OpenCode PR Review：workflow `cancelled`，未产出评审结果；产品负责人明确授权在无 AI Review 结果时由当前人工 review 判断后合并。

## Acceptance Evidence — 2026-09-04

真机五路径验收在真实 Mira Desktop + 真实 Android/iOS 设备上覆盖完成，本卡标 PASS：

1. 扫码 → Sheet → 关闭 ✅（未提交关闭清 descriptor，回干净默认页）
2. 扫码 → 提交 → Desktop 批准 → Toast `配对成功` → 首页 ✅
3. 粘贴 → Sheet → 提交 ✅（与扫码复用同一授权流）
4. Desktop 拒绝 ✅
5. 请求过期 ✅

MOB-009 同批次升 PASS；两卡的真机 5 路径互为佐证：MOB-036 验入口与 Sheet 行为，MOB-009 验兜底粘贴与协议一致性。
