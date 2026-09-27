# MOB-028：关于页版本更新检查与确认下载

状态：**有条件完成**（代码已入 `dev`，release metadata / 下载 smoke 待验收）

负责人：`mob_028_app_update_check_download`

执行仓库：`dangjingtao/uichat-mira-mobile`

首次派卡基线：`dev @ a90dfb6c2d80079fd85084fff0214968e137e653`

## 背景

当前 `AboutScreen` 只从 `package.json` 显示版本号，没有更新检查。仓库已经有明确发布合同：`package.json.version` 是语义版本唯一来源；dev 使用 `v<version>-dev` prerelease，prod 使用 `v<version>` 正式 release，并发布 Android signed Release APK。

Dogfood 要求：应用拿到当前发行通道的最新版本，与当前安装版本比较；发现更新时显示红点；用户点击并确认后才触发下载。

## 产品目标

1. 关于页展示**真实当前安装版本**，并能检查当前发行通道的最新版本。
2. 有更高版本时，在版本 / 更新入口显示清晰但克制的红点。
3. 用户点击后先看到当前版本与最新版本并确认；只有确认后才触发下载。
4. 无更新时不显示红点；网络失败不得伪装成“已是最新”。
5. 不把 Android 下载做成静默安装；iOS 不伪装成可直接安装 unsigned IPA。

## Verified Release Contract

- `package.json.version` 是语义版本唯一来源。
- dev release tag：`v<version>-dev`。
- prod release tag：`v<version>`。
- Android 可下载产物：`uichat-mira-mobile-release.apk`。
- 当前发布文档明确：iOS unsigned device IPA 不能直接安装。

因此更新检查必须**发行通道隔离**：prod build 不得因为版本号更高而跳到 dev prerelease；dev build 也不能把旧 prod `latest` 当成自身最新版本。

## Scope

### 当前版本

- 页面显示值必须来自应用实际构建 / 安装所使用的语义版本事实，不能写死。
- 如果当前代码仍直接读取 `package.json.version`，Builder 需要确认 Android `versionName` / iOS marketing version 与其一致；若存在不一致，应以仓库发布合同修复最小真相链，而不是在 UI 层拼第二个版本号。

### 发行通道

- 施工时先检查当前构建流程是否已有可读取的 release channel 信号。
- 若没有，补一个**最小、可测试、由构建 / CI 明确赋值**的 channel truth，至少区分 `dev` 与 `prod`。
- 本地开发构建可有明确默认值，但生产构建不得默认落到 dev channel。
- 不允许通过“版本号看起来像 dev”猜通道，因为当前 `package.json.version` 本身不带 `-dev`。

### 最新版本来源

优先复用仓库当前已经发布的公开 release truth。实现可以读取 GitHub Releases API 或等价的现有公开 metadata，但必须满足：

- dev 只接受符合 `v<semver>-dev` 的 prerelease；
- prod 只接受符合 `v<semver>` 的正式 release；
- 忽略 draft / 其它 tag；
- 使用真正的 semantic version compare，不用字符串字典序比较；
- 选择当前通道最高可用版本，而不是盲信一个可能属于另一通道的 `latest`。

若 Builder 认为需要给 R2 增加 `latest.json` 等 metadata，先把它作为实现建议报告；除非当前发布流水线已经有同等机制，否则不要在本卡无声扩张发布合同。

### About UI

- 当前应用版本行改成可表达更新状态的入口。
- 默认仍能看到当前版本号。
- 有更新：显示红点，并可展示 `有新版本 x.y.z` 等简洁状态。
- 无更新：不显示红点，可保持当前版本信息。
- 检查失败：显示可重试的真实状态；不能显示“已是最新”。
- 不要求在 Settings 首页再新增第二个红点入口，避免本卡自行扩 Scope。

### 确认与下载

用户点击有更新的版本入口：

1. 展示当前版本、最新版本；若 release 有简短说明可展示，但不依赖完整 changelog 才能工作；
2. 用户取消：不下载；
3. 用户确认：才触发下载。

Android MVP：

- 使用该 release 的**signed** `uichat-mira-mobile-release.apk` canonical download URL；
- 确认后交给系统 / 浏览器下载能力即可；
- 本卡**不申请 `REQUEST_INSTALL_PACKAGES`，不实现静默安装，不绕过 Android 安装确认**。

 iOS：

- 可以提示有新版本并打开 canonical release / 分发说明；
- 不允许把仓库当前 unsigned device IPA 描述成可一键安装。

## Hard Constraints

- 不把 dev prerelease 推给 prod 用户。
- 不写死“最新版本号”。
- 不用 R2 文件是否存在来推断版本号。
- 不下载 debug APK。
- 不实现静默安装 / 后台强制升级。
- 不引入第三方更新 SDK，除非 Builder 先证明当前原生能力无法满足并报告理由。
- 不修改既有 Tag / release 历史。

## Must Read

- `AGENTS.md`
- `docs/work-ledger.md`
- `docs/github-build-release.md`
- `.github/workflows/mobile-ci.yml`
- `.github/workflows/predev-ci.yml`
- `package.json`
- `src/screens/AboutScreen.tsx`
- `android/app/build.gradle`
- `ios/UIChatMira/Info.plist`

## Execution Entry Points

- `src/screens/AboutScreen.tsx`
- 可新增 `src/update/` 下的小型 update service / semver helper
- 构建通道需要时：现有 Android / iOS build config 与 CI workflow 的最小接线

如果实现开始触碰 native installer、FileProvider 或新的安装权限，说明已经超出本卡合同，应停止并报告。

## Validation

自动化至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

必须为纯逻辑部分增加单元测试，至少覆盖：

1. `0.2.9` vs `0.2.10`；
2. 当前版本 = 最新版本；
3. 当前版本高于远端版本；
4. dev / prod 通道过滤正确；
5. draft / 非法 tag 被忽略；
6. 网络失败不返回“最新”；
7. release 缺 signed Release APK 时不触发错误资产下载。

Android smoke：

- 无更新无红点；
- 模拟 / 真实存在更高 dev 版本时出现红点；
- 点击后先确认；
- 取消不下载；
- 确认后打开 signed Release APK 下载；
- 网络失败可重试。

iOS 若无可安装签名产物，只验证更新提示与真实分发说明，不伪造安装成功。

## Parallel / Integration

在保持“确认后交系统下载、不做 native installer”的范围内，可与 MOB-025、MOB-026、MOB-027、MOB-029 从同一 `dev` base 并行。

若实现必须修改共享 native package 注册、全局 navigation 或发布产物结构，先停止并重新评估与 MOB-029 / 其它施工卡的语义竞态。

## Open / Unknown

当前基线未发现 JS 可直接读取的 dev / prod runtime channel truth。Builder 需要先核对现有 build config；如确实不存在，按本卡约束补最小 build-time channel signal。具体载体属于实现选择，但“prod 不得收到 dev prerelease”是硬约束。

## Handoff

施工前读取发布合同与当前 workflow，不得只看 About UI 就接一个“latest URL”。仓库 release 事实若已变化，以当前正式发布合同为准；若变化改变发行通道语义，先报告冲突再施工。
