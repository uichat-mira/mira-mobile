# GitHub Actions 构建与发布

本文说明 `uichat-mira/mira-mobile` 的 GitHub Actions 构建、签名、版本 Tag、GitHub Release 和 Cloudflare R2 发布流程。**实际执行定义始终以工作流文件为准**：

- [`.github/workflows/feat-ci.yml`](../.github/workflows/feat-ci.yml)
- [`.github/workflows/mobile-ci.yml`](../.github/workflows/mobile-ci.yml)
- [`.github/workflows/predev-ci.yml`](../.github/workflows/predev-ci.yml)
- [`.github/workflows/r2-release-truth.yml`](../.github/workflows/r2-release-truth.yml)

## 分支与环境模型

Organization 当前标准晋级链已经启用：

```text
feat/* -> dev -> test -> prod
```

- `feat/*`：新功能、修复、文档和基础设施工作的标准隔离分支。只做 CI，不部署共享环境，正常只合入 `dev`。
- `dev`：日常集成与开发验证环境，维护 dev GitHub prerelease 和 R2 release truth。
- `test`：测试与候选验收环境，只接收从 `dev` 晋级的改动。
- `prod`：生产来源，只接收从 `test` 晋级的改动并负责正式发布。
- `predev`：仓库历史形成的缓冲 / 预验证分支，保留独立 CI 与 R2 渠道，但**不属于标准晋级链，也不是新工作进入 `dev` 的必经路径**。

仓库中仍可能保留 `feature/*`、`fix/*`、`docs/*`、`chore/*` 等迁移前历史分支；工作流对部分旧命名仍保留兼容触发。它们不重新定义当前 Organization 分支规范。

## 触发条件

### Feature CI

`Feature CI`：

- push 到 `feat/**` 时执行；
- 也支持维护者手工 `workflow_dispatch`；
- 执行 `npm ci`、Typecheck、Lint、Jest；
- 不签名、不发布、不写共享 R2 环境。

### Mobile CI

`Mobile CI`：

- 任意 Pull Request 执行；
- push 到 `main`、`dev`、`test`、`prod`、历史兼容 `feature/**` 或 `fix/**` 时执行；
- 支持维护者手工 `workflow_dispatch`。

其中 `main`、`feature/**`、`fix/**` 是工作流历史兼容触发，不属于当前 `feat/* -> dev -> test -> prod` 标准环境定义。

### Predev CI

`Predev CI`：

- push 到 `predev` 时执行；
- 支持维护者手工 `workflow_dispatch`。

`predev` 保留旧的完整 Android / iOS 构建和独立 R2 渠道，用于明确需要该缓冲分支的历史/专项场景，不作为所有新 PR 的路由要求。

### R2 Release Truth

`R2 Release Truth` 在 `predev`、`dev`、`test`、`prod` push 后执行，并等待该分支对应的 canonical CI 成功后才移动 R2 release truth：

- `predev` 等待 `predev-ci.yml`；
- `dev` / `test` / `prod` 等待 `mobile-ci.yml`；
- `test` 因 canonical Mobile CI 不产出签名 release APK，由 R2 Release Truth 自己在 canonical CI 成功后构建并验证签名的 arm64 test APK；
- 其他渠道复用 canonical CI 的签名 Android release artifact。

同一工作流 / 分支采用 concurrency 取消旧的进行中运行，避免较老提交覆盖新结果。

## 构建任务

| Job | 平台 | 主要检查 | 产物 |
| --- | --- | --- | --- |
| Typecheck, lint and test | Ubuntu | TypeScript、ESLint、Jest | 无 |
| Android debug build | Ubuntu | 未签名 Release 必须被拒绝、Debug APK 构建 | `uichat-mira-mobile-dev.apk` |
| Android signed release APK | Ubuntu | 正式签名、arm64 Release、R8/resource shrink、JS Bundle、原生库、APK 完整性和签名 | `uichat-mira-mobile-release.apk`、SHA-256 |
| iOS simulator and unsigned device builds | macOS | CocoaPods、无签名 Simulator Debug、无签名 `iphoneos` Release、`arm64`、JS Bundle、IPA 结构与无 provisioning profile | Simulator ZIP、unsigned device IPA、SHA-256 |

iOS 两类构建复用同一个 macOS Job，避免重复安装 Node、Ruby、CocoaPods 和依赖。

`Mobile CI` 的签名 Android Release 只在当前工作流条件允许的环境 / 手工场景运行；普通 PR 上该 Job 可以按条件跳过。是否允许发布不能只看某个单 Job，而必须看目标环境的 canonical CI 和后续发布 / R2 workflow 是否完整成功。

## iOS unsigned device 验证状态

CI 已验证：

- `iphoneos` / Release 可以编译；
- 可执行文件包含 `arm64`；
- `main.jsbundle` 已内置；
- IPA 使用标准 `Payload/*.app` 结构；
- IPA 不包含 `embedded.mobileprovision`；
- SHA-256 能生成并作为 Artifact 上传。

unsigned device IPA 仍不是 Apple 官方签名分发包。没有相应真机签名、安装、启动和功能证据时，只能宣称“CI 可构建 / 可打包”，不能把它写成已完成正式 iOS 分发。

## 版本与 Tag

`package.json.version` 是语义版本的唯一来源。

