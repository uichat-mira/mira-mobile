# Mira Mobile 0.4.0 · 产品决策与能力架构研究唯一真相

> 状态：**产品决策基线（已确认项）+ 研究证据（非实施授权）**  
> 适用：Mira Mobile Local Provider / Pi Core 的工具发现、跨服务能力消费，以及与 Desktop / Who-You / MCP 的边界  
> 记录截至：2026-11-24  
> **重要：0.4.0 是本轮讨论的版本基线，不表示本页目标架构已随 0.4.0-dev 发布。** 具体版本和执行现状仍以对应分支、源码、构建及真机证据为准。

## 1. 真相源与文档边界

本页是 **Mobile 0.4.0 相关跨服务能力消费的产品决策、研究结论、待决问题** 的唯一汇总入口；后续相同主题只在这里维护结论，不在多份随手文档重复定义协议或复制任务状态。

- **已运行事实**：以各仓库当前代码、配置和真实运行证据为准；Mobile 现状详见 [Pi Core 工程真相](engineering/pi-core-mobile-bridge.md)，Desktop 现状详见 [Desktop Tool 当前真相](https://github.com/uichat-mira/mira-desktop/blob/dev/docs/TOOL_CURRENT_TRUTH.md)。
- **具体施工范围、验收与结论**：以 GitHub Issue / PR 为准。尤其 [MOB-090 #354](https://github.com/uichat-mira/mira-mobile/issues/354) 持有 D1–D5 的完整原始决策合同；[MOB-087 #342](https://github.com/uichat-mira/mira-mobile/issues/342)、[MOB-088 #343](https://github.com/uichat-mira/mira-mobile/issues/343) 持有既有 Host Gateway/选机合同。
- **本页的决策** 表示维护者已表明产品方向，**不代表代码已实现、批准新的跨仓协议、授权开卡/施工/合并/发布**。
- **本页的研究** 只说明已有证据能证明什么；外部协议提案、内部静态代码检查、工程推断、已验收功能必须分开。
- Mira Mobile 两条既有路径——Remote Host 与 Local Provider——继续独立；此处讨论的三层披露主要针对 **Local Provider 下的 Pi Core Agent 发现与消费工具**，不擅自改变 Remote Host 自有 Agent Run 的执行权威。

## 2. 已确认的 0.4.0 产品决策（2026-11-23 起；11-24 补充架构裁决）

### D1–D5：连接、身份、交互与本机 WebFetch

这五项由 [MOB-090 #354](https://github.com/uichat-mira/mira-mobile/issues/354) 持有完整用户行为、边界、回归与验收合同；本页只做可检索摘要，**不另立重复的施工合同**。

1. **D1：扫码/粘贴/配对深链只面向 Tailscale Direct。** Cloud Relay 经 Mira Cloud 身份与 Host 授权进入，不依赖扫码；2026-11-24 维护者进一步裁决：旧配对 Relay 自动回退及静态 token 路径全部退役，已保存的混合凭据仅保留 Direct，Relay-only 凭据需重新配对；官方 Cloud Relay 独立保留。
2. **D2：Tailscale Direct 与 Cloud Relay 的「活动 Desktop 远程连接」互斥**，另一入口可见但置灰，执行路由不得偷偷回退；**Cloud 账号登录与 Tailscale 直连不互斥**。左下角新建远程会话跟随当前活动连接：Direct 使用 paired Host，Cloud 使用 Cloud Host，无活动连接时先呈现连接选择，不隐式选源。#354 的消歧点已由 [MOB-095 #374](https://github.com/uichat-mira/mira-mobile/issues/374) 落定，活动模式/断开的权威行为见 [远程连接唯一真相源](remote-access/remote-connection-canonical-v1.md) 1.1。
3. **D3：侧边栏右下角为云账号身份入口**；登录后有可信头像时才显示头像，否则合适的账号占位；未登录明确提示，不能用传输连接状态冒充账号身份。
4. **D4：设置页底部是唯一的情境化退出操作位。** 活动 Tailscale 连接优先显示「退出登录（Tailscale）」：确认后只释放当前 Direct 连接并回到扫码入口，Mira ID 与云功能保持登录。无活动 Tailscale 但存在可信 Mira ID（含离线保留身份或活动 Cloud Relay）时显示「退出登录（Mira ID）」：确认后执行真实云账号退出并回到 Mira Cloud 账户页，Cloud Relay、狐邮、云工具/云设备和在途云请求立即失效。两种身份都不存在时不显示。云退出不抹除独立 Tailscale 配对、Local Provider 密钥或本地聊天历史，云账号详情仍保留独立退出能力。
5. **D5：计划用手机本地的单一 web_fetch(query 或 url) 替换专用天气工具。** 既能搜索关键词，也能读取已知公开 URL；不把 Desktop 的双工具划分直接复制到手机。该工具不依赖云登录/桌面在线；搜索 Provider、网络防护、抽取方式及设备验收仍待论证。**当前代码仍是 local_weather_current，不能写成已替换。**

### D6：Desktop 远程能力的准入来源

- Mobile 只消费 **Desktop 现有「侧边栏 → 能力注册」所体现的筛选/严选范围**；Desktop 未纳入该范围的能力，不得仅因注册了 Tool 就进入 Mobile。
- 维护者明确：**不要新造第二套人工严选制度或 Mobile 侧白名单**。应尽可能复用 Desktop 辛苦形成的既有能力筛选与组织逻辑。
- 但是现有页面 **不是后端真实注册全集**：前端由 Registry/External MCP 取得工具，再按照固定验收用例对应 Tool ID 和部分 Managed Browser Tool 生成展示子集；未注册的部分验收用例还会出现「不可用」占位。该页面展示结果既不能直接当作可调用全集，也不能等同于经过真实运行验证的质量认证。
- **需要工程收敛的准确含义**：把既有展示筛选的产品范围转为由 Desktop 权威代码提供、可复用的准入/能力投影，供页面与 Mobile 出口共同引用；排除占位项，并叠加真实注册、运行就绪、Agent Access、Host Grant / scopes 以及每次调用的审批检查。如何在不破坏既有 UI 的前提下抽取共享规则，尚未设计/实施。
- 当前 Desktop Remote Tool Gateway 依据其独立的 agent_intent / Harness Exposure 生成远程清单；**不能宣称它已与上述侧边栏范围完全一致**。

### D7：三层渐进式披露

维护者最终纠正并明确为 **环境（服务）→ 能力（Capability）→ 工具（Tool）**。**三级仅是机器可读的信息组织关系，不规定三次发现、固定轮数、固定探索顺序或每层一次模型调用。**

- **环境/服务**：例如手机本机、某个已授权 Desktop Host、狐邮云服务、后续第三方 MCP Server。说明环境身份、适用任务和能提供的能力概览；具体如何自动提示/按需发现仍待设计。
- **能力**：由服务提供语义画像，说明用途、任务场景、所属工具族、可用性及必要约束；并不向模型一次性灌入所有工具 Schema。
- **工具**：按任务进一步披露具体 Tool 的参数 Schema，完成真实调用；披露本身不等于授权或调用。
- **渐进式披露只控制信息可见性与上下文成本，不是执行阻断器。** 同一服务、同一能力内的工具可连续工作；完成任务需要时也允许跨能力、跨服务工作流，在实际调用时仍分别检查执行权威、授权和审批。
- Agent 可直接调用已知且当前有效的工具，也可按任务从服务、能力或具体工具入口开始探索，跳过层级、返回上层、跨能力/服务继续；明确命中或已披露的 Schema 可在授权与版本有效期内复用。**不设置固定发现循环或模型回合数**。多 Host 不可消歧时保持当前真实 Host 选择约束，不猜选、不跨 Host 重放。

### D8：Mobile 只建设机制，不耦合外部能力集合

- **Mobile 的长期职责**：发现服务、接受与校验能力声明、分级披露、为 Pi Core 提供适量模型上下文、工具调用路由、授权/审批交互、失败/结果回传和会话生命周期。
- **外部服务的职责**：描述自己是谁、提供哪些能力、各能力能完成什么任务、有哪些具体工具及调用说明；真实工具 Schema、执行/权限事实由所属服务或其权威 Adapter 提供。
- 不在 Mobile 源码持续维护 Desktop/狐邮/每个第三方 Server 的硬编码能力分组或工具列表；**新增符合约定的服务/能力，原则上不应要求 Mobile 修改业务代码或重新发包**。
- 「不耦合业务能力」不意味着「无协议适配」：Mobile 仍需拥有有限且清晰的协议适配、认证、状态与运行时契约。不同服务或老协议需要的 Adapter 不能凭想象消失。
- 普通 MCP Server 若没有语义能力分组，不能伪造其拥有 Groups；利用真实 `tools/list` 元数据兼容披露。Mira 第一方服务使用**标准 MCP + 可选、版本化语义能力 Resource**；已在狐邮实现的 v1 格式是首批可验证样板，但并非强制所有第三方服务支持的核心 MCP 标准。

### D9：外部数据可以驱动合法工具链；指令权限不可来自数据本身

- **已确认的产品原则**：网页、搜索结果、邮件、文档等第三方数据可以成为 Agent 后续工具调用的**事实输入**。不得一概以「网络来的数据不可信」为理由阻断正常浏览、搜索→打开、邮件读取→整理→保存等合法工作流。
- **仍需保持的安全区别**：外部数据不能仅凭正文里的命令提升为用户/系统指令，也不能自动扩张 Host Grant、账号授权、收件人或外传范围。实际副作用、敏感数据发往外部 Provider、跨服务传输等仍要符合相应授权/用户批准与执行策略。
- **2026-11-24 MOB-100 已移除冲突实现**：src/tools/agentToolPolicies.ts 的 MailStage、`MAIL_TOOL_CHAIN_RESTRICTED` 及 src/runtime/piAgentLoop.ts 中按前序邮件结果缩减工具集、禁止跨能力披露的检查已从活动执行路径删除，不再以新状态机、白名单或意图分类器替代。已授权工具不会因前序结果被禁用；工具结果只是模型可用的数据。
- **保留的边界**：`sensitiveResult` 仅承载现有狐邮向 Local Provider 的逐次披露同意与接收方提示，不参与工具选择；身份/服务绑定、授权范围、撤权、schema/目录校验、具体服务审批、审批拒绝、取消与预算仍按既有合同执行。外部数据中的指令不能提升权限或扩大外传范围。
- **未来审批设计意图（本期不实现）**：可由 MCP Server 声明工具评级，Gateway 按评级和用户忽略设置确定性地放行或弹窗；本期不新增评级、字段、设置或弹窗。
- **残余风险（记录，不虚报解决）**：狐邮披露同意只覆盖将数据交给当前模型；后续调用若把该内容发往其他服务，仍须由目标服务现有 exact-call 审批/授权合同覆盖。Mobile 不新增载荷语义分类器；若某服务缺少参数级审批，该缺口由 #337 与该服务权威解决。
- 早期产品决策**不等于**无合同地删除邮件防护；MOB-100 通过删除语义阻断、保留明确审批/隐私合同并更新测试来落地，没有靠删测试或一键放开权限制造绿灯。

### D10：保留已有 Host 发现价值，不把其当成全部能力发现

- 当前 Mobile 的 mira_desktop_hosts 是模型可见的 Desktop Host 发现入口，有实际的授权 Host 探测与同轮 refreshedTools 更新；设计原因是复用既有 Remote Tool Gateway、避免跨 Host 凭据/工具别名混用。这一层的存在 **不是错误**。
- 不足之处在于：现有 Cloud Local Agent 首轮主要让模型主动调用 Host 发现工具，然后取得远程扁平的完整 Tool Schema 清单；尚未提供服务与能力摘要、针对具体 Tool 的动态披露及有效期复用。**这并不意味着必须按三级顺序逐次调用发现工具。**
- 迁移应复用已运行的 Host/Gateway 身份与执行链，在其受控边界新增标准 MCP Tool 出口与通用消费；不因统一协议而重造 Relay、Host 执行、审批或 Pi Agent Runtime，也不能在未验证替代路径前移除现有 Remote V1 工具调用。

### D11：统一 MCP Server 暴露模式（2026-11-24 维护者正式裁决）

**架构路线明确：Hybrid C 的统一 MCP 版本。Desktop 与 Who-You 都作为标准 MCP Server 暴露 Tool；Mobile 的 Pi Core 使用一套通用 MCP Client/可信 Tool Gateway 消费。** 不再以「Desktop 仅暴露 Remote V1 专有 Tool 目录，再由 Mobile 编写 Desktop 专用三级协议 Adapter」作为目标方案。这里的 Hybrid 是**MCP 工具互操作 + 可选语义能力声明 + 保留必要的 Remote V1 远程业务基础设施**，不是 Desktop 工具继续独占自定义 Remote V1 协议。

- **标准工具面**：第一方服务通过 MCP `tools/list`、`tools/call` 暴露真实 Tool 和 Schema，可选以只读 `resources/list`、`resources/read` 发布服务 → 业务能力 → Tool 的稳定关系与说明。协议层 MCP `capabilities` 不等于业务 Capability；**不依赖实验性的 MCP Groups**。没有语义 Resource 的标准第三方服务仍可被通用消费，但不能伪造分组。
- **Desktop MCP Server 是受控协议出口，不是第二套执行引擎**：从 Desktop 已有 Tool Core/Harness、Runtime Readiness、Capability View 和既定对 Mobile 的准入筛选投影真实可用 Tool；MCP `tools/call` 必须回到现有 Gateway → Normalize/Policy/Approval/Harness（或等价的既有受控执行链），不得新建影子 Registry、独立 allowlist 或绕过 Host Grant/账号归属/具体操作审批。Desktop 自己的 Agent 内部使用现有机制，不强迫所有本地调用绕远端 MCP。
- **Remote V1 保留非工具职责**：Cloud 设备发现、登录阶段 Host Grant、设备身份和权限、官方 Relay/Tailscale 传输、Thread/Message/Agent Run、审批恢复与 Artifact 仍由既有权威承载；**MCP 统一的是 Tool 协议面，不代表 Remote V1 的这些业务 API 已经可删除或已被 MCP 替代**。Desktop MCP 经 Direct/Relay 到 Mobile 的真实认证、路由、Streamable HTTP/SSE 转发和撤销时效需单独验证，不能把 Relay 票据当成 Tool 执行授权，也不能假定现有 Relay 已透明支持 MCP 流式传输。
- **Mobile 职责**：保留 Local Provider 和 Host-owned Run 两种不同执行所有权；Pi Core 只实现通用标准 MCP Client 与可选能力 Resource 的解析、可信路由、渐进式模型 Schema 披露和缓存失效，不按 Desktop/狐邮名字硬编码工具组。**服务层级不构成三轮状态机**；对已知有效 Tool 可以直接执行，但每次真实执行仍需服务端重新判断权限、当前就绪与必要审批。
- **可验证事实与当前交付**：Who-You OPS-046 / PR #80 已交付可选 MCP Resource（17 个语义能力、30 个真实 Tool），并随 Who-You prod 8a17dcf5 部署生产；Mobile 的受限只读消费由 MOB-096 / PR #377 接入。Desktop AGT-071 / PR #498 已在 dev 交付受控 POST /mcp，复用既有 Harness/Tool Core 与 exact-call 审批；Mobile MOB-097 / PR #380 已将 MCP 消费收敛为可并存多服务 binding。MOB-098 在上述真实基线上完成当前 Desktop 的 Direct/官方 Relay MCP 接线。**这些代码与自动化证据不等于真机 T4 已完成。**
- **实施收敛**：B1（Desktop MCP 出口）与 B2（Mobile 通用多服务消费）已进入 dev；B3 当前代码已把 Desktop 与 Who-You 纳入同一 Pi Core 服务目录并退役旧 Mobile Agent Remote V1 聚合入口。Remote V1 继续承担设备/Host/会话、审批恢复、取消等非 MCP 权威。下一步重点是维护者真机跨端验收及 D9 合法数据连续调用策略，不再重新选择协议路线。

## 3. 源码证实的当前技术基线（不是目标状态）

截至 2026-11-23 静态核对的 Mobile dev：

- package.json 版本为 **0.4.0**；但版本号不能证明本页新架构已经交付，也不能代替已安装 APK/IPA 的运行证据。
- src/runtime/piAgentLoop.ts 已以 Pi Core 1.6 为本机 Local Provider 的正式编排路径，原 Loop 已退役；当前 Tool Gateway 提供本机+Who-You MCP+Desktop Remote Host 等来源。
- src/tools/localToolGatewayClient.ts 仍在 App 内直接注册 local_weather_current、whoyou_mail_search、whoyou_mail_message_get 三个 Tool；前者直接访问 Open-Meteo，后两者经狐邮的 Streamable HTTP MCP Client。
- src/tools/localAgentToolGateway.ts 的 Cloud Local Agent 起始工具包含本机工具和 mira_desktop_hosts；发现授权 Desktop 后通过 refreshedTools 替换模型工具集合。src/tools/remoteToolGatewayClient.ts、cloudToolHostClient.ts 通过既有 /remote/v1/tools 和远端 invocation/approval/cancel，而不是直接将 Desktop MCP Server 透传给手机。
- **MOB-100 / 语义工具链阻断移除（2026-11-24）**：src/tools/agentToolPolicies.ts 的 MailStage/邮件调用链限制和 src/runtime/piAgentLoop.ts 的结果驱动工具集缩减/跨能力披露阻断已删除。授权工具在前序结果后保持可见，邮件结果可用于后续合法调用参数；`sensitiveResult` 仅保留披露审批与接收方提示。身份/绑定/撤权/schema/审批/取消/预算仍按现有合同。**旧拦截已不在活动路径；自动化只证明源码行为，不代表 0.4.0 真机 T4。**
- **MOB-094 / PR #370 基座切片（2026-11-24）**：`src/tools/toolDisclosure.ts` / `toolGatewayClient.ts` 与 Pi Core 新增受信任的服务目录、可选语义能力、`mira_tools_disclose` 按需获取真实 Schema、运行中动态工具集及版本核对。已知有效工具可直接调用，无固定发现层数或回合；现有 Local Tool Gateway/Host 仍为协议中立基线。**该基座切片本身未实现 Who-You Resource 的真实 MCP 消费、Desktop 标准 MCP Server、Relay MCP 转发或 B3 多服务真机验收；Who-You 消费由下一条 MOB-096 切片另行补充。** 本项的真实交付与验收状态以 PR #370、Issue #369 和相应代码/运行证据为准，不能把代码合并等同于真机与跨服务完成。
- **MOB-096 / 首个 OPS-046 消费切片（2026-11-24）**：`src/mcp/mcpProtocolClient.ts` 提供通用 MCP `initialize` / 分页 `tools/list` / 可选 `resources/*` / `tools/call`；`src/mcp/whoYouMcpService.ts` 复用既有 RFC 9728、短期 `whoyou.read` 凭证与身份校验，读取可选 `mira://service/who-you/capabilities` v1，并由 `src/mcp/mcpServiceCapabilities.ts` 投影为 MOB-094 服务/能力/Schema。**只暴露既有狐邮邮件披露审批覆盖的 `whoyou_mail_search` 与 `whoyou_mail_message_get`**；Resource 缺省、未知版本、跨服务或不一致映射降级为真实 `tools/list` 扁平目录；write/send/destructive 仍不可调用。真实 MCP 的两项许可只读 Tool 经每 run 专用一次性邮件审批后，交由已鉴权的 MCP Client 调用并裁剪为原 Mobile 不可信邮件结果；保留现有静态 UI Reader 路径。收件箱每次最多 10 封、纯文本正文的 Mobile 本地隐私限制显式拒绝超限参数；审批前后验证 Cloud 账号、同账号会话令牌及凭证有效期，不新增影子 Tool Registry。**当前证据为协议 fixture 与 Pi/Gateway 集成测试，不等于 OPS-046 已部署生产、真实账号 T4 或跨端联调完成。**
- **MOB-097 / 多服务绑定基线（2026-11-24）**：`src/mcp/mcpServiceBinding.ts` 将动态 MCP 来源收敛为可并存的独立服务 binding，每个 binding 自带稳定服务类型、授权/凭证校验、执行适配器、generation 与有界元数据复用；`LocalAgentToolGateway` 只做通用组合、确定性的工具名冲突拒绝、按工具/服务路由，并在单个 binding 丢失授权时隔离失败而不影响兄弟服务或本机普通聊天。`src/mcp/mcpServiceCapabilities.ts` 不再硬编码只读：能力分组由显式 `permittedAccess` 与 `permittedToolNames` 策略决定，允许真实非只读能力被分组但不会因此获得未许可 Tool。Desktop 的服务类型统一为 `mira-desktop`，Direct/Cloud 只改变内部实例与连接 generation；同模式重连、断线或账号变化会让既有 Desktop Tool 绑定失效。**验证使用两个独立 JSON-RPC MCP fixture 与真实 Pi Core/Gateway 路由；Desktop 标准 MCP Server、Relay MCP 传输和真实第三方 MCP 联调仍未交付，不能据此宣称跨端 MCP 已上线。**
- **MOB-098 / Desktop MCP 跨端接线（2026-11-24）**：在 Desktop dev 已交付受控 POST /mcp（AGT-071 / PR #498）与 Mobile 多服务 binding（MOB-097 / PR #380）的真实基线上，Mobile 当前活动 Desktop 现以统一服务类型 mira-desktop 接入标准 MCP：Direct 通过既有设备凭据向当前 Host 的 /mcp 发 JSON-RPC，Cloud 通过官方 Relay 向选定 Host 的 /mcp 转发；tools/list / tools/call 不再以 /remote/v1/tools / tool-invocations/stream 作为 Local Agent 主链。需要用户确认的调用仍复用既有 Remote V1 exact-call 审批/取消权威。Direct/Cloud 的 binding 按账号、Host 与 connection generation 隔离并短期复用元数据；同一 generation 可复用，切换/重配后强制失效。Who-You 与 Desktop 可同时进入同一 Pi Core 服务目录，任一服务失败不应拖垮另一服务或本机工具。旧 mobileToolGatewayClient 聚合入口已退役；底层 Remote V1 Tool adapter 暂保留作真机验收前的可回滚实现，不再由 Local Agent 生产入口引用。**当前证据包含协议/transport/联合 Gateway 测试与全仓自动化；真实 iPhone/Android + Desktop + 生产 Who-You 的 T4 仍需维护者真机验收，不能把自动测试写成真机完成。**

- Desktop dev 的 capability profiles（server/src/harness/profiles/resolver.ts）已把 workspace_lookup、workspace_edit、web、browser 等组织为语义能力；prepare-context、capability-view、progressive-resolution-state、tool-schema-disclosure 实现 compact metadata / on-demand schema / mid-run disclosure，默认披露预算为 8；**这些能力还没有完整作为 Mobile 服务声明接口输出**。
- Desktop server/src/services/remote-tool-gateway.service.ts 当前仍从 agent_intent Exposure 输出扁平可调用工具清单，带 Schema；不同于 Desktop 自身 Planner 的 progressive resolution。
- 截至 2026-11-23 的此轮基线核查，**没有宣称 Mobile 已实现三层披露、统一严选出口或 D9 邮件链新策略；也没有新的真机/成本基准测试**。11-24 Who-You 服务端声明合入 `dev` 是随后发生的独立事实，见 D11；不能倒填成 Mobile 已实现或 Desktop 已上线 MCP Server。

## 4. 外部研究与证据等级（2026-11-23 查证）

| 议题 | 证据与可得结论 | 边界 |
| --- | --- | --- |
| MCP 2026-07-28 核心规范 | 官方发布确认 server/discover、tools/list、tools/call、可缓存列表等基础；可作为协议适配基础。见 [MCP 官方发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)。 | MCP 的协议 capabilities（如支持 tools）**不是** Mira 的业务语义 Capability Profile；不能把 server/discover 当成三层能力目录。 |
| MCP Server instructions | MCP 支持服务提供用法说明，见 [官方 Server Instructions 文章](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/)。 | 说明文本不能代替当前 Host/账号授权、就绪与真实 Schema。 |
| MCP Progressive Disclosure / Groups | [官方路线图](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/) 将渐进式发现列为工作方向；[工作组](https://github.com/modelcontextprotocol/progressive-disclosure-wg) 研究扁平工具目录的分组问题；[Groups SEP PR #19](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19) 提议 groups/list、groups/get 及按组加载工具/资源等。 | **截至本次核查 PR #19 仍为 Open、工作组标记 Experimental；不是已发布的 MCP 核心协议。** 不能要求任意第三方 Server 已支持。 |
| 按需工具披露的真实价值 | [Anthropic Advanced Tool Use](https://www.anthropic.com/research/advanced-tool-use) 展示其 Tool Search 的模型上下文与准确率改进，也明确附带搜索调用的延迟成本。 | 这是 Anthropic 特定模型/样本与实现的证据，不是 Mira Mobile / DeepSeek / Pi Core 的现成收益。 |
| Groups 原型证据 | [PR #19 讨论](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19) 中有人报告 19 Tool、5 Group 原型，仅加载所需 Group 时 JSON Token 占扁平清单约 23%，全部加载反而稍大。 | 非代表性样本；不是 Mira 的 Context Token / 任务完成率实测。Group 展示不等于执行授权，不能代替 tools/call 检查。 |

**证据判断（研究与产品裁决分开）**：MCP Groups 仍是研究/实验方向，三层披露的性能收益还需 Mira 实测；这不妨碍维护者在 2026-11-24 **正式选择标准 MCP Tool 互操作 + 可选语义 Resource、Desktop/Who-You 均作为 MCP Server**。协议路线已裁决，不再把 Remote V1 专用工具协议 vs MCP 的 A/B/C 选择交给施工牛马。

## 5. 尚未决定的工程细节（协议路线已裁决，不由 Worker 重选）

1. **Desktop MCP Server 的最小宿主方式**：如何复用现有 Fastify Backend/Harness、现行 Mobile-safe Agent Exposure、Tool 名称与调用追踪；是否及如何经 Tailscale/官方 Relay 承载标准 Streamable HTTP、流式事件、重连/取消，同时保留 Remote V1 会话及设备管理。**不是重新选择是否用 MCP。**
2. **真实身份与授权映射**：MCP Resource/Tool 的认证如何绑定 Desktop Host、Cloud Account、Mobile device、有效 Grant/scopes 与 Desktop owner；撤权/Host 切换、访问 Token 缓存、端到端审批、错误隔离和 SSE 代理逐项验证。不得公开未经授权的本地 MCP 端口。
3. **语义 Resource 的通用契约与版本协商**：以 Who-You 已交付的 v1 Resource 为第一方样板，核对 Desktop Tool Core 的能力分组、稳定 ID、版本、Tool 引用、动态可用状态与 Schema 权威；无 Resource、未知版本、工具增删与缓存过期时按真实 `tools/list` 降级。
4. **第一层如何告知 Agent**：可以极简服务摘要、直接已知工具或按需探索；零/单/多 Host、云服务、离线/撤权、复合任务分别验证。**不规定任何固定发现路径、循环次数或每层一轮推理。**
5. **Desktop 现有侧边栏筛选的共享真相实现**：核实哪些是演示/验收可见、哪些构成移动端准入；剔除占位并连接 Harness Readiness/Policy，不能产生独立第二份人工 Tool 白名单。
6. **安全链的最小风险治理**：外部网页/邮件可成为后续合法工具链输入，但 Prompt Injection 不能提升权限；跨 Provider 敏感数据转移仍需当前授权和具体批准，协调 #337 数据披露合同。
7. **Pi Core 的真实 MCP 接线与性能**：运行中增量工具 Schema、已披露复用、Provider 动态 tool set 兼容、预算/上下文压缩和错误重试；比较真实任务完成率、Token、回合数及延迟，不把理论节省写成实测结论。

## 6. 后续验证原则：在已裁决 MCP 路线上证明真实产品价值

实施仍需 **低成本、可重复且不绕过真实执行权威** 的协议与任务对照验证，至少覆盖：

- 天气类自然语言任务：没有硬编码城市/API URL 的情况下，能选择正确服务、能力与联网工具并实际交付结果。
- Desktop 远程 Web / 文件任务：零/单/多 Host、已授权/未就绪/撤销，准确定位且不泄漏未准入工具；连贯调用后返回真实 Evidence。
- 狐邮搜索→阅读→在用户允许范围内整理/保存：允许合法连续调用；敏感数据披露仍有清楚的接收方/范围确认；网页/邮件内的冒用指令不能改变授权。
- Browser 多步工具调用：在选中服务/能力后继续完成下一步，不为每一步重复选择服务或强制重启任务。
- **量化而非凭感觉**：任务完成率、工具选择正确率、无效工具调用/误阻断、模型 Token、额外模型回合、首响应和任务总耗时、网络负担、权限错误。不同 Provider/Android/iOS 的结论必须对应实际测过的环境。

不能把通过静态测试写成真机完成；不能因工具发现成功就判断用户任务完成；不能靠模型编造远程工具信息、硬编码网络接口、放弃审批或给调用链无条件放权来制造演示成功。

## 7. 已知不一致与变更纪律

- **现状 vs D1–D5**：#354 已列出扫码旧 Relay fallback、连接入口、账号/退出状态、WebFetch 等实现偏差。本文不复制状态台账，按 #354 及后续独立实施卡执行。
- **现状 vs D6–D8/D11**：Desktop 现有 UI 筛选、Harness agent_intent 出口与 Mobile 扁平 Schema 尚未统一。既定目标现已改为 Desktop 受控 MCP Server + 可选能力 Resource；现有 Remote V1 Tool API 仍在运行，不能因本次文档裁决将其当作已经迁移或擅自删去。
- **现状 vs D9**：MOB-100 已按实施合同移除 MailStage 与结果驱动工具链阻断，保留 `sensitiveResult` 的披露审批、接收方提示和既有身份/授权/审批合同。合法连续调用现为活动实现；真实邮件与隐私验收仍由 #337，真机 T4 仍由维护者在代码审查合入后统一开展。
- **来源 vs 状态**：每次发现 Desktop、Who-You、MCP 上游规范变动，先检查相关分支/官方原文，再修订本页；Issue 负责实施合同、代码负责真实行为、外部研究不冒充已实现。
- **范围**：本次仅归档维护者裁决、研究和既有交付事实；不新增施工 Issue、不授权跨仓执行链重写、权限放宽、改 App 包或环境发布。既有施工仍按各 Issue 合同推进，协议方向冲突处须先回填归属 Issue。

---

**一句话产品定义：Mobile Pi Core 以通用 MCP Client 消费 Desktop、Who-You 及未来 MCP Server；第一方服务可选声明「环境（服务）→ 能力 → 工具」，Agent 自适应发现、按需披露 Schema 并连续调用。Desktop 保留自身 Harness/审批与必要 Remote V1 远程业务权威；协议方向已裁决，未交付部分必须以代码与运行证据验收。**
