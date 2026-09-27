# MOB-028B：R2 分支隔离更新客户端

状态：**PASS**（PR #84，squash merge `d8134ba`）

执行仓库：`dangjingtao/uichat-mira-mobile`

目标分支：`dev`

前置：`MOB-028A`（PASS）

## 背景

MOB-028 原客户端通过 GitHub Releases API 获取最新版本与 APK asset URL。最新产品决策已改为：Mira Mobile 的运行时更新链路必须走 Cloudflare R2；每个构建只比较自己分支 / channel 的版本，不跨 channel 扫描、选择或下载。

## 目标

将现有 About 页更新检查改为 R2 manifest 驱动，同时保留已完成的更新红点、确认下载、失败重试等交互。

## Channel 隔离合同

客户端必须使用 build-time channel truth，并映射到唯一 R2 manifest：

```text
predev -> https://assets.tomz.io/mira/mobile/predev/latest/latest.json
dev    -> https://assets.tomz.io/mira/mobile/dev/latest/latest.json
test   -> https://assets.tomz.io/mira/mobile/test/latest/latest.json
prod   -> https://assets.tomz.io/mira/mobile/prod/latest/latest.json
```

一个构建只能请求自己的 manifest。

禁止：

- dev 扫描 prod / test；
- prod 接受 dev prerelease；
- 通过 GitHub Releases 列表选择“最高版本”；
- 通过版本字符串猜 channel；
- 某个 channel 请求失败时自动 fallback 到另一个 channel。

## 更新判断

客户端读取 `latest.json` 后：

1. 校验 `channel` 必须与当前构建 channel 一致；
2. 解析 `version` 为基础 semantic version；
3. 只与当前安装包的基础版本比较；
4. 远端版本更高才显示可更新状态；
5. 相同或更低版本不提示更新；
6. manifest 非法、channel 不匹配或网络失败都属于可重试错误，不能伪装成“已是最新”。

展示版本使用 manifest / build truth 定义的 `displayVersion`，例如 `0.1.3-dev`。

## Android 下载合同

用户确认更新后，从**当前 manifest 对应的同 channel R2 版本化路径**下载 signed Release APK。

MOB-028A 的 manifest 形态：

```json
{
  "version": "0.1.3",
  "channel": "dev",
  "displayVersion": "0.1.3-dev",
  "apk": "releases/0.1.3/uichat-mira-mobile-release.apk",
  "sha256": "<sha256>"
}
```

`apk` 相对于当前 channel root 解析：

```text
https://assets.tomz.io/mira/mobile/<channel>/<apk>
```

客户端必须验证：

- `channel` 与当前构建 channel 完全一致；
- `apk` 只能是相对路径；
- 路径必须严格落在 `releases/<manifest.version>/` 下；
- 文件名必须是 signed Release APK canonical name；
- 不接受 `..`、绝对 URL、跨 channel 路径或其它域名。

固定 `latest/uichat-mira-mobile-release.apk` 继续可供人工 / 测试直接下载，但**不是 MOB-028 客户端安装源**，避免发布时出现旧 manifest 与新可变 APK 短暂错配。

MVP 继续交给系统 / 浏览器下载：

- 不申请 `REQUEST_INSTALL_PACKAGES`；
- 不静默安装；
- 不绕过 Android 安装确认；
- 不下载 debug APK。

## iOS

保持当前诚实合同：若没有可直接安装的已签名分发产物，只显示更新信息 / 分发说明，不伪装成一键安装。

## GitHub Releases

MOB-028 的客户端运行时链路已经移除对 GitHub Releases API 的依赖。

GitHub Release / Tag 可以继续由 CI 生成，作为：

- 归档；
- 版本追溯；
- 人工查看。

但 About 页版本检查、最新版本判断和 Android APK 下载不依赖 GitHub Releases API / asset URL。

## Scope

- 重构 `src/update/appUpdate.ts`，改为解析 R2 `latest.json`。
- 移除客户端 GitHub Releases 列表扫描与 asset URL 选择逻辑。
- 复用 MOB-028 现有 About UI 与交互，不重复重做页面。
- channel mapping 只消费 MOB-028A 的 build truth。
- 保留 semantic version compare helper。

## Hard Constraints

- R2-only runtime update path。
- 一个构建只读一个 channel。
- manifest channel 不匹配必须拒绝。
- 不 fallback 到其他 channel。
- 不允许 manifest 把客户端下载导向任意第三方地址。
- 不允许客户端更新下载使用可变 latest APK mirror。
- 不降低已有网络失败、取消下载、缺产物等错误处理质量。

## Validation

自动化覆盖：

1. dev 只请求 dev manifest；
2. test / predev / prod 分别只请求自身 manifest；
3. manifest channel mismatch 被拒绝；
4. `0.2.9` vs `0.2.10` 比较正确；
5. 当前版本 = 最新版本；
6. 当前版本高于远端版本；
7. 网络失败不返回“已是最新”；
8. manifest 非法 / 缺 APK 字段时不触发下载；
9. APK 路径只能落在当前 channel 的 `releases/<manifest.version>/`；
10. 绝对 URL、`..`、跨 channel / 跨版本路径被拒绝；
11. GitHub Releases API 不再出现在客户端更新请求路径中。

最终门禁：

```text
npm run typecheck  -> PASS
npm run lint       -> PASS
npm test -- --runInBand -> PASS
OpenCode PR Review -> NO_BLOCKING_FINDINGS / no P0-P2
```

MOB-028A 已提供真实 `dev/0.2.11` R2 manifest、signed APK checksum 与发布成功证据，因此 B 的客户端合同不是只对 mock schema 验证，而是与已落地的发行真相一致。

原任务卡列出的 Android 真机下载 / 取消 / 系统安装确认 smoke 未在本次 PR Review 中独立执行。产品负责人于 2026-09-02 基于当前自动化、AI Review、A 卡真实 R2 发布证据与实现范围，接受本卡为 PASS；上述真机行为继续作为版本回归 / dogfood 观察项，不再阻断 MOB-028B 状态。

## Final Implementation

PR #84 已 squash 合入 `dev`，merge commit `d8134ba0642e9b130eacea8c1b6761041add994e`。

最终实现：

- 客户端只请求 `assets.tomz.io/mira/mobile/<current-channel>/latest/latest.json`；
- manifest 必须匹配当前 channel、semantic version、display version、SHA-256 与 canonical versioned APK path；
- Android 只打开同 channel 的 R2 signed Release APK；
- iOS 在没有已签名可安装产物时只显示更新信息；
- GitHub Releases API 已从运行时更新实现中移除；
- 自动化覆盖四 channel 映射、channel mismatch、版本比较、网络/HTTP/非法 manifest、跨域/跨版本/`..`/latest mirror APK 路径拒绝。

## Handoff

MOB-028A / MOB-028B 的 R2 release truth 与 runtime client 合同均已落地。后续若修改 manifest schema、R2 prefix 或 channel truth，必须同时维护 A/B 合同与对应自动化，不允许重新引入第二套更新源。
