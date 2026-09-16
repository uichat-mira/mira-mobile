# MOB-037：Mobile 双入口与 Local Provider Agent Runtime

状态：**DOING**（2026-09-05 开始；2026-09-06 完成阶段 A 与阶段 1 最小 UI 接线）

分支：`feature/mobile-dual-entry-local-provider`

范围：Mira Mobile；涉及 Mira Host / Tool Gateway 协议确认

设计附件：[Mobile Dual-Entry and Local Provider Agent Runtime Design](../remote-access/local-provider-agent-runtime-design.md)

## 目标

在保持现有任务列表、会话、聊天、抽屉、搜索、设置和新建交互基本稳定的前提下，为 Mira Mobile 增加两个明确的对话来源：

1. **Remote Host**：继续使用已配对的 Mira Host、Host 会话状态和远程 Agent 能力。
2. **Local Provider**：手机直接连接用户配置的 OpenAI-compatible Provider，保存本地会话，并支持受限的前台 Agent Loop。

Local Provider 不表示在手机内运行大模型，也不表示把完整 Pi/PiLoop、Shell、Git 或本地 MCP 进程安装进 React Native 应用。

## V1 范围

- 支持 OpenAI-compatible Chat Completions 的共同子集。
- 支持普通文本流式输出。
- 支持标准 `tool_calls` 的解析和有限循环。
- 外部工具只通过已批准的远程 MCP / Tool Gateway 执行。
- 手机前台 Agent Loop 默认最多 8 轮，单次请求和整体运行均有超时与取消。
- 本地 Provider 会话使用独立的本地存储。
- Remote Host 凭据、Provider API Key、Tool Gateway 凭据分开存储和清除。
- 应用进入后台或被系统挂起时，不宣称本地 Agent 继续运行；需要明确显示暂停、失败或转交持久运行时的结果。

## 非目标

- 在 Android / iOS 内运行大语言模型。
- 将完整 Pi/PiLoop 桌面运行环境打包进移动端。
- 本地 Shell、脚本、Git、worktree、任意文件执行或任意 MCP 子进程。
- 长时间后台 Agent、跨应用重启自动续跑或多 Agent 并行编排。
- 多模态、音频模型、批处理和 Provider 私有事件协议。
- 在移动端复制 Mira Host 的 Provider 管理、模型密钥管理或业务权限判定。

## 交互要求

- 主列表顶部提供 `全部任务`、`远程 Host`、`本地 Provider` 三种来源筛选。
- 混合列表中的每条记录必须显示来源标识，避免本地和远程会话混淆。
- 在 `全部任务` 下新建时，先让用户选择远程或本地来源。
- 聊天页显示当前来源及 Host / Provider 模型信息。
- Provider 不可用、Host 断开、Tool Gateway 不可用、Agent 暂停、等待审批、取消和超时都必须有可操作的错误或状态呈现。
- 不以颜色作为唯一状态表达，不破坏现有列表行、滑动操作、置顶和搜索行为。

## 技术边界

页面不得直接调用 HTTP、SSE、Provider SDK 或 MCP。新增运行时抽象，至少覆盖：

```ts
type RuntimeKind = 'remote-host' | 'local-provider';

interface ConversationRuntime {
  readonly kind: RuntimeKind;
  listSessions(): Promise<Session[]>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  sendMessage(
    sessionId: string,
    input: string,
    options?: { agentEnabled?: boolean },
  ): Promise<AsyncIterable<RuntimeEvent>>;
  cancelActiveRun(): void;
}
```

建议的实现边界：

- `RemoteHostRuntime`：包装现有 `miraHostClient` 和 Remote Host V1 合同。
- `LocalProviderRuntime`：包装 OpenAI-compatible Provider、本地会话存储和受限 Agent Loop。
- `ToolGatewayClient`：只在协议确认后实现远程工具调用，不在页面中猜测 endpoint、scope 或错误码。

## 前置确认

开始实现前，维护者需要确认：

1. Tool Gateway 是 Mira Host endpoint、独立服务，还是两者兼容。
2. Local Provider 访问 Tool Gateway 的认证方式和设备授权范围。
3. Tool 发现、命名、JSON Schema、审批、超时、取消、结果大小和错误合同。
4. 本地会话是否仅设备保存，是否允许导出或同步到 Mira Host。
5. Provider 配置录入方式，以及是否允许 QR / deep link 导入。
6. App 挂起后的本地运行如何恢复，或是否必须转交 Host / Pi Runtime。

在这些问题确认前，只能建立 Adapter 接口、测试替身和本地 UI 骨架，不得虚构 Mira Host 或 Tool Gateway 协议。

## 实施拆分

### 阶段 A：运行时与本地文本会话

- 建立运行时中立的事件和 Repository 接口。
- 增加 Provider 配置和安全 API Key 存储。
- 实现 Chat Completions 文本流式输出。
- 实现本地会话持久化和来源筛选 UI。
- 验证本地会话不会调用 Remote Host API。

### 阶段 B：有限工具循环

- 解析标准 `tool_calls`。
- 接入已确认的远程 Tool Gateway。
- 增加工具白名单、Schema 校验、结果大小限制、超时和取消。
- 增加前台挂起、恢复和失败语义。

