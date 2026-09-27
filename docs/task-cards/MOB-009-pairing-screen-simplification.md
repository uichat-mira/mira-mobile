# MOB-009：简化桌面配对页与 Mira 链接兜底

状态：**完成**（2026-09-04 真机五路径人工验收通过：扫码配对 / 粘贴同一 Mira 链接配对 / 等待 Desktop 批准 / 拒绝·过期 / 批准并完成配对）

分支：`dev`

范围：Mira Mobile

Desktop / Host 依赖：无新增依赖

## 目标

把“连接桌面端”页面收回到用户真正需要理解的配对流程：

```text
扫码配对
  ↓
桌面授权
  ↓
连接完成
```

Direct / Relay 是连接传输细节，不再作为主流程配置项暴露给用户。

## 实施前问题（已解决）

实施前 `HostConfigScreen.tsx` 在主页面直接展示：

- `Tailscale Direct`
- `Mira Host 地址`
- 手工 Host URL 输入框
- Direct 连通状态卡
- `重新检查 Direct`
- 面向用户解释 Direct / Relay 传输选择的主文案

这使设备配对页看起来像网络诊断/工程配置页面，也让用户误以为需要理解或手工选择传输方式。MOB-009 已按下述产品决定完成产品层收口。

## 产品决定

### 主入口

保留“扫码配对”作为第一主操作。

扫码结果继续使用现有 Mira 配对协议，不新增第二套配对逻辑。

### 扫码失败兜底

在扫码按钮下方增加一个轻量输入区：

- 文案：`无法扫码？粘贴配对链接`
- 输入仅用于粘贴 Mira 配对 URI，例如：`mira://pair?...`
- 提供明确的“继续配对”操作按钮
- 输入内容复用现有 `parsePairingUriV1()` / `loadPairingUri()` 解析和状态流
- 无效 URI 显示明确的行内错误，不进入 Host URL 探测逻辑

扫码与手工粘贴最终进入同一套 `PairingDescriptorV1`、申请授权、等待 Desktop 批准和凭证领取流程。

## 已移除的主流程 UI

已从“连接桌面端”主页面删除：

- 整个 `Tailscale Direct` 卡片
- `Mira Host 地址` 标签
- 手工 Host URL 输入
- Direct 状态框
- `重新检查 Direct`
- 要求用户理解/选择 Tailscale Direct 与 Mira Relay 的产品文案

底层 Direct / Relay 能力继续保留在 transport / connectivity 层；本任务未删除底层实现。

## 页面信息层级

当前主页面保留：

1. 页面标题与设备配对说明
2. 扫码配对主按钮
3. `无法扫码？粘贴配对链接` 兜底输入
4. 当前配对请求 / 错误状态
5. Mira 授权状态（等待桌面批准、已批准、拒绝、过期、失败等）

页面不再提供独立的 Direct / Relay 选择器或 Host 地址配置区。

## 状态与错误要求

- 未载入配对请求：提示用户从 Mira Desktop 生成二维码或复制配对链接。
- 有效 Mira URI：进入与扫码相同的配对状态。
- 无效/残缺 Mira URI：显示协议解析错误，不发起错误网络请求。
- Desktop 待批准：明确显示等待授权。
- Desktop 拒绝 / 请求过期 / 安全存储不可用：继续沿用真实状态，不生成假成功。
- 配对完成后：保持当前成功进入会话列表的行为。
- 用户编辑已载入链接时清除旧 `PairingDescriptorV1`，避免旧请求残留后被误提交。

## 实现边界

- 复用现有 `parsePairingUriV1()`、`loadPairingUri()`、`useRemotePairing()`。
- 不新增第二套手工配对协议。
- 不允许把任意 HTTP(S) URL 当作配对输入。
- 不把 Relay endpoint、Direct Host URL、Tailnet 地址作为用户配置项重新暴露。
- 不修改 Mira Desktop / Host。
- 不修改 Remote Pairing V1 协议字段。
- 不删除底层 Tailscale Direct / Mira Relay transport，仅调整产品层 UI 与入口。
- 配对提交不再由 UI 层 Direct 探测状态门控；可用 transport 的最终选择仍由 `RemoteMiraHostClient` 负责。

## 实施结果

代码已通过 PR #27 `feat: simplify Mira Mobile pairing screen` squash 合入 `dev`。

- Merge SHA：`7fae64189aadda6bf7e59230d49a201e1d108b82`
- 改动范围：`HostConfigScreen.tsx`、`useRemotePairing.ts`、`remotePairingV1.test.ts`
- 未改 Remote Pairing V1、Desktop / Host 合同、设备凭据领取、批准轮询或 Direct / Relay transport 能力。

已补回归覆盖：

- 普通 HTTP(S) URL 不能作为配对输入。
- 缺少必要字段的 `mira://pair` 链接被协议解析层拒绝。
- 编辑粘贴链接时清除已载入旧请求，避免 stale request 被误授权。

## 验收

### UI / 代码级验收：已通过

- 页面主流程中看不到 `Tailscale Direct` 卡片。
- 页面主流程中看不到 `Mira Host 地址`、Host URL 输入和 `重新检查 Direct`。
- 扫码按钮下方存在 Mira 配对链接兜底输入。
- 页面不要求用户选择 Direct / Relay。
- 扫码与粘贴复用同一解析与授权状态流。
- 非 `mira://pair` 或缺少必要字段的输入不会开始配对。

### 自动化回归：已通过

同一 MOB-009 HEAD 上已通过：

- `npm run typecheck`
- `npm run lint`
- `npm test -- --runInBand`
- Android debug APK 构建与 artifact 上传
- iOS Simulator 构建与 artifact 上传
- unsigned iPhone 构建、IPA 打包校验与 artifact 上传

### 真机人工验收：待完成

任务不把自动化构建冒充真机验收。仍需使用真实 Mira Desktop + Mobile 设备覆盖五条路径：

1. 扫码配对
2. 粘贴同一 Mira 链接配对
3. 等待 Desktop 批准
4. 拒绝 / 过期
5. 批准并完成配对

五条真机路径通过后，可将 MOB-009 从“有条件完成”升级为“完全完成”。

## 非目标

- 不重做 Remote Pairing V1。
- 不调整 Desktop 二维码生成逻辑。
- 不设计网络诊断中心。
- 不删除 Direct / Relay 底层能力。
- 不顺手改其它设置页或会话页。
