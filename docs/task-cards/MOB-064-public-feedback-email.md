# MOB-064：统一 Mobile 公共反馈邮箱

状态：**实施中**

执行仓库：`uichat-mira/mira-mobile`

施工分支：`feat/public-feedback-email`

## 背景

Mobile 目前存在两个独立的 mailto 收件地址来源：设置页「电子邮件」与「报告错误」。地址已经发生漂移，并且设置页仍暴露个人邮箱。

本卡按维护者 2026-10-04 指令收口为一个公共反馈入口：

`hello@tomz.io`

## 范围

1. 删除仓库当前内容中的旧个人邮箱字面量。
2. 设置 → 电子邮件发送至 `hello@tomz.io`。
3. 设置 → 报告错误发送至 `hello@tomz.io`。
4. 两个入口共用同一地址常量，避免再次漂移。
5. 更新仍描述旧地址的任务卡、台账与静态预览。

## 非范围

- 不修改 mailto 交互语义、主题、正文或诊断字段。
- 不新增邮件服务器或 Host feedback API。
- 不以客户端测试证明 `hello@tomz.io` 的服务器端投递能力；邮件路由可达性由邮箱侧单独验证。

## 自动化验收

- `reportDiagnostics.test.ts` 必须直接断言报告错误收件人是 `hello@tomz.io`。
- Feature PR 的 typecheck / lint / Jest 等仓库 merge gate 必须通过。
- 合并前检查变更范围，不得遗留旧个人邮箱字面量。

## 真人验收（最小集）

只要求 **Android 真机** 做两次点击核对，不要求为本次纯地址切换补 iOS 真机：

1. 设置 → 电子邮件：唤起邮件客户端后收件人为 `hello@tomz.io`。
2. 设置 → 报告错误：输入任意非空描述并发送，唤起邮件客户端后收件人为 `hello@tomz.io`。

本卡不重复 MOB-052 / MOB-055 已覆盖的外观、断网、草稿、诊断字段等整套验收。
