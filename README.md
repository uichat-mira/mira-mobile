# UIChat Mira Mobile

Mira 官方移动端工程，基于 React Native 构建。

## 项目定位

移动端有两条独立路径：**Remote Host** 消费 Mira Host 的远端会话与工具能力；**Local Provider** 在手机端保存用户配置的模型凭据，运行本地会话与前台 Pi Core Agent。

当前重点是两条路径的可靠连接、跨端工具授权、错误恢复与 Android / iOS 真实验收。具体实现边界见 [Pi Core Local Agent 工程说明](docs/engineering/pi-core-mobile-bridge.md)，不能把已合并代码等同于所有设备、Provider 或远程工具都已验收。

## 技术栈

- **React Native 0.86** - 跨平台移动端框架
- **TypeScript** - 类型安全开发
- **Kotlin / Swift** - Android / iOS 原生开发
- **Safe Area Context** - 安全区域适配

## 环境要求

- Node.js 26.x (>= 26.13.1, LTS)
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
├── api/        # Host / Cloud 网络客户端
├── chat/       # 会话编排与状态
├── provider/   # Local Provider 线协议与流式响应
├── runtime/    # Pi Core Agent、运行控制与会话 Runtime
├── tools/      # 本地工具、Remote / Cloud Tool Gateway
├── settings/   # 设置与 Agent 执行预算
├── screens/    # 移动端页面
└── types/      # 共享类型
```

## Mira Cloud 设备恢复

Cloud Auth 是设备撤销的权威来源。普通退出、Session 过期、网络故障及无效
OAuth Grant 不会替换本机 Cloud Installation ID。仅在原生 Mobile OAuth
兑换返回服务端确认的 \`OAUTH_DEVICE_REVOKED\` 后，账户页显示「重新注册此设备」。
确认操作会替换 Cloud 安全存储中的安装身份，以全新浏览器授权注册；旧设备和
Session 仍然撤销。中途取消或重试使用已持久化的新身份，不重新生成设备。
本地聊天、Local Provider、独立 Remote Host/Tailscale 及 Push 身份均不改变。
服务端错误契约见 [Cloud Auth OAuth](https://github.com/uichat-mira/cloud-auth/blob/dev/docs/oauth-authorization-v0.md)。

## Desktop 远程线程工作空间

使用 Local Provider 会话调用官方 Mira Cloud MCP 的 Mira Desktop 工具时，Mobile
把本机会话 ID 作为 `X-Mira-Thread-Id` 只发送给官方 Cloud MCP `tools/call` 及其对应
Remote V1 审批/取消请求。实际的 Desktop 工作空间由 Desktop 按 C2
[Remote Thread Workspace V1](https://github.com/uichat-mira/mira-desktop/blob/b3015ff86366832b543db72181987e3b9270d158/docs/remote-access/remote-thread-workspace-v1.md)
权威创建；手机端不会根据线程 ID 虚构目录，也不会要求用户先选择目录。

线程菜单里的「查看远程工作空间」读取真实 `GET /remote/v1/threads/:threadId/workspace`
结果，只有存在 `active` 空间时才展示 Desktop 返回的 opaque 引用。普通聊天、狐邮
和不需要 Desktop 工作空间的任务不会创建空间。线程绑定本机会话、Cloud 账号、
Desktop Host/设备和连接代际，换线程、账号或 Host 不会串用。

「结束远程线程」或删除该本机会话时，Mobile 调用
`POST /remote/v1/threads/:threadId/end`（`tools:control`）。只有 Desktop 明确确认
`ended` 后才算结束；断线、清理未完成或响应不确定时保留本机会话并如实提示可重试，
不会把单轮回答完成、退到后台或关闭 App 当作线程结束。结束时只停止该线程仍在运行
的调用和终端会话，已有成果文件保留。真实 Desktop + Mobile 的持久任务终止与成果
检查仍以 #258 T4 为准。

## 狐邮 Who You · 移动端只读接入

在 Mira Cloud 登录后，Mobile 可以独立通过狐邮 MCP 查看当前账号的已绑定邮箱，
并由用户主动搜索、阅读**已同步**邮件的纯文本正文，不依赖 Desktop 或 Relay。
同步不完整时，搜索不到不代表 Gmail 中没有这封邮件；同步、重授权、解绑继续由狐邮网页管理。

Local Provider 的 Agent 工具注册不止狐邮两项：内置 `web` 与
`whoyou_mail_search`、`whoyou_mail_message_get`；在具备相应云账号身份与权限时，
还可通过 `mira_desktop_hosts` 按需发现授权的 Desktop 工具。工具**被注册**不代表
当前账号已获权、Host 已就绪或 Provider 本轮已经看见对应 Schema。
`web(url)` 只读取公开 HTTP(S) 网页：模型可自行构造普通搜索引擎 URL、读取结果并沿链接继续，
没有 query/search 模式、专用搜索供应商或天气接口。它在本机执行并遵守公开地址边界，
单次下载上限 1 MiB、结果上限 16 KiB、超时 30 秒，不登录、不提交表单、不执行页面脚本，
不加载图片/视频/字体。页面内容是不可信第三方数据，不能作为指令。
**每次**将狐邮搜索结果或正文发送给用户配置的外部模型前，都展示接收方、用途和范围并请求确认。
邮件属于不可信输入，不能用于后续工具执行或权限提升；发信、附件及后台同步不在本能力范围。
含邮件信息的回答可在手机**本地会话历史**查看，但会携带私密标记，
不自动加入未来的模型请求上下文或自动记忆整理。

行为与验收合同以 [MOB-086](https://github.com/uichat-mira/mira-mobile/issues/337) 为准。
此段描述代码能力，不代表 Android 真机完整链路已经验收。

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

- 采用 ad-hoc 签名（包含 Keychain entitlement）的 iOS Simulator Debug 压缩包，可供模拟器联调；不涉及 Apple 开发者证书。
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
