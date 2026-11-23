# Mira Mobile 0.4.0 · 产品决策与能力架构研究唯一真相

> 状态：**产品决策基线（已确认项）+ 研究证据（非实施授权）**  
> 适用：Mira Mobile Local Provider / Pi Core 的工具发现、跨服务能力消费，以及与 Desktop / Who-You / MCP 的边界  
> 记录截至：2026-11-23  
> **重要：0.4.0 是本轮讨论的版本基线，不表示本页目标架构已随 0.4.0-dev 发布。** 具体版本和执行现状仍以对应分支、源码、构建及真机证据为准。

## 1. 真相源与文档边界

本页是 **Mobile 0.4.0 相关跨服务能力消费的产品决策、研究结论、待决问题** 的唯一汇总入口；后续相同主题只在这里维护结论，不在多份随手文档重复定义协议或复制任务状态。

- **已运行事实**：以各仓库当前代码、配置和真实运行证据为准；Mobile 现状详见 [Pi Core 工程真相](engineering/pi-core-mobile-bridge.md)，Desktop 现状详见 [Desktop Tool 当前真相](https://github.com/uichat-mira/mira-desktop/blob/dev/docs/TOOL_CURRENT_TRUTH.md)。
- **具体施工范围、验收与结论**：以 GitHub Issue / PR 为准。尤其 [MOB-090 #354](https://github.com/uichat-mira/mira-mobile/issues/354) 持有 D1–D5 的完整原始决策合同；[MOB-087 #342](https://github.com/uichat-mira/mira-mobile/issues/342)、[MOB-088 #343](https://github.com/uichat-mira/mira-mobile/issues/343) 持有既有 Host Gateway/选机合同。
- **本页的决策** 表示维护者已表明产品方向，**不代表代码已实现、批准新的跨仓协议、授权开卡/施工/合并/发布**。
- **本页的研究** 只说明已有证据能证明什么；外部协议提案、内部静态代码检查、工程推断、已验收功能必须分开。
- Mira Mobile 两条既有路径——Remote Host 与 Local Provider——继续独立；此处讨论的三层披露主要针对 **Local Provider 下的 Pi Core Agent 发现与消费工具**，不擅自改变 Remote Host 自有 Agent Run 的执行权威。

## 2. 已确认的 0.4.0 产品决策（2026-11-23）

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
- **渐进式披露只控制信息可见性与上下文成本，不是执行阻断器。** 同一服务、同一能力内的工具可连续工作；完成任务需要时也允许跨能力、跨服务工作流，在实际调用时仍分别检查执行权威、授权和审批。
- 明确命中或已披露的内容可以复用；**不要求每一步都额外消耗模型回合**。多 Host 不可消歧时保持当前真实 Host 选择约束，不猜选、不跨 Host 重放。

### D8：Mobile 只建设机制，不耦合外部能力集合

- **Mobile 的长期职责**：发现服务、接受与校验能力声明、分级披露、为 Pi Core 提供适量模型上下文、工具调用路由、授权/审批交互、失败/结果回传和会话生命周期。
- **外部服务的职责**：描述自己是谁、提供哪些能力、各能力能完成什么任务、有哪些具体工具及调用说明；真实工具 Schema、执行/权限事实由所属服务或其权威 Adapter 提供。
- 不在 Mobile 源码持续维护 Desktop/狐邮/每个第三方 Server 的硬编码能力分组或工具列表；**新增符合约定的服务/能力，原则上不应要求 Mobile 修改业务代码或重新发包**。
- 「不耦合业务能力」不意味着「无协议适配」：Mobile 仍需拥有有限且清晰的协议适配、认证、状态与运行时契约。不同服务或老协议需要的 Adapter 不能凭想象消失。
- 普通 MCP Server 若没有语义能力分组，不能伪造其拥有 Groups；应先利用它真实提供的标准工具元数据做兼容披露。Mira 自有服务可提供更完整的语义分组，但格式与协商方式尚未确定。

### D9：外部数据可以驱动合法工具链；指令权限不可来自数据本身

- **已确认的产品原则**：网页、搜索结果、邮件、文档等第三方数据可以成为 Agent 后续工具调用的**事实输入**。不得一概以「网络来的数据不可信」为理由阻断正常浏览、搜索→打开、邮件读取→整理→保存等合法工作流。
- **仍需保持的安全区别**：外部数据不能仅凭正文里的命令提升为用户/系统指令，也不能自动扩张 Host Grant、账号授权、收件人或外传范围。实际副作用、敏感数据发往外部 Provider、跨服务传输等仍要符合相应授权/用户批准与执行策略。
- **当前实现存在明确冲突**：Mobile 的 src/tools/agentToolPolicies.ts 中 MailStage 在邮件搜索后只开放邮件正文、读正文后禁止继续 Tool，并在批调用中禁止邮件工具与其他操作组合；src/runtime/piAgentLoop.ts 会执行这些检查。MOB-086 与当前工程说明也记录了原先更严格的邮件隐私边界。
- 本轮产品决策**不等于授权立即删除所有邮件防护**；需要单独校正隐私/数据去向/显式审批合同，证明合法链路可通、恶意注入与越权链路仍阻断。不得靠删测试或一键放开权限来制造绿灯。

### D10：保留已有 Host 发现价值，不把其当成全部能力发现

- 当前 Mobile 的 mira_desktop_hosts 是模型可见的 Desktop Host 发现入口，有实际的授权 Host 探测与同轮 refreshedTools 更新；设计原因是复用既有 Remote Tool Gateway、避免跨 Host 凭据/工具别名混用。这一层的存在 **不是错误**。
- 不足之处在于：现有 Cloud Local Agent 首轮主要让模型主动调用 Host 发现工具，然后取得的是远程扁平的完整 Tool Schema 清单。它缺少「环境摘要 → 服务声明的能力画像 → 按需 Tool Schema」的连续披露机制。
- 后续应在这条已运行的 Host/Gateway 链路之上补发现和披露契约，不应为了形式统一重造 Relay、Host 执行、审批或 Pi Agent Runtime。

## 3. 源码证实的当前技术基线（不是目标状态）

截至 2026-11-23 静态核对的 Mobile dev：

- package.json 版本为 **0.4.0**；但版本号不能证明本页新架构已经交付，也不能代替已安装 APK/IPA 的运行证据。
- src/runtime/piAgentLoop.ts 已以 Pi Core 1.6 为本机 Local Provider 的正式编排路径，原 Loop 已退役；当前 Tool Gateway 提供本机+Who-You MCP+Desktop Remote Host 等来源。
- src/tools/localToolGatewayClient.ts 仍在 App 内直接注册 local_weather_current、whoyou_mail_search、whoyou_mail_message_get 三个 Tool；前者直接访问 Open-Meteo，后两者经狐邮的 Streamable HTTP MCP Client。
- src/tools/localAgentToolGateway.ts 的 Cloud Local Agent 起始工具包含本机工具和 mira_desktop_hosts；发现授权 Desktop 后通过 refreshedTools 替换模型工具集合。src/tools/remoteToolGatewayClient.ts、cloudToolHostClient.ts 通过既有 /remote/v1/tools 和远端 invocation/approval/cancel，而不是直接将 Desktop MCP Server 透传给手机。
- src/tools/agentToolPolicies.ts 的邮件链限制仍在执行；D9 是产品目标而不是当前执行行为。
- Desktop dev 的 capability profiles（server/src/harness/profiles/resolver.ts）已把 workspace_lookup、workspace_edit、web、browser 等组织为语义能力；prepare-context、capability-view、progressive-resolution-state、tool-schema-disclosure 实现 compact metadata / on-demand schema / mid-run disclosure，默认披露预算为 8；**这些能力还没有完整作为 Mobile 服务声明接口输出**。
- Desktop server/src/services/remote-tool-gateway.service.ts 当前仍从 agent_intent Exposure 输出扁平可调用工具清单，带 Schema；不同于 Desktop 自身 Planner 的 progressive resolution。
- 截至本次记录，**没有宣称已经实现三层披露、跨服务能力声明协议、统一严选出口或 D9 邮件链新策略；也没有新的真机/成本基准测试**。

## 4. 外部研究与证据等级（2026-11-23 查证）

| 议题 | 证据与可得结论 | 边界 |
| --- | --- | --- |
| MCP 2026-07-28 核心规范 | 官方发布确认 server/discover、tools/list、tools/call、可缓存列表等基础；可作为协议适配基础。见 [MCP 官方发布说明](https://blog.modelcontextprotocol.io/posts/2026-07-28/)。 | MCP 的协议 capabilities（如支持 tools）**不是** Mira 的业务语义 Capability Profile；不能把 server/discover 当成三层能力目录。 |
| MCP Server instructions | MCP 支持服务提供用法说明，见 [官方 Server Instructions 文章](https://blog.modelcontextprotocol.io/posts/2025-11-03-using-server-instructions/)。 | 说明文本不能代替当前 Host/账号授权、就绪与真实 Schema。 |
| MCP Progressive Disclosure / Groups | [官方路线图](https://blog.modelcontextprotocol.io/posts/mcp-roadmap/) 将渐进式发现列为工作方向；[工作组](https://github.com/modelcontextprotocol/progressive-disclosure-wg) 研究扁平工具目录的分组问题；[Groups SEP PR #19](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19) 提议 groups/list、groups/get 及按组加载工具/资源等。 | **截至本次核查 PR #19 仍为 Open、工作组标记 Experimental；不是已发布的 MCP 核心协议。** 不能要求任意第三方 Server 已支持。 |
| 按需工具披露的真实价值 | [Anthropic Advanced Tool Use](https://www.anthropic.com/research/advanced-tool-use) 展示其 Tool Search 的模型上下文与准确率改进，也明确附带搜索调用的延迟成本。 | 这是 Anthropic 特定模型/样本与实现的证据，不是 Mira Mobile / DeepSeek / Pi Core 的现成收益。 |
| Groups 原型证据 | [PR #19 讨论](https://github.com/modelcontextprotocol/progressive-disclosure-wg/pull/19) 中有人报告 19 Tool、5 Group 原型，仅加载所需 Group 时 JSON Token 占扁平清单约 23%，全部加载反而稍大。 | 非代表性样本；不是 Mira 的 Context Token / 任务完成率实测。Group 展示不等于执行授权，不能代替 tools/call 检查。 |

**证据判断**：三层披露与「服务定义能力、Mobile 负责消费」是有工程实证支持的**候选架构**；其中 MCP Groups 在研究/实验阶段。**没有充分证据**在现在就选择「MCP Only」，或认定三层必然比目前方案快/便宜/准确。

## 5. 尚未决定的技术问题（不能替维护者拍板）

1. **协议承载**：保留 Remote Host V1 并扩展分级发现；还是采用标准 MCP + 实验性 Groups/自有扩展；或 Hybrid。需要先对照升级与回退、移动端授权/票据、工具执行的真实要求。
2. **语义画像格式与归属**：服务与能力唯一 ID、用途、tags、Tool 对应关系、Schema 引用、状态/权限信息、失效通知/缓存边界、兼容性；Desktop 的现有 Profile 能否直接投影给外部客户端。
3. **第一层如何告知 Agent**：Runtime 默认给极简环境摘要、按需 Tool 发现，还是组合方式；不能预设一个方案已经确认。零/单/多 Host、云服务、离线/撤销、复合任务要验证。
4. **Desktop 现有侧边栏筛选的共享真相实现**：确认哪些是演示/验收可见、哪些是准入严选，剔除占位项，保证 Mobile 出口与 Desktop 现有维护逻辑同步，不能第二套名单漂移。
5. **安全链的最小风险治理**：邮件/网页内容到后续工具的正常继续；跨 Provider 的敏感数据转移审批；Prompt Injection 不能带来权限提升；阻断注入而不阻断用户明确授权的任务。
6. **能力披露与 Pi Core 的集成**：运行中增量工具 Schema、已披露状态复用、授权撤销/就绪变化再验证、预算与上下文压缩、Provider 对动态 tool set 的兼容性。
7. **外部 MCP 版本兼容**：谁支持新规范或 Groups、Who-You 当前采用的 MCP 2025-06-18、普通旧 Server 如何降级为仅按 Tool 元数据发现；**不得默认所有服务可原生声明三层。**

## 6. 后续验证原则：先证明产品价值，再决定实施合同

建议以 **低成本、可重复且不绕过真实执行权威** 的对照 POC，至少覆盖：

- 天气类自然语言任务：没有硬编码城市/API URL 的情况下，能选择正确服务、能力与联网工具并实际交付结果。
- Desktop 远程 Web / 文件任务：零/单/多 Host、已授权/未就绪/撤销，准确定位且不泄漏未准入工具；连贯调用后返回真实 Evidence。
- 狐邮搜索→阅读→在用户允许范围内整理/保存：允许合法连续调用；敏感数据披露仍有清楚的接收方/范围确认；网页/邮件内的冒用指令不能改变授权。
- Browser 多步工具调用：在选中服务/能力后继续完成下一步，不为每一步重复选择服务或强制重启任务。
- **量化而非凭感觉**：任务完成率、工具选择正确率、无效工具调用/误阻断、模型 Token、额外模型回合、首响应和任务总耗时、网络负担、权限错误。不同 Provider/Android/iOS 的结论必须对应实际测过的环境。

不能把通过静态测试写成真机完成；不能因工具发现成功就判断用户任务完成；不能靠模型编造远程工具信息、硬编码网络接口、放弃审批或给调用链无条件放权来制造演示成功。

## 7. 已知不一致与变更纪律

- **现状 vs D1–D5**：#354 已列出扫码旧 Relay fallback、连接入口、账号/退出状态、WebFetch 等实现偏差。本文不复制状态台账，按 #354 及后续独立实施卡执行。
- **现状 vs D6–D8**：Desktop 可用能力的展示筛选、Host 实际 agent_intent 工具出口和 Mobile 平铺 Schema 不是同一个机制。先对照代码厘清准入，再设计共享投影；现有现象不是已完成三层。
- **现状 vs D9**：MOB-086/当前邮件策略限制后续工具链，与新确认的合法连续调用目标存在产品合同差异。实施前需要明确数据去向与批准规则，更新对应 Issue/验收，不可以仅改文案或删除阻断。
- **来源 vs 状态**：每次发现 Desktop、Who-You、MCP 上游规范变动，先检查相关分支/官方原文，再修订本页；Issue 负责实施合同、代码负责真实行为、外部研究不冒充已实现。
- **范围**：本轮仅归档决定与研究；不创建新的施工 Issue，不授权跨仓改代码、更新权限、改 App 包、合并或发布。

---

**一句话产品定义：Mobile 负责通用服务发现与三层渐进披露机制；外部服务负责解释自己能做什么及提供真实工具；在保持原执行权威和必要授权的前提下，Pi Core 能连续完成用户任务。MCP 是需要以实验证明优劣的首选候选之一，而非已经敲定的唯一实现。**
