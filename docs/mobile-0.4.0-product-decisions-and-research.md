# Mira Mobile 0.4.0 · 产品决策与能力架构研究唯一真相

> 状态：**产品决策基线（已确认项）+ 研究证据（非实施授权）**  
> 适用：Mira Mobile Local Provider / Pi Core 的工具发现、跨服务能力消费，以及与 Desktop / Who-You / MCP 的边界  
> 决策更新至：2026-11-24（原始研究证据核查日期另行注明）  
> **重要：0.4.0 是本轮讨论的版本基线，不表示本页目标架构已随 0.4.0-dev 发布。** 具体版本和执行现状仍以对应分支、源码、构建及真机证据为准。

## 1. 真相源与文档边界

本页是 **Mobile 0.4.0 相关跨服务能力消费的产品决策、研究结论、待决问题** 的唯一汇总入口；后续相同主题只在这里维护结论，不在多份随手文档重复定义协议或复制任务状态。

- **已运行事实**：以各仓库当前代码、配置和真实运行证据为准；Mobile 现状详见 [Pi Core 工程真相](engineering/pi-core-mobile-bridge.md)，Desktop 现状详见 [Desktop Tool 当前真相](https://github.com/uichat-mira/mira-desktop/blob/dev/docs/TOOL_CURRENT_TRUTH.md)。
- **具体施工范围、验收与结论**：以 GitHub Issue / PR 为准。尤其 [MOB-090 #354](https://github.com/uichat-mira/mira-mobile/issues/354) 持有 D1–D5 的完整原始决策合同；[MOB-087 #342](https://github.com/uichat-mira/mira-mobile/issues/342)、[MOB-088 #343](https://github.com/uichat-mira/mira-mobile/issues/343) 持有既有 Host Gateway/选机合同。
- **本页的决策** 表示维护者已表明产品方向，**不代表代码已实现、批准新的跨仓协议、授权开卡/施工/合并/发布**。
- **本页的研究** 只说明已有证据能证明什么；外部协议提案、内部静态代码检查、工程推断、已验收功能必须分开。
- Mira Mobile 两条既有路径——Remote Host 与 Local Provider——继续独立；此处讨论的三层披露主要针对 **Local Provider 下的 Pi Core Agent 发现与消费工具**，不擅自改变 Remote Host 自有 Agent Run 的执行权威。

## 2. 已确认的 0.4.0 产品决策（2026-11-23 至 2026-11-24）

### D1–D5：连接、身份、交互与本机 WebFetch

这五项由 [MOB-090 #354](https://github.com/uichat-mira/mira-mobile/issues/354) 持有完整用户行为、边界、回归与验收合同；本页只做可检索摘要，**不另立重复的施工合同**。

1. **D1：扫码/粘贴/配对深链只面向 Tailscale Direct。** Cloud Relay 经 Mira Cloud 身份与 Host 授权进入，不依赖扫码；旧 Relay 自动回退和配对 URI 兼容尚待实施处理。
2. **D2：Tailscale Direct 与 Cloud Relay 的「活动 Desktop 远程连接」互斥**，另一入口可见但置灰，执行路由不得偷偷回退；**Cloud 账号登录与 Tailscale 直连不互斥**。左下角新建远程会话必须走正确来源。云身份已登录且正在使用 Tailscale 时，单入口究竟如何选取来源，#354 标记为需消歧的交互边界。
3. **D3：侧边栏右下角为云账号身份入口**；登录后有可信头像时才显示头像，否则合适的账号占位；未登录明确提示，不能用传输连接状态冒充账号身份。
4. **D4：设置页底部是唯一的情境化退出操作位。** Tailscale 活动连接时仅断开连接；Cloud Relay 活动连接时退出云账号；已登录但无活动连接时仍可退出云账号；同时保留云账号详情的独立退出能力。云退出使狐邮、云工具、云设备和 Cloud Relay 失效，但不抹除独立 Tailscale 配对、Local Provider 密钥或本地聊天历史。
5. **D5：计划用手机本地的单一 web_fetch(query 或 url) 替换专用天气工具。** 既能搜索关键词，也能读取已知公开 URL；不把 Desktop 的双工具划分直接复制到手机。该工具不依赖云登录/桌面在线；搜索 Provider、网络防护、抽取方式及设备验收仍待论证。**当前代码仍是 local_weather_current，不能写成已替换。**

### D6：Desktop 远程能力的准入来源

- Mobile 只消费 **Desktop 现有「侧边栏 → 能力注册」所体现的筛选/严选范围**；Desktop 未纳入该范围的能力，不得仅因注册了 Tool 就进入 Mobile。
- 维护者明确：**不要新造第二套人工严选制度或 Mobile 侧白名单**。应尽可能复用 Desktop 辛苦形成的既有能力筛选与组织逻辑。
- 但是现有页面 **不是后端真实注册全集**：前端由 Registry/External MCP 取得工具，再按照固定验收用例对应 Tool ID 和部分 Managed Browser Tool 生成展示子集；未注册的部分验收用例还会出现「不可用」占位。该页面展示结果既不能直接当作可调用全集，也不能等同于经过真实运行验证的质量认证。
- **需要工程收敛的准确含义**：把既有展示筛选的产品范围转为由 Desktop 权威代码提供、可复用的准入/能力投影，供页面与 Mobile 出口共同引用；排除占位项，并叠加真实注册、运行就绪、Agent Access、Host Grant / scopes 以及每次调用的审批检查。如何在不破坏既有 UI 的前提下抽取共享规则，尚未设计/实施。
- 当前 Desktop Remote Tool Gateway 依据其独立的 agent_intent / Harness Exposure 生成远程清单；**不能宣称它已与上述侧边栏范围完全一致**。

### D7：三层渐进式披露

维护者最终纠正并明确为 **环境（服务）→ 能力（Capability）→ 工具（Tool）**，不是两层「能力」，也不是必须执行三次模型调用。

- **环境/服务**：例如手机本机、某个已授权 Desktop Host、狐邮云服务、后续第三方 MCP Server。说明环境身份、适用任务和能提供的能力概览；具体如何自动提示/按需发现仍待设计。
- **能力**：由服务提供语义画像，说明用途、任务场景、所属工具族、可用性及必要约束；并不向模型一次性灌入所有工具 Schema。
- **工具**：按任务进一步披露具体 Tool 的参数 Schema，完成真实调用；披露本身不等于授权或调用。
- **三级是声明的数据结构，不是 Agent 的三轮状态机。** 可以直接使用已知有效工具，也可以按任务从服务摘要、能力分组或具体工具切入，跳层、返回、补充发现、跨服务衔接均合法；不强制 service→capability→tool 的调用顺序、每层一次模型请求或固定循环次数。
- **渐进式披露只控制信息可见性与上下文成本，不是执行阻断器。** 同一服务、同一能力内的工具可连续工作；完成任务需要时也允许跨能力、跨服务工作流，在实际调用时仍分别检查执行权威、授权和审批。
- 已知或已披露的 Schema 在连接身份、授权、服务版本和就绪状态仍有效时可复用；**不重复发现、不规定模型回合数**。多 Host 不可消歧时遵守真实 Host 选择约束，不猜选、不跨 Host 重放。预算约束可配置，但不能把目录层级硬编码为预算上限。

### D8：Mobile 只建设机制，不耦合外部能力集合

- **Mobile 的长期职责**：发现服务、接受与校验能力声明、分级披露、为 Pi Core 提供适量模型上下文、工具调用路由、授权/审批交互、失败/结果回传和会话生命周期。
- **外部服务的职责**：描述自己是谁、提供哪些能力、各能力能完成什么任务、有哪些具体工具及调用说明；真实工具 Schema、执行/权限事实由所属服务或其权威 Adapter 提供。
- 不在 Mobile 源码持续维护 Desktop/狐邮/每个第三方 Server 的硬编码能力分组或工具列表；**新增符合约定的服务/能力，原则上不应要求 Mobile 修改业务代码或重新发包**。
- **MCP 已确定为第一方服务工具互操作的统一协议面**：Who-You 与拟新增的 Desktop MCP Server 通过标准 MCP Tools（`tools/list`、`tools/call`）提供真实工具，使用可选、版本化 MCP Resource 表达 Service→Capability→Tool 的语义关系。资源是非授权性的目录投影，Tool Schema、调用和权限仍属于真实服务。
- 狐邮已在 [OPS-046 #79](https://github.com/uichat-mira/who-you/issues/79) 的 [PR #80](https://github.com/uichat-mira/who-you/pull/80) 中将 `mira.service-capabilities/v1` 声明合入 `who-you/dev`（资源 URI `mira://service/who-you/capabilities`，覆盖 17 个语义能力、30 个工具）。**这是首批可验证实现，不代表线上部署或 Mobile 已消费**；其他自有服务复用契约时应明确自己的服务 ID、分组与认证边界，不复制狐邮的业务工具名单。
- 「不耦合业务能力」不意味着「无协议适配」：Mobile 仍需要标准 MCP 客户端、认证、网络/Relay 适配和运行时分层披露。普通 MCP Server 没有可选语义 Resource 时，根据真实 `tools/list` 元数据降级，不虚构 Capability Groups；不依赖实验性 MCP Groups，也不假设所有第三方支持该扩展。

### D9：外部数据可以驱动合法工具链；指令权限不可来自数据本身

- **已确认的产品原则**：网页、搜索结果、邮件、文档等第三方数据可以成为 Agent 后续工具调用的**事实输入**。不得一概以「网络来的数据不可信」为理由阻断正常浏览、搜索→打开、邮件读取→整理→保存等合法工作流。
- **仍需保持的安全区别**：外部数据不能仅凭正文里的命令提升为用户/系统指令，也不能自动扩张 Host Grant、账号授权、收件人或外传范围。实际副作用、敏感数据发往外部 Provider、跨服务传输等仍要符合相应授权/用户批准与执行策略。
- **当前实现存在明确冲突**：Mobile 的 src/tools/agentToolPolicies.ts 中 MailStage 在邮件搜索后只开放邮件正文、读正文后禁止继续 Tool，并在批调用中禁止邮件工具与其他操作组合；src/runtime/piAgentLoop.ts 会执行这些检查。MOB-086 与当前工程说明也记录了原先更严格的邮件隐私边界。
- 本轮产品决策**不等于授权立即删除所有邮件防护**；需要单独校正隐私/数据去向/显式审批合同，证明合法链路可通、恶意注入与越权链路仍阻断。不得靠删测试或一键放开权限来制造绿灯。

### D10：保留已有 Host 发现价值，不把其当成全部能力发现

- 当前 Mobile 的 mira_desktop_hosts 是模型可见的 Desktop Host 发现入口，有实际的授权 Host 探测与同轮 refreshedTools 更新；设计原因是复用既有 Remote Tool Gateway、避免跨 Host 凭据/工具别名混用。这一层的存在 **不是错误**。
- 不足之处在于：现有 Cloud Local Agent 首轮主要让模型主动调用 Host 发现工具，然后取得的是远程扁平的完整 Tool Schema 清单。它缺少「环境摘要 → 服务声明的能力画像 → 按需 Tool Schema」的连续披露机制。
- 后续用 **Desktop MCP Server 出口**统一工具互操作：从既有 Harness/Capability View/Agent Access/Runtime Readiness 投影 MCP Tools 与可选语义 Resource，Mobile 使用通用 MCP 消费基座；现有 `mira_desktop_hosts` 继续负责选择/定位已授权 Host，是否合并入口取决于实际运行证据，不强制另开三轮发现。
- **保留 Remote V1 的现有职责**：设备配对/Cloud Grant、Host 状态、Relay/Direct、Thread/Agent Run/Artifact、审批恢复等仍以当前权威链路为准。MCP 接管的是拟升级的工具发现与调用协议面；接入 Cloud Relay 所需的 MCP HTTP/流式承载仍须独立验证，不能因服务实现了 `/mcp` 就声称可远程调用。

### D11：2026-11-24 正式架构裁决——统一 MCP 服务出口（覆盖此前 B 包 A/B/C 待选项）

维护者先选择 **Hybrid C：标准 MCP + 可选语义能力声明**，本轮进一步明确：**Desktop 自身也可以并应该成为 MCP Server**，与 Who-You 采用相同的工具消费模式。此前“Desktop **仅**保留 Remote V1 并通过专有 Adapter 提供三级工具目录”的路线，**不再是首选施工目标**；但 Remote V1 的跨端会话/传输/身份/授权职责不因此废止。此项为**已确认架构方向，不是已发布的代码事实**。

- **Desktop MCP Server 的定位**：由 Desktop 现有 Tool Core/Harness 提供工具定义与执行，通过受控 MCP Server 标准出口对外暴露，复用现有 Capability View、语义严选范围、运行就绪、账号/设备授权、Policy/Approval、取消与执行记录。MCP Adapter 不新造第二份 Registry、Shell 入口、权限系统或代理运行时。
- **一致的三层描述**：Desktop、Who-You 各自声明稳定服务 ID、语义能力和实际注册工具映射；`tools/list` / `tools/call` 为标准权威，附加语义 Resource 可选且版本化。对第三方 MCP 不强制特殊扩展。
- **统一 Mobile 消费而非统一执行所有权**：Pi Core Local Agent 使用同一 MCP 客户端/Tool Gateway 能力发现与执行抽象；Desktop Tool 调用仍由 Host Harness 判定，Who-You 由云服务自身判定，本机工具由设备侧执行。发现不是授权；账号撤权、断联、Host 切换都须使相应缓存/调用失效。
- **Remote V1 与 MCP 并存边界**：保留 Direct/Tailscale 与官方 Cloud Relay 的现有会话、Host Grant、设备身份、消息/任务/产物和必要兼容接口。Desktop MCP 可对受权的 Local/远程消费者提供工具服务，**不能直接公开监听端口或绕过 Remote Gateway**；采用何种安全承载/转发标准 Streamable HTTP、身份映射、流与取消/审批恢复，需要端到端验证后决定，不承诺原 Relay 已透明支持 MCP。
- **动态发现，非三次发现**：目录有三级，Agent 可零次、一次、多次按需发现，使用已知工具可直接执行；不固定循环/模型回合。不能把一次 `tools/list` 返回的所有 Schema 全部强制送进模型上下文。
- **实现顺序与去重**：Who-You OPS-046 已合入 `dev`；Mobile [MOB-094 #369](https://github.com/uichat-mira/mira-mobile/issues/369) 正负责通用 Pi Core 披露机制（不能擅自重写其当前施工边界）；Desktop B1 需以 MCP Server 的工具出口为目标另行细化，随后再做 Mobile 真实 MCP Adapter 与跨服务 B3 验证。规划归属 [MOB-091 #364](https://github.com/uichat-mira/mira-mobile/issues/364)，Desktop Phase3 总纲 [#315](https://github.com/uichat-mira/mira-desktop/issues/315) 保持产品总范围。**此决策不代表已经派出 Desktop 卡、授权改执行权限或准许生产开放 MCP 接口。**

## 3. 源码证实的当前技术基线（不是目标状态）

Mobile / Desktop 以下为 2026-11-23 至 11-24 的源码快照（后续以当前代码为准）：

- package.json 版本为 **0.4.0**；但版本号不能证明本页新架构已经交付，也不能代替已安装 APK/IPA 的运行证据。
- src/runtime/piAgentLoop.ts 已以 Pi Core 1.6 为本机 Local Provider 的正式编排路径，原 Loop 已退役；当前 Tool Gateway 提供本机+Who-You MCP+Desktop Remote Host 等来源。
- src/tools/localToolGatewayClient.ts 仍在 App 内直接注册 local_weather_current、whoyou_mail_search、whoyou_mail_message_get 三个 Tool；前者直接访问 Open-Meteo，后两者经狐邮的 Streamable HTTP MCP Client。
- src/tools/localAgentToolGateway.ts 的 Cloud Local Agent 起始工具包含本机工具和 mira_desktop_hosts；发现授权 Desktop 后通过 refreshedTools 替换模型工具集合。src/tools/remoteToolGatewayClient.ts、cloudToolHostClient.ts 通过既有 /remote/v1/tools 和远端 invocation/approval/cancel，而不是直接将 Desktop MCP Server 透传给手机。
- src/tools/agentToolPolicies.ts 的邮件链限制仍在执行；D9 是产品目标而不是当前执行行为。
- Desktop dev 的 capability profiles（server/src/harness/profiles/resolver.ts）已把 workspace_lookup、workspace_edit、web、browser 等组织为语义能力；prepare-context、capability-view、progressive-resolution-state、tool-schema-disclosure 实现 compact metadata / on-demand schema / mid-run disclosure，默认披露预算为 8；**这些能力还没有完整作为 Mobile 服务声明接口输出**。
- Desktop `server/src/services/remote-tool-gateway.service.ts` 当前仍从 agent_intent Exposure 输出扁平可调用工具清单，带 Schema；`server/src/routes/remote-access.ts` 的 `/remote/v1/tools` / `/remote/v1/manifest` 不是标准 MCP Server 出口。Desktop 自身有 MCP 相关管理路由与外部 MCP 客户端适配，**不等于对外 Streamable HTTP MCP Server 已建立或获授权暴露**。
- Who-You `dev` 的 OPS-046 / PR #80 已合入标准 MCP JSON Resource（17 能力 / 30 Tool 的分组投影），原 `tools/list` / `tools/call` 保留；没有证据表明线上服务已部署新 Resource 或 Mobile 已以此动态消费。
- **尚未声称** Desktop MCP Server、Mobile 跨服务三层消费、统一严选出口、D9 邮件后续工具链策略或真机/成本基准测试已经交付。

## 4. 外部研究与证据等级（2026-11-23 查证）

| 议题 | 证据与可得结论 | 边界 |
| --- | --- | --- |
| MCP 2026-07-28 核心规范 | 官方发布确认 server/discover、tools/list、tools/call、可缓存列表等基础；可作为协议适配基础。见 [MCP 官方发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)。 | MCP 的协议 capabilities（如支持 tools）**不是** Mira 的业务语义 Capability Profile；不能把 server/discover 当成三层能力目录。 |
| MCP Server instructions | MCP 支持服务提供用法说明，见 [官方 Server Instructions 文章](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/)。 | 说明文本不能代替当前 Host/账号授权、就绪与真实 Schema。 |
| MCP Progressive Disclosure / Groups | [官方路线图](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/) 将渐进式发现列为工作方向；[工作组](https://github.com/modelcontextprotocol/progressive-disclosure-wg) 研究扁平工具目录的分组问题；[Groups SEP PR #19](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19) 提议 groups/list、groups/get 及按组加载工具/资源等。 | **截至本次核查 PR #19 仍为 Open、工作组标记 Experimental；不是已发布的 MCP 核心协议。** 不能要求任意第三方 Server 已支持。 |
| 按需工具披露的真实价值 | [Anthropic Advanced Tool Use](https://www.anthropic.com/research/advanced-tool-use) 展示其 Tool Search 的模型上下文与准确率改进，也明确附带搜索调用的延迟成本。 | 这是 Anthropic 特定模型/样本与实现的证据，不是 Mira Mobile / DeepSeek / Pi Core 的现成收益。 |
| Groups 原型证据 | [PR #19 讨论](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19) 中有人报告 19 Tool、5 Group 原型，仅加载所需 Group 时 JSON Token 占扁平清单约 23%，全部加载反而稍大。 | 非代表性样本；不是 Mira 的 Context Token / 任务完成率实测。Group 展示不等于执行授权，不能代替 tools/call 检查。 |

**研究证据结论（保留 2026-11-23 的证据等级）**：尚无证据证明三层披露对 Mira Mobile 的任务完成率、Token、时延必然更优；MCP Groups 仍不能视为正式核心依赖。**2026-11-24 维护者已经选择了标准 MCP 工具互操作 + 可选语义 Resource，且 Desktop 拟作 MCP Server**：此为明确的架构决策，不能再将协议路线误写成“待 A/B/C 裁决”，但实施和性能收益仍须验证。

## 5. 架构已裁决后仍待验证的工程细节（不重启选型）

1. **Desktop MCP Server 的安全承载与兼容**：标准 MCP Endpoint 如何绑定现有 Cloud Host Grant / Tailscale Direct 设备授权、owner/Host 身份、Relay 传输、SSE/Streamable HTTP、流中断、审批恢复及取消；没有通过真实跨边界验证前，不宣称现有 Relay 已兼容标准 MCP，也不删除 Remote V1 会话/Agent/Artifact 接口。
2. **语义声明具体投影**：Who-You 已交付 `mira.service-capabilities/v1`，Desktop 需在同一可选契约上将既有 Capability Profile/严选范围映射为稳定 Service ID、Capability ID、Tool 引用，明确就绪、权限、失效通知/缓存版本；不同服务不共享业务工具名，也不复制第二份 Tool Registry。
3. **第一层如何告知 Agent**：Runtime 默认给极简环境摘要、按需 Tool 发现，还是组合方式；不能预设一个方案已经确认。零/单/多 Host、云服务、离线/撤销、复合任务要验证。
4. **Desktop 现有侧边栏筛选的共享真相实现**：确认哪些是演示/验收可见、哪些是准入严选，剔除占位项，保证 Mobile 出口与 Desktop 现有维护逻辑同步，不能第二套名单漂移。
5. **安全链的最小风险治理**：邮件/网页内容到后续工具的正常继续；跨 Provider 的敏感数据转移审批；Prompt Injection 不能带来权限提升；阻断注入而不阻断用户明确授权的任务。
6. **能力披露与 Pi Core 的集成**：运行中增量工具 Schema、已披露状态复用、授权撤销/就绪变化再验证、预算与上下文压缩、Provider 对动态 tool set 的兼容性。
7. **MCP 协议版本兼容**：Who-You OPS-046 的 manifest 声明服务端已在测试中覆盖 `2026-07-28`、`2025-11-25`、`2025-06-18` 协议版本；Mobile、Desktop 新 Server 与任意第三方各自支持范围需独立实测。旧 Server 无语义 Resource 时继续以真实 `tools/list` 降级；不得假设所有服务支持 Groups 或 Mira 扩展。

## 6. 后续验证原则：先证明产品价值，再决定实施合同

建议以 **低成本、可重复且不绕过真实执行权威** 的对照 POC，至少覆盖：

- 天气类自然语言任务：没有硬编码城市/API URL 的情况下，能选择正确服务、能力与联网工具并实际交付结果。
- Desktop MCP Server 远程 Web / 文件任务：零/单/多 Host、已授权/未就绪/撤销，准确定位且不泄漏未准入工具；验证标准 MCP 工具发现/调用 → Harness 审批执行 → Evidence，并分别证明 Direct 与经正式适配的 Cloud Relay 传输，不用旧 Remote V1 的通路测试冒充 MCP 已接通。
- 狐邮搜索→阅读→在用户允许范围内整理/保存：允许合法连续调用；敏感数据披露仍有清楚的接收方/范围确认；网页/邮件内的冒用指令不能改变授权。
- Browser 多步工具调用：在选中服务/能力后继续完成下一步，不为每一步重复选择服务或强制重启任务。
- **量化而非凭感觉**：任务完成率、工具选择正确率、无效工具调用/误阻断、模型 Token、额外模型回合、首响应和任务总耗时、网络负担、权限错误。不同 Provider/Android/iOS 的结论必须对应实际测过的环境。

不能把通过静态测试写成真机完成；不能因工具发现成功就判断用户任务完成；不能靠模型编造远程工具信息、硬编码网络接口、放弃审批或给调用链无条件放权来制造演示成功。

## 7. 已知不一致与变更纪律

- **现状 vs D1–D5**：#354 已列出扫码旧 Relay fallback、连接入口、账号/退出状态、WebFetch 等实现偏差。本文不复制状态台账，按 #354 及后续独立实施卡执行。
- **现状 vs D6–D8/D11**：Desktop 能力展示筛选、Host 现有 agent_intent 工具出口、Mobile 平铺 Schema 不是同一机制。新方向是 Desktop MCP Server + 可选统一语义 Resource，**但当前仍未实现**；先核实严选/Agent Access/Readiness 再投影，不能用页面占位或宽泛 Registry 冒充可调用能力。
- **现状 vs D9**：MOB-086/当前邮件策略限制后续工具链，与新确认的合法连续调用目标存在产品合同差异。实施前需要明确数据去向与批准规则，更新对应 Issue/验收，不可以仅改文案或删除阻断。
- **来源 vs 状态**：每次发现 Desktop、Who-You、MCP 上游规范变动，先检查相关分支/官方原文，再修订本页；Issue 负责实施合同、代码负责真实行为、外部研究不冒充已实现。
- **决策与实施分离**：本次仅将 2026-11-24 架构裁决写入唯一真相；不据此自动修改正在施工的 MOB-094、跨仓建卡/重构、开放 Desktop 监听、改变授权或直接发布。具体合同变更须在各自 Issue/PR 明确。

---

**一句话产品定义：Mobile 使用统一 MCP 工具互操作机制，按需消费本机/Who-You/Desktop 等服务的「环境（服务）→ 能力 → 工具」可选语义声明；Desktop 同时作为受控 MCP Server 和原 Remote V1 Host，Host/云服务各保留自身授权与执行权威。三级只描述结构，不固定发现路径或次数；新路线的真实效果与跨端可达性仍须验证。**