### 阶段 C：持久运行时接入

- 通过稳定 RPC / HTTP / WebSocket Adapter 接入 Mira Host 或 Pi Runtime。
- 同步审批、暂停、恢复和远程 Agent 状态。
- 复用同一套运行时事件和聊天 UI。

## 验收标准

- 用户可在主列表内切换三种来源，不需要进入新的导航体系。
- Remote Host 和 Local Provider 的会话、凭据和错误状态彼此隔离。
- 本地普通对话可流式显示并支持取消。
- 标准工具调用只能到达批准的远程 Tool Gateway，失败时给出明确操作。
- 本地 Agent 达到轮数、超时、取消或后台挂起边界时，状态可解释且不会伪称已继续运行。
- 移动端不能执行任意 Shell、脚本、文件或 MCP 子进程。
- 现有配对、远程会话、流式消息和 Agent 审批回归测试保持通过。
- Android / iOS 真机完成安全存储、前台取消、挂起恢复和网络切换验证后，才可从 `REVIEW` 升为 `PASS`。

## 依赖与风险

- 依赖 Mira Host / Tool Gateway 对协议、认证和工具权限的确认。
- iOS / Android 后台生命周期不可作为本地长任务保证。
- Provider 兼容性差异必须隔离在 Adapter 内，不能扩散到页面和通用状态。
- 本卡不修改 Mira Host、Provider 服务或 Tool Gateway 仓库的业务实现。

## 阶段 A 实施记录（2026-09-05）

已完成最小可验证基础：

- 新增运行时中立接口：`src/runtime/conversationRuntime.ts`。
- 新增 OpenAI-compatible Chat Completions 流式适配器：`src/provider/openAiCompatibleClient.ts`。
- 适配器仅输出统一的文本增量、工具调用和结束事件；Provider 私有字段不向页面泄漏。
- 新增非敏感 Provider 配置存储：`src/provider/providerConfigStore.ts`。
- 新增独立 Provider API Key 安全存储接口及原生/内存实现：`src/security/providerCredentialStore.ts`。
- 新增本地会话仓储和 `LocalProviderRuntime`：`src/local/localSessionRepository.ts`、`src/runtime/localProviderRuntime.ts`；会话记录保留 Provider 归属，避免多 Provider 配置时串用模型。
- 新增 8 个阶段 A 单元测试，覆盖配置往返、坏配置拒绝、凭据隔离、空 Key/非法 id 拒绝、SSE 文本/tool call 事件解析、本地会话归属和消息追加。

验证结果：

- `npm run typecheck`：通过。
- 阶段 A 聚焦测试：4 个测试套件、8 个测试通过。
- `npm run lint`：无 error；保留仓库现有 warning。
- 全量 `npm test -- --runInBand`：4 个既有 Shiyan 合同测试失败，失败文件为当前工作区已有改动涉及的 `ShiyanTaskDetailScreen.tsx`、`ShiyanCaptureSubmitScreen.tsx` 及其合同测试；未发现失败来自本卡新增模块。

当前未完成：Tool Gateway 协议接入、移动 Agent Loop 和 Android / iOS 真机验证。

## 2026-09-06 阶段 1 实现记录

- 新增 `RuntimeRegistry` 与 `RemoteHostRuntime`，页面不再直接决定远程或本地传输。
- 会话增加来源元数据；主列表支持“全部任务 / 远程 Host / 本地 Provider”三态筛选，混合列表按更新时间排序。
- 新增 Local Provider 配置页：Provider 地址、模型和 API Key 分离保存；API Key 继续使用独立安全存储。
- 新建本地会话和打开本地会话均复用现有 Chat 路由；本地会话不会进入远程 Agent 审批覆盖层。
- 本地对话复用 OpenAI-compatible SSE 适配器，支持流式文本和取消；远程 Host 保留稳定 `messageId` 重试语义。
- 新增运行时注册表测试；全量 Jest、TypeScript 检查通过。

## 2026-09-06 阶段 B 基础实现记录

- 新增协议无关的 `ToolGatewayClient`、工具白名单校验和工具结果大小限制；未假设 Gateway endpoint、鉴权或 MCP 传输。
- 新增 `MobileAgentLoop`：默认最多 8 轮工具调用，支持总体超时、取消、工具失败和应用挂起边界。
- `LocalProviderRuntime` 仅在调用方显式启用 `agentEnabled` 且注入已确认的 Gateway 时进入工具循环；普通本地对话保持纯文本路径。
- App 进入后台时标记本地执行窗口已暂停并取消当前 Provider 请求，不对后台继续运行作虚假承诺。
- 新增工具策略和 Agent Loop 测试，覆盖白名单、JSON 参数、结果截断、轮数限制和挂起语义。

## 后续任务卡

- `MOB-041`：Tool Gateway / MCP 协议与凭据合同确认。
- `MOB-042`：本地 Agent Loop UI 与运行状态呈现。
- `MOB-043`：Host / Pi 持久运行时适配。
- `MOB-044`：双入口真机验收与发布加固。

MOB-041 是真实工具接入的前置合同；在其完成前，MOB-042 与 MOB-043 只能使用协议无关接口和测试替身。MOB-044 汇总真实设备和服务验收，不能用自动化测试替代。
