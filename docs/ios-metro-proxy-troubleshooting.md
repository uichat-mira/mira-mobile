# iOS 模拟器 `No script URL provided` 排障记录

## 现象

iOS 模拟器可以安装并启动原生 App，但启动后显示：

```text
No script URL provided. Make sure the packager is running or you have embedded a JS bundle in your application bundle.
unsanitizedScriptURLString = (null)
```

## 已确认的排查结果

- `npm run typecheck` 通过。
- Jest：54 个测试套件、328 个测试全部通过。
- Metro `/status` 返回 `packager-status:running`。
- Metro bundle 请求可返回 HTTP 200，bundle 约 17 MB。
- `index.js`、`app.json` 与 iOS `AppDelegate.swift` 使用的模块名一致。

## 根因

本机启用了 HTTP 代理：

```text
HTTP proxy: 127.0.0.1:1080
```

React Native iOS Debug 启动时会通过 `NSURLSession` 请求：

```text
http://localhost:8081/status
```

该请求被系统代理接管并断开，`RCTBundleURLProvider` 因此认为 Metro 不可用，返回 `nil`，最终触发红屏。

## 处理方式

### 推荐：绕过本地开发地址的代理

在代理工具中将以下地址加入直连/绕过列表：

```text
localhost
127.0.0.1
192.168.1.228
```

其中 `192.168.1.228` 是本次验证机器的局域网地址，换网络后应重新确认：

```sh
ipconfig getifaddr en0
ipconfig getifaddr en1
```

### 临时验证：给模拟器指定 Metro 地址

先启动 Metro：

```sh
npm start -- --reset-cache
```

然后把 `RCTBundleURLProvider` 的开发地址指向本机局域网 IP。模拟器验证命令示例：

```sh
xcrun simctl spawn booted defaults write io.tomz.mira.mobile RCT_jsLocation '192.168.1.228:8081'
xcrun simctl terminate booted io.tomz.mira.mobile
xcrun simctl launch booted io.tomz.mira.mobile
```

## 复核命令

```sh
curl -sS http://127.0.0.1:8081/status
curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' \
  'http://127.0.0.1:8081/index.bundle?platform=ios&dev=true&minify=false&runModule=true'
```

预期结果分别为 `packager-status:running` 和 HTTP `200`。

## 注意事项

- 这是开发环境连接问题，不代表 Release 内嵌 bundle 缺失。
- 不要把局域网 IP、代理端口或凭据写入生产配置。
- 若 Metro 返回 HTTP 500，应优先查看响应体中的具体模块解析错误；本次曾发现旧 Metro 依赖图未刷新，但重启后暴露出的持续问题是系统代理。

记录日期：2026-09-03