- Android `versionName` 直接读取 `package.json.version`。
- `dev` 预发布 Tag 为 `v<version>-dev`。
- `prod` 正式 Tag 为 `v<version>`。
- `predev` 不创建版本 Tag，只保留独立滚动构建 / R2 渠道。
- `test` 使用 branch-isolated R2 release truth，不把 test 当作 prod GitHub Release。
- 正式 Tag 已指向其他提交时，生产发布必须失败并要求先升级 `package.json.version`。
- Android `versionCode` 和 iOS build number 独立于语义版本。

## 发布目标

| 环境 | GitHub Release | R2 |
| --- | --- | --- |
| feat/* | 无 | 无共享环境发布 |
| predev | 无正式 Release | `mira/mobile/predev/` branch-isolated truth |
| dev | `v<version>-dev` prerelease | `mira/mobile/dev/` branch-isolated truth |
| test | 无 prod Release | `mira/mobile/test/` branch-isolated truth |
| prod | `v<version>` 正式发布 | `mira/mobile/prod/` branch-isolated truth |

GitHub Tag / Release 表示版本追溯；R2 `latest` manifest 表示对应环境最新成功产物。二者用途不同。

客户端当前通过对应渠道的 R2 manifest 获取更新，不应再把旧个人 GitHub 仓库 Releases API 当作当前更新事实来源。

## predev 的保留职责

`predev` 只作为仓库特有历史缓冲能力保留：

- 独立运行完整构建；
- 独立写 `mira/mobile/predev/`；
- 不移动 `dev` Tag；
- 不更新 `dev` prerelease；
- 不写 `dev` / `test` / `prod` 的 R2 truth；
- 不允许绕过 `dev -> test -> prod` 成为生产晋级捷径。

除非工作项明确要求使用 `predev`，新开发默认不再走 `feature/* / fix/* -> predev -> dev`。

## dev 发布完整性与 R2 容错

`dev` 发布必须在依赖的质量与平台构建成功后使用固定产物，并在移动 release truth 前验证产物完整性。现有发布链覆盖：

- Android Debug APK；
- Android 正式 keystore 签名 Release APK及 SHA-256；
- iOS Simulator ZIP；
- iOS unsigned device IPA 及 SHA-256；
- 汇总校验 / manifest。

R2 发布脚本应保持失败即不移动 latest truth 的原则。网络或上传失败不能把不完整的产物标成当前最新版本。

## 必需 Secrets

Android Release 签名：

- `MIRA_RELEASE_KEYSTORE_BASE64`
- `MIRA_RELEASE_STORE_PASSWORD`
- `MIRA_RELEASE_KEY_ALIAS`
- `MIRA_RELEASE_KEY_PASSWORD`

Cloudflare R2：

- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_PUBLIC_BASE_URL`

工作流只在 Runner 临时目录恢复 keystore，不得将签名文件或真实密码提交到仓库。iOS unsigned device 构建不需要 Apple Account、证书或 provisioning profile；这些凭据也不得误写入普通仓库配置。

## Release JVM / Android 构建约束

GitHub 的签名 Release 使用受控 JVM / Gradle 参数，避免历史上 `lintVitalAnalyzeRelease` 出现 Metaspace OOM。当前 release 还启用了：

- `minifyEnabled`；
- `shrinkResources`；
- canonical release workflow 对手机直装 APK 使用 `-PreactNativeArchitectures=arm64-v8a`；
- APK 内容和签名验证。

`android/gradle.properties` 的默认 `reactNativeArchitectures` 仍保留多 ABI，服务本地 / Debug / 模拟器兼容；不能据此推断正式发布 APK 仍是四 ABI 通用包。

## 历史技术债：通用 APK 体积过大

状态：**已处理（PR #98，2026-09-05）**

早期 `v0.1.2-dev` 的签名 Release APK 曾约 105.8 MB，根因之一是同时打入四套 ABI 原生库。PR #98 已把手机 Release 路径收敛为 arm64，并启用 R8 与 resource shrinking，同时保留 Debug / 模拟器所需的多 ABI 默认配置。

当前判断 release 体积问题时，应查看实际 release workflow 的参数和构建摘要，不再使用旧的“四 ABI 通用 Release”描述作为当前事实。

若未来需要 32 位 ARM 或其他 ABI，应显式设计独立产物 / 分发策略，不重新让一个未标识架构的通用 APK 混入所有 ABI。

## 发版检查

发布 / 晋级前至少确认：

1. 来源与目标符合 `feat/* -> dev -> test -> prod`；若使用 `predev`，工作项明确说明其专项目的。
2. `package.json.version` 与目标 release 语义一致。
3. 目标环境的 canonical Typecheck、Lint、Jest 与所需 Android / iOS 构建成功。
4. 需要签名 APK 的环境已验证正式签名、arm64 ABI、`assets/index.android.bundle` 与预期原生库。
5. APK / IPA 的结构与 SHA-256 校验成功。
6. unsigned device IPA 包含 `arm64` 和 `main.jsbundle`，且不包含 provisioning profile。
7. GitHub Release / Tag（适用时）、目标提交和版本一致。
8. R2 release truth 来自同一目标分支、同一 SHA 对应的 canonical CI，不得跨分支借用成功构建。
9. R2 manifest / 产物已经成功发布后，才能宣称对应渠道更新完成。
10. 在宣称真机可用前，补足任务合同要求的 Android / iOS / Host / Provider / network 真机或联调证据。
