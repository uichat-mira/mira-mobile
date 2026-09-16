# MOB-038：Local Provider 多配置与选定 Provider 新建对话

状态：**REVIEW**（2026-09-06 代码与自动化验证完成，待功能验收）

范围：Mira Mobile

依赖：MOB-037 的 Local Provider Runtime 与双入口基础

## 目标

用户可以在手机端保存多个 OpenAI-compatible Provider 配置，切换当前配置，并明确使用选中的 Provider 创建本地对话。Provider API Key 与普通配置、Remote Host 凭据继续隔离。

## 功能范围

- Settings 提供 `Local Provider` 入口。
- 配置页显示已有 Provider，并支持新增与切换。
- 每个 Provider 独立保存名称、Base URL、模型和 API Key。
- 保存一个 Provider 不覆盖其他 Provider。
- API Key 保存后只显示掩码，不写入普通配置 JSON。
- 从配置页新建本地对话时，绑定当前选中的 Provider。
- 聊天页显示 `Provider 名称 · 模型`，与 Remote Host 对话明确区分。
- Provider 仍有本地对话时禁止删除，避免会话失去归属配置。

## 非目标

- Provider 在线探测或模型列表自动发现。
- QR / deep link 导入 Provider 配置。
- Provider 配置同步到 Mira Host。
- Tool Gateway、MCP 工具、Agent Loop UI 或长期任务运行。
- 删除 Provider 时级联删除本地会话。

## 验收步骤

1. 打开 Settings -> Local Provider。
2. 填写第一个 Provider 的名称、HTTPS 地址、模型和 API Key，保存成功。
3. 点击新增按钮，填写并保存第二个 Provider。
4. 在两个 Provider 标签之间切换，确认名称、地址、模型和 Key 掩码分别保留。
5. 修改其中一个 Provider 并保存，确认另一个 Provider 未被覆盖或重排。
6. 选中第二个 Provider，点击“新建本地对话”。
7. 确认进入聊天页，头部显示第二个 Provider 的名称和模型。
8. 返回本地 Provider 会话列表，确认会话来源为本地 Provider。
9. 尝试删除仍有本地会话的 Provider，确认应用阻止删除并说明原因。
10. 打开 Remote Host 会话，确认远程聊天、流式消息和 Agent 审批不受影响。

## 自动化证据

- `src/provider/providerConfigStore.test.ts`：多配置 upsert、删除隔离。
- `src/runtime/localProviderRuntime.test.ts`：按选中 Provider 创建会话并保留 Provider/模型元数据。
- `src/screens/localProviderConfig.contract.test.js`：多配置、独立凭据、选定 Provider 创建和删除保护合同。
- 全量 Jest：64 个测试套件、351 个测试通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 error；保留仓库既有 warning。
- Android `arm64-v8a` debug 构建：通过（`./gradlew.bat :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`）。

## 待验收

- Android / iOS 安全存储真实读写与 Key 掩码。
- 真机切换多个 Provider 后的新建对话归属。
- 真 Provider 的 OpenAI-compatible 流式对话。

## 构建备注

全架构 Android debug 构建在 `armeabi-v7a` 的 `react-native-permissions` C++ 生成代码阶段触发 NDK clang 崩溃；同一工作区的 `arm64-v8a` 构建成功。该失败属于本机 NDK / 依赖构建环境，不是 MOB-038 TypeScript 或 Kotlin 编译错误。
