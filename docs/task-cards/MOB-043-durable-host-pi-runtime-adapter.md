# MOB-043：Host / Pi 持久运行时适配

状态：**PASS**（2026-09-07 维护者自审收口；Mobile lifecycle 与 Host durable correctness 已修复，真机矩阵继续归 MOB-044）

范围：Mira Mobile + Mira Host / Pi Runtime 协作

依赖：MOB-037 运行时抽象；MOB-041 Tool Gateway 协议合同。Host / Pi Runtime 的现有稳定能力核实与可依赖合同确认属于本卡施工内容，不另设隐含前置卡。

## 目标

为长时间运行、审批暂停、后台继续、应用重启恢复和队列编排提供真正的持久运行时路径。移动端只观察和控制该运行时，不在手机内伪造持久执行。

## 功能范围

- 先核实现有 Mira Host / Pi Runtime 的真实能力，冻结本卡可依赖的 RPC / HTTP / WebSocket 合同与状态语义；如现状不足，明确记录缺口，不由 Mobile 猜测协议。
- 基于已确认合同增加 Host / Pi Runtime Adapter，实现运行创建、状态查询、事件订阅、取消和恢复。
- 同步运行状态、审批状态、工具状态、暂停原因、失败原因和完成结果。
- App 进入后台、被系统终止或重新打开后，能够重新加载服务端运行事实。
- 复用现有 `ConversationRuntime` 事件模型和聊天 UI。
- 明确本地 Provider 任务何时可转交持久运行时，以及转交后的 Provider / Tool 凭据边界。

## 非目标

- 不把 Pi/PiLoop、Shell、Git、文件系统或 MCP 子进程打包进 React Native。
- 不在移动端实现队列、重试编排或审批业务规则。
- 不在 Host/Pi 协议未确认前猜测路由、状态字段或认证方式。

## 验收标准

- 长任务不会依赖手机前台存活才能继续。
- App 重启后能读取正确的运行状态，不把旧缓存伪装成实时状态。
- 审批、暂停、恢复、取消和失败结果在手机端可解释且可操作。
- Remote Host 既有会话、Agent 审批和本地普通对话保持隔离。
- 移动端没有新增任意本地进程执行能力。

## 阻塞关系

本卡负责核实并确认 Host / Pi Runtime 的稳定协议和凭据授权，再据此完成真实 Adapter。若核实后确认服务端能力尚不存在或不足，必须把该事实登记为明确阻塞并回流对应实现，不得把“等待未知前置”当作本卡完成，也不得由 Mobile 猜测路由或状态字段。

## 2026-09-07 合同核实与实现结论

- **Host 是持久运行事实源。** AgentRun 已由 Host DB 持久化；Mobile 不保存一份可执行 Run，也不重建 Planner / Harness / Pi 状态。
- **创建仍走现有 canonical Chat 合同。** `POST /proxy/chat/default` 在 Host 内创建 AgentRun；当前没有独立 `POST /agent/runs`，因此 Mobile 不新增或猜测 durable run create 路由。Host 从 Run 开始即持久化带 `metadata.agent.runId` 的 Assistant Message，使 App 重开可重新发现 Run。
- **状态与控制沿用 Remote Host V1。** `GET /agent/runs/:runId`、`approve`、`reject`、`cancel`，并由 manifest + `agent:read|approve|control` scope 双重约束。
- **V1 没有事件游标。** manifest 明确 `eventCursor: false`，所以 `DurableHostAgentRuntimeAdapter` 使用 canonical-state replay / polling，不伪造断线事件续传。未来若 Host 提供 event cursor，可在 Adapter 内替换观察实现。
- **取消语义已补实。** Host 为运行中的 AgentRun 建立 AbortController，并把同一 AbortSignal 传入 Harness invocation；取消会中止支持 signal 的在途工具，并阻止 Pi/LangGraph 后续节点继续执行，同时保证已写入 `cancelled` 的 Run 不再被晚到结果覆盖为 completed。
- **审批恢复保持后台执行。** approve 请求返回后，Host 在 microtask 中继续恢复执行；恢复运行同样登记 run-control，因此随后仍可 cancel。
- **本地 Provider 不透明搬运到 Host。** 当前没有把 Local Provider transcript / Provider identity 迁移成 Host Run 的稳定合同。需要持久执行时必须显式进入/创建 Remote Host 会话，由 Host 自己的 Provider / Tool 凭据执行；Mobile Local Provider API Key 永不转交给 Host，Host Tool / MCP 凭据也永不下发给 Mobile。
- Android / iOS + 真实 Provider / Host / 网络切换矩阵继续归 MOB-044，不在本卡重复造第二套真机验收。
