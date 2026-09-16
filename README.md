# UIChat Mira Mobile

Mira 官方移动端工程，基于 React Native 构建。

## 项目定位

移动端是用户随身连接 Mira Host 的入口，负责移动交互、设备能力和可靠连接。

当前处于基建阶段，首要目标是建立稳定、可维护、可验证的移动端骨架。

## 技术栈

- **React Native 0.86** - 跨平台移动端框架
- **TypeScript** - 类型安全开发
- **Kotlin / Swift** - Android / iOS 原生开发
- **Safe Area Context** - 安全区域适配

## 环境要求

- Node.js 22.x (>= 22.11.0)
- Android SDK 36+ / API 24+
- JDK 17+
- iOS 15.0+

## 快速开始

```sh
# 安装依赖
npm install

# 启动 Metro 打包器
npm start

# 运行 Android
npm run android

# 运行 iOS（首次需安装 Ruby 与 CocoaPods 依赖）
bundle install
cd ios && bundle exec pod install && cd ..
npm run ios

# 类型检查
npm run typecheck

# 运行测试
npm test

# 代码检查
npm run lint
```

## 项目结构

```text
src/
├── api/           # Mira Host API 适配层接口
│   └── miraHost.ts
├── types/         # 共享类型定义
│   └── index.ts
└── screens/       # 页面组件
    └── HomeScreen.tsx
```

## 分支流程

仓库遵循 Mira Organization 的环境模型：

```text
feat/* -> dev -> test -> prod
```

- `feat/*`：隔离功能、修复、文档和基础设施改动；只做 CI，不部署共享环境，正常情况下合入 `dev`。
- `dev`：日常集成与开发验证分支；运行完整 Mobile CI，并维护 dev Release / R2 产物。
- `test`：测试与验收分支；只接收从 `dev` 晋级的已验证改动。
- `prod`：生产来源分支；只接收从 `test` 晋级的改动，并负责正式发布。
- `predev`：仓库历史遗留的缓冲/预验证分支，保留其现有工作流职责，但不属于 Organization 标准环境链。

GitHub 默认分支只是仓库 UI / 工作流入口选择，不改变上述环境语义。详细约束见 [AGENTS.md](./AGENTS.md) 以及 Organization 的工程规范。

## Android 构建与签名

Debug 构建使用 Android 工具链维护在用户目录中的标准 debug keystore。仓库不会提交 `debug.keystore`，干净环境首次构建时由工具链创建或复用本机凭据。

快速安装已有 APK 时，可以把 APK 文件直接拖到仓库根目录的 `install-release-apk.bat` 上；也可以双击该脚本后粘贴 APK 完整路径。脚本会自动查找 ADB、检测已授权设备、覆盖安装并启动应用。只有签名不一致时，脚本才会在明确提示会清除本地数据后询问是否卸载旧版。

Release 构建禁止回退到 debug 签名。构建 release 前，必须通过 `~/.gradle/gradle.properties` 或环境变量提供以下四项：

```properties
MIRA_RELEASE_STORE_FILE=/absolute/path/to/release.keystore
MIRA_RELEASE_STORE_PASSWORD=<store-password>
MIRA_RELEASE_KEY_ALIAS=<key-alias>
MIRA_RELEASE_KEY_PASSWORD=<key-password>
```

GitHub Actions 构建签名 release APK 时，还需要在仓库 Secrets 中配置：

```text
MIRA_RELEASE_KEYSTORE_BASE64
MIRA_RELEASE_STORE_PASSWORD
MIRA_RELEASE_KEY_ALIAS
MIRA_RELEASE_KEY_PASSWORD
```

`MIRA_RELEASE_KEYSTORE_BASE64` 是 release keystore 的单行 Base64 内容。`dev` 或 `prod` 分支推送，或在这两个分支手动运行
`Mobile CI` 时，工作流会构建签名 APK，验证内置 JavaScript bundle、SVG 原生库和 APK 签名，并上传
`uichat-mira-mobile-android-release` artifact。

任何一项缺失时，release 任务会明确失败。签名文件和真实密码不得提交到仓库。

生成本地 release keystore 的示例：

```sh
keytool -genkeypair -v -keystore release.keystore -alias <alias> -keyalg RSA -keysize 2048 -validity 10000
```

## iOS 免费真机侧载

主工作流 `.github/workflows/mobile-ci.yml` 会在同一个 macOS Job 中构建：

- 无签名 iOS Simulator Debug 压缩包。
- 面向 `iphoneos` / `arm64` 的无签名 Release IPA。

没有 Mac、没有付费 Apple Developer Program 的开发者，可以在 Windows 上使用自己的免费 Apple Account，通过 Sideloadly 临时签名并安装到 iPhone。

该方式仅用于开发测试，免费签名有效期为 7 天，不属于正式分发。CI 构建和 IPA 结构已经验证通过；真实 iPhone 的侧载、启动和功能表现仍需真机验证。

完整准备、安装、续签和排错步骤见：

[docs/ios-free-sideload-windows.md](./docs/ios-free-sideload-windows.md)

## 持续集成

`.github/workflows/mobile-ci.yml` 在 Pull Request 和目标分支推送时执行；`feat/*` 另外由轻量 `Feature CI` 做 typecheck / lint / test 门禁，不部署共享环境。

完整的 Job 依赖、版本 Tag、签名、R2 地址和已知技术债见 [GitHub Actions 构建与发布](docs/github-build-release.md)。

- TypeScript 类型检查、ESLint 和 Jest。
- Android `assembleDebug` 干净环境构建。
- iOS CocoaPods 安装、Simulator Debug 构建及 unsigned device Release IPA 构建。
- `dev` 推送通过全部检查及签名 Release 构建后，按 `package.json` 的版本更新 `v<version>-dev` 预发布，并同步到 Cloudflare R2 的 `mira/mobile/dev/latest/`。
- `prod` 推送通过发布检查后，按 `package.json` 的版本创建不可改指向的 `v<version>` 正式 Tag；同一版本不得发布不同提交。

当前 `dev` Release 与 R2 产物包括：

- Android Debug APK。
- 使用正式 keystore 签名的 Android Release APK。
- iOS Simulator ZIP。
- iOS unsigned device IPA 及其 SHA-256。
- 汇总校验文件 `SHA256SUMS.txt`。

unsigned device IPA 不能直接安装，必须由安装者在 Windows 本地完成临时签名。正式发布仍由 `prod` 分支执行。

## 说明

本项目处于早期阶段，协议细节将随 Mira Host 演进逐步明确。
