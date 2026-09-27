# MOB-028A：R2 分支发行真相与 Manifest

状态：**PASS**

执行仓库：`dangjingtao/uichat-mira-mobile`

目标分支：`dev`

## 背景

MOB-028 当前已经实现关于页更新检查，但运行时更新源仍依赖 GitHub Releases，并且现有 build-time channel truth 只区分 `dev` / `prod`；非 `prod` 构建可能被归入 `dev`。这与当前产品决策不一致。

最新决策：Mira Mobile 的更新链路必须以 Cloudflare R2 为客户端发行真相；不同分支 / 发行通道完全隔离，每个分支版本只与自己分支的最新版本比较。

## 产品 / 发布合同

版本身份由“基础语义版本 + 构建分支 / 发行通道”共同决定。

示例：

```text
基础版本：0.1.3
predev -> 0.1.3-predev
dev    -> 0.1.3-dev
test   -> 0.1.3-test
prod   -> 0.1.3
```

`prod` 保持标准稳定语义版本，不强制追加 `-prod`；非 prod 构建在展示与发行 metadata 中必须能明确识别其通道。

不得通过版本字符串反推 channel。channel 必须由 CI / build-time truth 明确注入。

## R2 目录合同

四条发行线独立。客户端指针与版本化产物分开：

```text
mira/mobile/<channel>/latest/latest.json
mira/mobile/<channel>/releases/<version>/uichat-mira-mobile-release.apk
mira/mobile/<channel>/releases/<version>/uichat-mira-mobile-release.apk.sha256
```

当前人工 / 测试固定下载地址继续保留：

```text
mira/mobile/<channel>/latest/uichat-mira-mobile-release.apk
mira/mobile/<channel>/latest/uichat-mira-mobile-release.apk.sha256
```

但客户端 manifest **不得指向上述可变 latest APK mirror**。原因是发布过程中即使 `latest.json` 最后写，可变 APK 也可能先被覆盖，形成“旧 manifest + 新 APK”的短暂版本错配。

因此 `latest.json` 是唯一移动的客户端指针，APK 使用同 channel 的版本化对象。

## latest.json 最小合同

至少包含：

```json
{
  "version": "0.1.3",
  "channel": "dev",
  "displayVersion": "0.1.3-dev",
  "apk": "releases/0.1.3/uichat-mira-mobile-release.apk",
  "sha256": "<sha256>"
}
```

`apk` 相对于 `mira/mobile/<channel>/` channel root 解析，只允许落在当前 channel 的 `releases/<version>/` 下。

可选字段可以包括 `notes`、`commit`、`publishedAt`，但不得让客户端依赖 GitHub Release 才能完成版本判断或下载。

## 发布原子性

`latest.json` 是该 channel 的最终客户端发行指针，必须最后更新。

发布顺序：

1. 构建并签名 APK；
2. 校验 APK 与 SHA-256；
3. 上传 APK / checksum 到 `mira/mobile/<channel>/releases/<version>/`；
4. 对版本化远端对象做存在性 / 大小校验；
5. 可同步固定 `latest/` APK mirror 给人工 / 测试使用；
6. **最后上传 / 覆盖 `latest/latest.json`**。

若版本化 APK 上传或校验失败，不得更新 `latest.json`。

## Scope

- 修正 CI / build-time channel truth，至少明确支持 `predev`、`dev`、`test`、`prod`。
- 不允许“非 prod = dev”的兜底语义继续存在于可发布构建。
- 为各发行分支生成正确的 display version。
- 为各 R2 channel 生成并发布 `latest.json`。
- 为客户端更新保留同 channel 的版本化 signed APK / checksum。
- 复用现有 R2 Secrets 与 `assets.tomz.io` 发布基础设施，不新建 Worker、数据库或第三方更新服务。
- GitHub Release / Tag 可继续保留作为归档、追溯和人工查看能力，但不再是 MOB-028 客户端运行时更新真相。

## Hard Constraints

- 分支 / channel 绝不串线。
- `dev` metadata 不得写入 `test` / `prod` 目录，反之亦然。
- 不用 R2 文件存在与否猜版本号；版本来自本次构建的明确版本真相。
- `latest.json` 不得先于对应版本化 APK 成功发布。
- manifest 不得指向可变的跨版本 latest APK mirror。
- 不泄露或提交 R2 / signing Secrets。
- 不改变既有签名与 Android 安装权限合同。

## Validation

至少覆盖：

1. `predev/dev/test/prod` channel resolution 正确；
2. display version 生成正确；
3. prod 保持稳定版本语义；
4. R2 prefix 由 channel 唯一确定；
5. manifest 内容与当前构建版本 / channel 一致；
6. manifest 的 APK 路径只能指向当前 channel 的版本化对象；
7. APK / checksum 失败时不会发布 `latest.json`；
8. `latest.json` 发布动作位于对应版本化产物远端校验之后。

执行现有质量检查：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

并对新增 / 修改的 GitHub Actions 做语法、权限、artifact 与分支路径检查。

## Accepted Implementation

PR #82 已合入 `dev`，merge commit `34b7eeeda68c4c47f4ad56953437ea61b4c3d899`。

实现采用独立 `R2 Release Truth` workflow。它等待对应分支 canonical CI 成功后再移动 R2 客户端真相：

- `predev` 等待 `Predev CI`，复用其 signed Release artifact；
- `dev` / `prod` 等待 `Mobile CI`，复用 signed Release artifact；
- `test` 等待 `Mobile CI` 全绿后补 signed Release APK，再发布 test channel；
- feature / fix / main 不发布 R2 客户端 release truth。

验收证据：

- PR #82 最新 AI Review 无 P0-P2 阻断；
- Typecheck / lint / Jest 通过；
- Android signed Release、Android debug、iOS simulator / unsigned device CI 通过；
- dev manifest 成功生成 `0.2.11-dev`；
- signed APK SHA-256 校验通过；
- R2 workflow 在远端对象校验完成后明确输出 `Published R2 release truth: dev/0.2.11`；
- `latest.json` 在版本化 APK / checksum 发布并验证后才移动。

后续 `dev` 新提交触发 concurrency 导致该已完成发布 job 的 workflow 总状态显示 cancelled，不影响上述已经完成并记录的 R2 发布事实。

## Handoff

MOB-028B 必须消费本卡确定的 R2 manifest 合同，不得自行发明第二套 channel / version 规则。
