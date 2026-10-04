# MOB-056C-F Remote 后台消息投递 — Architecture Decision Addendum V1

状态：Decision addendum（架构审查产物，非实现合同）
关联：Issue #213（本卡）、#208（MOB-056C）、#207（MOB-056B）、#168（MOB-057）
适用分支：`dev`
依据事实源：`uichat-mira/.github/AGENTS.md`（Policy revision `2026-09-16.2`，Constitution `v1.1`）、`mira-mobile/AGENTS.md`、`mira-desktop/AGENTS.md`、`mira-mobile/docs/remote-access/remote-connection-canonical-v1.md` 及以下列出的真实实现。
修订：Rev.2 — 收敛三处合同缺口：Q1 trust bootstrap 循环（§4.3/§4.7）、permission/channel 语义（§7.1/§7.4）、eligibility 无歧义状态转换（§6.1/§6.2）。未改变拓扑方向。
本文档为架构决策证据，不包含生产代码或运行时行为变更。

---

## 0. 审查范围与证据基线

本文不是新架构长文，而是对前案（#208 侦察结论 + #213 候选架构）的裁定。裁定前，跨端合同的每一条都回读了真实实现：

| 结论要点 | 证据位置 |
| --- | --- |
| `mira_device_*` 由 Host 铸造、Mobile 只存不生成、Host 本地权威校验，无中央 authority | [useRemotePairing.ts](../../src/pairing/useRemotePairing.ts)、[remoteMiraHost.ts](../../src/api/remoteMiraHost.ts)、[deviceCredentialStore.ts](../../src/security/deviceCredentialStore.ts) |
| Relay 严格 transport-only，只持久化 token 的 SHA-256，无离线队列，不能承载 outbox/push broker | [packages/remote-relay/src/index.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/packages/remote-relay/src/index.ts)、[relay-transport-v1.md](https://github.com/uichat-mira/mira-desktop/blob/dev/docs/remote-access/relay-transport-v1.md) |
| Relay 身份为 per-room TOFU，无账户系统、无 Host 目录；relayId 仅寻址 | [remote-relay-settings.repository.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/server/src/db/repositories/remote-relay-settings.repository.ts)、[relay-product-config-v1.md](https://github.com/uichat-mira/mira-desktop/blob/dev/docs/remote-access/relay-product-config-v1.md) |
| Host 侧 canonical assistant message 全程同一 `assistantMessageId`，placeholder 与最终回复是同一行 UPDATE | [chat.routes.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/server/src/routes/proxy-provider/chat.routes.ts)、[agent/index.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/server/src/agent/index.ts)、[resume.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/server/src/agent/resume.ts)、[thread.service.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/server/src/services/thread.service.ts) |
| Host 侧不存在任何 outbox / durable event / push / FCM / APNs 设施；只有请求内 SSE 与内存队列 | 全仓 grep 无命中；[provider-proxy.service/index.ts](https://github.com/uichat-mira/mira-desktop/blob/dev/server/src/services/provider-proxy.service/index.ts) |
| Mobile 通知基础（权限 + `mira_messages` channel + iOS UserNotifications + 测试通知）已落地，明确排除 FCM/APNs 与 AI 回复通知 | [MiraNotificationsModule.kt](../../android/app/src/main/java/io/tomz/mira/mobile/MiraNotificationsModule.kt)、[MiraNotifications.mm](../../ios/UIChatMira/MiraNotifications.mm)、[notificationSettings.ts](../../src/screens/notificationSettings.ts) |
| 已有的 canonical-message 到达边界（前台触感 observer）以 canonical id 去重、AppState gate、批次到达逐条计数 | [newAssistantMessageHaptics.ts](../../src/haptics/newAssistantMessageHaptics.ts) |
| 设备本地已读/未读以 canonical id 优先去重 | [threadReadState.ts](../../src/store/threadReadState.ts)、[threadReadStore.ts](../../src/store/threadReadStore.ts) |

> 说明：“前案”指 #208 的侦察结论与其派生文档。#213 正文与 #208 关联合计构成前案架构；本文逐条 ACCEPT / AMEND / REJECT。仓库中不存在名为 “MOB-056C-F proposal” 的独立文件——前案即上面的 Issue 组合，已按 Issue 事实源读取。

---

## 1. ACCEPT — 前案中予以冻结的部分

以下部分经过真实实现验证成立，直接冻结：

1. **顶层拓扑方向。** `Host canonical message → Host durable outbox → Mira-owned Push Broker → FCM/APNs → Mobile native → system notification` 成立，且不推翻。
   - 理由：Host 拥有 canonical message 事实（同一 id 的 upsert）；Relay 被证明不能承载 outbox（无 payload 持久化、无离线队列、TOFU 无账户）；因此 Push Broker 必须是独立于 Relay 的最小新服务。
2. **Relay 保持 transport-only，不承担 Push Broker。** 予以确认并要求把 Push Broker 明确写成 **非 Relay 扩展**。
   - 证据：Relay 只持久化 `host_token_hash` / `client_token_hash`，请求/响应正文从不落库，host 离线即 `HOST_OFFLINE` 不排队。
3. **APNs / FCM provider server credential 不下放 Host。** 冻结为硬约束。
   - 理由：Host 是用户自持的本地进程（Desktop），平台服务端密钥属 Mira 托管信任域，与 `mira_device_*` 的“本地 Host 校验”模型正交。
4. **canonical Assistant message（而非 run `completed`）是唯一业务事件事实。** 予以冻结。
   - 证据：同一 `assistantMessageId` 贯穿 `running`（“Agent 正在运行…”）到终态；`run.completed` 只是状态迁移，不是消息事实。
5. **消息语义在 Local / Remote 间一致。** 复用 #207 已冻结的“canonical message 到达边界”，通知资格 predicate 与之同源。
6. **v1 payload 最小化、默认无正文。** 冻结“无正文摘要”为默认；`mira_messages` channel 与 iOS UserNotifications 复用现有基础。
7. **点击通知的 v1 最低合同为“回到 Mira”。** 不为 v1 强行实现稳定 session deep-link。

---

## 2. AMEND — 需要修改的部分

1. **“Relay / Push broker” 合并表述必须拆分。** 前案把 “Relay/Push broker” 写成同一格槽位（见 #213 Context 与 Acceptance）。改为：Relay = 既有 transport；Push Broker = 新增 Mira-owned 服务，二者信任域、持久化责任、凭据均不同。
2. **Device token 注册路径改为 Mobile 直连 Broker。** 前案默认 `Mobile → Host(raw token) → Broker`；本文改为 `Mobile → (pairing-bound registration authorization) → Broker`，Host 仅收到不透明 installation/delivery capability。见 §4/Q2。
3. **“Mobile suppress 已读后晚到 push”从保证降级为 best-effort 声明。** 前案把它当合同写；本文按平台真实语义改为**明确不保证**，并给出可承诺集合。见 §6/Q4。
4. **Host outbox 的“原子耦合”必须收敛为“同事务写状态 + 幂等入队键”。** 前案未定义与 canonical 状态机的耦合点。本文冻结：outbox 行与 canonical `messages` UPDATE 在同一 Host 事务提交，幂等键 = `(installationId, canonicalMessageId, eligibilityEvent)`。见 §5/Q3。
5. **capability 的生成/批准主体必须显式化。** 前案未回答“谁批准”。本文冻结为“Mobile 端显式批准 + Broker 对已配对 mobile key 的 TOFU 绑定”。见 §3/Q1。

---

## 3. REJECT — 不能成立的假设

1. **REJECT：可以复用 Relay 的 per-room TOFU 来认证 Host→Broker push 授权。**
   - 反证：Relay TOFU 只绑定 room 的两个 token hash，不携带任何 Host 业务身份，也不证明该 Host 有权对某个 installation 发 push；且 Relay 无账户/目录，无法区分“同一 Host 的多个 installation”。
2. **REJECT：Host 可以自称 `installationId` 即可向 Broker 发 push。**
   - 反证：按 Constitution §4，权限必须由契约显式授予；自证 identity 等于无授权。Broker 必须持有独立于 Host 自述的绑定证据。
3. **REJECT：`mira_device_*` credential 可直接作为 Broker 的 push 授权凭据。**
   - 反证：该 credential 的信任域是**单个本地 Host**，其 scope 由 Host manifest 决定，Broker 无校验能力（无 Host 公钥/共享秘密）。跨信任域直接搬运违反 `AGENTS.md` §6“凭据不得混用或透明搬运”。
4. **REJECT：“用户已读后绝不出现晚到通知”可作为 v1 合同。**
   - 反证：FCM/APNs 为 best-effort，killed 态下 OS 可直接展示通知、Mobile 可能在展示前没有执行机会；provider/broker collapse 与 TTL/expiration 不等价于 exactly-once。任何“绝不”承诺都是假合同。
5. **REJECT：`run.completed` 可作为通知触发。**
   - 反证：终态 `completed` 可能对应 `waiting_user` / `blocked` 等非“回复完成”语义，且与 canonical message 事实解耦；#208/#213 均已排除。

---

## 4. Q1 — Host → Push Broker trust bootstrap（最终合同）

**目标问题：Broker 为什么相信这个 Host 有权给这个 installation 发 push？**

前提事实（已验证）：不存在中央 Host/account authority；`mira_device_*` 只在本地 Host 校验；Relay 无 Host 目录。

### 4.1 结论：v1 不需要中央 Host identity

Mira v1 **不引入中央 Host/account authority**。授权锚点放在**已配对的 Mobile installation 本身**，由 Broker 通过与 Mobile 的一次显式批准建立绑定。理由：Mobile 是 push 的实际接收方与 installation 的唯一持有者；Host 只是可信消息来源。这样 Broker 无需成为账户系统即可回答“这个 Host 能不能给这个 installation 发 push”。

### 4.2 组件与产物

| 角色 | 生成 | 批准 | 持有 |
| --- | --- | --- | --- |
| **Host** | 生成 `hostId` 与 host 签名 keypair（配对期）；生成 `bindingDescriptor`（含 `hostPublicKey` + binding nonce + `sourceScope` 候选），经**已认证 Host 连接**交给 Mobile | 无批准权，也不向 Broker 自证 | host 签名私钥、`hostId`、`hostPublicKey` |
| **Mobile** | 生成 installation identity key（配对时生成，存安全存储） | **唯一批准主体**：对“该 Host key 可向本 installation 发 push”做一次显式签名批准 | installation 私钥、已批准的 `(hostId, hostPublicKey)` 绑定记录 |
| **Broker** | 生成 installation 注册记录、`deliveryToken`（Host 侧不透明凭据） | 无批准权，仅执行 Mobile 批准结果 | `installationId ↔ provider token ↔ authorized (hostId, hostPublicKey) 集合`、`deliveryToken` 的 hash |
| **Relay** | — | — | 不参与本流程 |

### 4.3 capability 生成 / 批准 / 绑定流程

> 核心修正（消除循环）：**Broker 不声称能独立验证一个“未经 Mobile 授权的 Host 背书”。** Broker 只把 **Mobile 的显式批准**当作 Host→installation 投递权的唯一来源。因此 `hostId` + `hostPublicKey` 的证据不由 Host 直连 Broker 提交，而是**经现有已认证的 Host 连接**带给 Mobile，再由 Mobile 签名交给 Broker。

1. **配对期**：Mobile 与 Host 完成既有配对（`mira_device_*`）。Mobile 生成 installation identity keypair，并把**公钥**交给 Broker（见 §5 注册路径）。此 key 只用于 Broker 绑定，不复用 `mira_device_*`。
2. **Broker 注册 installation**：Broker 记录 `installationId` + Mobile 公钥 + provider token，状态 `registered`，authorized host 集合**为空**。**此步只建立 installation，不建立任何 Host 授权**——Mobile 无需任何 Host 背书即可完成。
3. **Mobile 经既有 Host 连接取得 Host 凭据**：Mobile 通过**已认证的现有 Host 连接**（`mira_device_*` bearer，见 `remote-connection-canonical-v1.md`）向 Host 请求绑定描述符，Host 返回：
   - `hostId`（Host 稳定标识，配对期由 Host 生成并持久化）；
   - `hostPublicKey`（Host 签名公钥，配对期生成，见 §4.7）；
   - `bindingDescriptor`（含 `hostId` + `installationId` + `sourceScope` 候选 + **binding nonce**，由 Host 在本次连接内生成，一次性、带短 TTL）；
   - Host 对 `bindingDescriptor || nonce` 的签名。
   此步复用既有已认证通道，**Host 不直接向 Broker 自证**；证据先到 Mobile。
4. **Mobile 显式批准**：Mobile 校验：① `hostId` 是本人当前已配对 Host；② `bindingDescriptor` 的 signature 由 `hostPublicKey` 验证通过；③ `sourceScope` 属于本人可访问会话；④ nonce 未被使用且未过期。然后 Mobile 以 installation 私钥签名 `approve(hostId, hostPublicKey, installationId, sourceScope, nonce)`。**这是唯一授权动作，也是 Broker 认可的唯一 Host 授权来源。**
5. **Broker 建立绑定**：Mobile 把 `hostId` + `hostPublicKey` + 上一步签名提交 Broker（`POST /hosts/approve-binding`）。Broker 仅验证 **Mobile installation 签名**，将 `(hostId, hostPublicKey)` 加入该 `installationId` 的 authorized 集合，签发 `deliveryToken`（不透明、installation-scoped、host-scoped），经 Mobile 转交 Host（或 Host 凭 deliveryToken 领取）。**Broker 不单独验证 Host 对 Broker 的自证。**
6. **后续投递**：Host 用 `deliveryToken` 向 Broker 提交 canonical message 事件，并附 **Host 用 `hostPublicKey` 对应私钥**对事件的签名。Broker 校验：`deliveryToken` 有效 ∧ `hostId ∈ authorized(installationId)` ∧ 事件签名与已绑定 `hostPublicKey` 匹配 ∧ `eventId` 未重复，然后触发 FCM/APNs。
   - 投递时 Host 的签名**只是防冒充/防重放**（证明是已绑定的那把 key），**不是授权来源**；授权来自步骤 4 的 Mobile 批准。

### 4.4 capability 如何绑定 sourceId / installationId

- **绑定 installationId**：绑定由 Mobile 以 installation key 签名确认；Broker 只接受**被签名覆盖的 installationId**，Host 自述的 installationId 仅在编号上与签名一致时才有效。
- **绑定 sourceId**：Host 的 `deliveryCapabilityRequest` 携带 `sourceId`；Mobile 批准时把 `sourceScope` 写进签名（可为单会话或多个会话 allowlist）。Broker 校验投递事件的 `sourceId ∈ sourceScope`，越界即拒绝。这样“这个 Host 只能就这些会话来源给这个 installation 发 push”。

### 4.5 rotation / revoke / replay / abuse boundary

| 维度 | v1 合同 |
| --- | --- |
| **Rotation (provider token)** | provider token 由 Mobile 直连 Broker 更新（token refresh 是 Mobile 侧事件）；Broker 覆盖旧 token，`deliveryToken` 不变。 |
| **Rotation (installation key)** | 重装 / 重新配对时生成新 installation key；旧绑定与旧 `deliveryToken` 作废，Host 需重新申请绑定。 |
| **Rotation (hostPublicKey)** | 见 §4.7：重新经已认证连接 → Mobile 批准 → Broker 替换绑定 key，作废旧 key。 |
| **Revoke (Mobile 侧)** | Mobile 可单方面撤销某个 `(hostId, hostPublicKey)` 绑定（remove from authorized set）或整体撤销 installation；Broker 立即停止投递，作废相关 `deliveryToken`。 |
| **Revoke (Host 侧)** | Host 可注销其 `hostId`；不影响 installation，仅移除该 Host 的投递能力与绑定。 |
| **Revoke (解绑/登出)** | 解除配对时，Mobile 撤销该 Host 绑定；`mira_device_*` 失效与 Broker 绑定撤销是**两个独立动作**，都需发生（见 §8 失败矩阵）。 |
| **Replay** | 幂等键 `(installationId, eventId)`；Broker 对已投递 `eventId` 直接去重丢弃。`deliveryToken` 不携带可重放的消息内容，重放仅能触发已去重的事件。 |
| **Abuse boundary** | ① Broker 只接受 `hostId ∈ authorized(installationId)`；② 投递事件必须通过 `sourceScope` 校验；③ 每 installation 设投递速率与未确认事件上限；④ v1 payload 无正文，降低泄露面；⑤ 未获批准的 Host 只能发起绑定请求，**不能投递**。 |

### 4.6 是否真的需要中央 Host identity

不需要。v1 用“Mobile 显式批准 + Broker 对 installation key 的绑定”替代中央 authority。代价是：Host 首次绑定需一次 Mobile 端批准（一次交互）；收益是零新账户系统、与 Relay 现行 TOFU/无账户模型一致、且不把平台密钥或 Host 凭据跨域搬运。

### 4.7 Host 公钥首次绑定 / rotation / revoke

- **首次绑定**：`hostPublicKey` 在配对期由 Host 生成并持久化。它**不直接提交给 Broker**；而是经已认证 Host 连接随 `bindingDescriptor` 交给 Mobile，由 Mobile 在 §4.3 步骤 4 的批准签名中一并覆盖 `hostPublicKey`。Broker 在步骤 5 首次见到并把 `(hostId, hostPublicKey)` 写入该 installation 的 authorized 集合。因此 **Host 公钥的首次绑定 = Mobile 对它的首次批准**，Broker 从不需要独立信任一个 Host 自述的 key。
- **Rotation (hostPublicKey)**：Host 轮换 key 时生成新 `hostPublicKey`，重新走 §4.3 步骤 3–5（经已认证连接 → Mobile 批准 → Broker 更新绑定）。Broker 把绑定中的 `hostPublicKey` **替换**为新 key 并作废旧 key；旧 key 签名的投递事件在替换后一律拒绝。轮换不改变 `hostId`，也不改变 installation 的绑定关系。
- **Revoke (hostPublicKey)**：Mobile 可单方面撤销某 `(hostId, hostPublicKey)` 绑定；Broker 移除该绑定并作废对应 `deliveryToken`。Host 也可主动注销 `hostId`（§4.5）。
- **无 Mobile 批准即无绑定**：任何未被 Mobile 签名覆盖的 `hostPublicKey` 永远不会进入 authorized 集合；Broker 对未绑定 Host 的投递事件一律拒绝。

---

## 5. Q2 — Push token registration path（最终合同）

### 5.1 裁定：采用“Mobile 直连 Broker 注册”

冻结为：**Mobile 获得 pairing-bound registration authorization 后，直接向 Broker 注册 provider token；Host 只收到不透明的 installation/delivery capability。**

理由（对齐 `AGENTS.md` §6 最小暴露面）：
- Host 不应无必要看到或保存 raw provider token。前案 `Mobile → Host(raw) → Broker` 会让 Host（用户自持的本地进程）暂存平台 token，扩大泄露面且无业务价值。
- Broker 的绑定主体是 installation 与 Mobile 签名，天然由 Mobile 直连完成，无需 Host 中转。

### 5.2 流程

1. Mobile 向系统获取 raw APNs/FCM token。
2. Mobile 以 installation identity key + pairing-bound registration authorization（配对期由 Host 背书、Broker 可验的最小凭据）向 Broker `POST /installations/register`。
3. Broker 建立 `installationId ↔ provider token ↔ Mobile 公钥`，返回 installation 回执。
4. Mobile 把 `installationId`（及不含 provider token 的投递能力引用）交给 Host，供 Host 生成 `deliveryCapabilityRequest`。
5. Host **永不接触** raw provider token。

### 5.3 Host 看到的与看不到的

| Host 可见 | Host 不可见 |
| --- | --- |
| `installationId`、`deliveryToken`（不透明）、投递能力是否存在/有效 | raw APNs token、raw FCM token、Mobile installation 私钥、Broker 平台服务端密钥 |

### 5.4 最小 v1 register 合同（字段级）

`POST /installations/register`（Broker）
- 请求：`installationId`（Mobile 生成）、`platform`（`ios`/`android`）、`providerToken`（raw）、`installationPublicKey`、`pairingRegistrationProof`（配对绑定背书）、`schemaVersion`。
- 响应：`installationId`、`status`、`registeredAt`。
- 认证：Mobile installation 签名；不接受 Host 代签。

`POST /hosts/approve-binding`（Broker，**Mobile 调用**——唯一授权入口）
- 请求：`hostId`、`hostPublicKey`、`installationId`、`sourceScope`、`bindingNonce`、`installationSignature`。
- 响应：`status: authorized`、`deliveryToken`（经 Mobile 转交 Host，Mobile 不长期持有）。
- 说明：`hostId` / `hostPublicKey` / `bindingDescriptor` 由 Host 经**已认证的现有 Host 连接**提供给 Mobile（§4.3 步骤 3），Mobile 再提交 Broker。**Host 不直接向 Broker 发起绑定请求。**
- 认证：仅接受 Mobile installation 签名；Broker 不验证独立的 Host 自证。

> 上述为合同级字段，最终 endpoint 命名以实现卡为准；本卡只冻结语义、方向与信任边界。

---

## 6. Q3 — Canonical Assistant notification eligibility（最终合同）

### 6.1 精确事件语义（无歧义状态转换）

**notification-eligible 定义为一次状态转换（transition），不是一次消息快照。**

设某 `canonicalMessageId` 在 Host 侧观测到的前后两个状态为 `previous` → `next`。eligible 当且仅当：

```text
eligible(previous, next) :=
     next.role == "assistant"
  && next.id == previous?.id                      // 同一 canonical id（若无 previous，视为出现）
  && isUserVisibleFinal(next)                     // 用户可见的终态 Assistant 内容
  && ( previous == ABSENT                          // 路径 A：absent -> final
       || isPlaceholderOrRunning(previous) )       // 路径 B：placeholder/running -> final
```

两条合法的首次转换路径：

- **路径 A：`absent → user-visible final canonical Assistant message`**（ordinary Chat / RAG：消息一次性写入终态）。
- **路径 B：`placeholder/running → user-visible final canonical Assistant message`**（Agent / resume：先写占位，再 UPDATE 为终态）。

冻结规则：

1. **仅首次 transition eligible。** 该 canonicalMessageId 的这**一次**转换产生至多一个通知事件。
2. **canonicalMessageId 做幂等。** 幂等键含 `canonicalMessageId`；同一 id 的后续任何变化都不再 eligible。
3. **refresh / update 不重复。** 终态之后的重读、快照刷新、execution-node 追加、resume 后的再次落库，均**不**产生新事件。
4. **`run.completed` 永不直接触发。** 触发源是 canonical message 的可见终态转换，不是 run 状态迁移。终态 `completed` 若没有 canonical message 的可见终态转换，则不触发；反之，路径 A 的 ordinary Chat 即便没有 run，也触发。
5. **`waiting_approval`（“等待审批”）不 eligible**（需要用户动作，不属于“AI 回信”类结果，v1 不通知）。
6. `isUserVisibleFinal` 排除纯占位文案（`"Agent 正在运行…"`、`"等待审批"`）和纯 execution-node 中间态。

### 6.2 单一 predicate 覆盖 ordinary Chat / RAG / Agent / resume

上述 `eligible(previous, next)` 是**唯一 predicate**，输入是同一 canonicalMessageId 的前后状态，不区分路径：

- **ordinary Chat / RAG（无 agent）**：`previous == ABSENT`，`next` 为终态 → 路径 A，eligible 恰好一次。
- **Agent 路径**：`previous` 为 placeholder/running，`next` 为终态 → 路径 B，eligible 恰好一次。
- **resume（审批后继续）**：resume 走同一 `persistAgentAssistantState`；若批准前尚未产生终态，则终态出现时按路径 B 判一次；若已是终态则不满足 `isPlaceholderOrRunning(previous)`，不重复。
- **refresh / update**：`previous` 已是终态 → `isPlaceholderOrRunning(previous)` 为假 → 不 eligible。
- **Local Provider**：Mobile 侧对应边界复用 #207 observer 语义；Host 侧 predicate 仅作用于 Remote 路径。

### 6.3 outbox 与 canonical state 的原子耦合

- Host 在**同一 SQLite 事务**内：更新 canonical `messages` 行（既有 upsert-by-id）**并**向 `notification_outbox` 插入一行（若 `eligible(previous, next)` 成立）。二者要么同时提交，要么同时回滚。
- outbox 行幂等键：**`(installationId, canonicalMessageId, eligibilityEvent)`**，其中 `eligibilityEvent` v1 固定为 `final_transition_first_seen`。
- 唯一约束保证：同一 canonicalMessageId 对同一 installation **最多产生一次** notification event。
- outbox 投递成功后标记 `delivered`；Broker 侧再做 `(installationId, eventId)` 去重，形成双端去重。

### 6.4 “同一 canonicalMessageId 最多一次 / installation” 的落地

- Host outbox 唯一约束（写入侧）。
- Broker `(installationId, eventId)` 去重（投递侧）。
- Mobile 侧沿用 canonical id 去重（展示侧 best-effort，见 §7）。
三者叠加保证“每 canonicalMessageId、每 installation 至多一次通知事件”。

---

## 7. Q4 — 真实 Push delivery UX semantics（最终合同）

### 7.1 Android FCM / iOS APNs 的真实系统语义

- **v1 通道选择：user-visible alert notification。** Mira v1 使用**普通、用户可见的 alert notification**（generic 标题“Mira 有新回复”，**不含 Assistant 正文**），**不依赖 silent push** 来保证 killed/background 投递。
  - 理由：silent/data push 在 iOS 受节流、在 Android 受 OEM 省电策略影响，均**不可靠**，不能作为“后台/被杀后仍能送达”的保证手段。alert notification 由 OS 直接展示，才是 killed/background 下唯一有实际可达性的形态。
  - 因此 v1 的 best-effort suppress 只在**应用能够执行**时生效（见 §7.3），不与 alert 形态冲突。
- **background / killed**：user-visible notification **可能由 OS 直接展示**，Mobile 进程可能**没有机会在展示前执行任何 JS/持久化读取**。
- **provider 接受 ≠ OS 展示**：见 §7.4。
- **provider / broker collapse、TTL / expiration ≠ exactly-once**：可能重复、可能丢失、可能延迟到过期。
- iOS 对 silent push 有节流与不可靠投递；Android 各 OEM 对后台与省电策略差异大。
- 因此：“已读后绝不出现晚到通知”**跨 Android/iOS 无法保证**。

### 7.2 Mira v1 可承诺什么

**可以承诺：**

1. **at-least-once delivery attempt**：每个 eligible canonicalMessageId 至少发起一次投递尝试。
2. **强去重（broker/event 级）**：Host outbox 唯一约束 + Broker `(installationId, eventId)` 去重，保证**至多一次**生成投递事件。
3. **bounded TTL**：投递事件带明确过期时间，过期即丢弃，不无限重试。
4. **前台不弹系统通知**：App active 时由前台触感（#207）负责，不发系统通知。
5. **Mobile 端 best-effort suppress**：App 在前台/刚回前台并能执行时，若该 canonicalMessageId 已在设备本地被标记已读，则抑制展示（`threadReadState` 的 canonical id 去重可复用）。

**明确不承诺（写入合同，避免假保证）：**

1. **不承诺“已读后绝不出现晚到通知”**——killed/background 态可能由 OS 先展示，且无跨端 exactly-once。
2. **不承诺投递时序**、不承诺不重复由系统层造成的重复展示（broker 去重只保证事件生成一次，不控制 OS 展示）。
3. **不承诺 iOS silent/background 的时效**；不承诺所有 OEM 下行为一致。
4. **不承诺跨设备同步已读**（沿用 MOB-008：设备本地状态）。

### 7.3 suppress 的正确表述

> Mira v1 采用 **at-least-once delivery attempt + 强 broker/event 去重 + bounded TTL**。Mobile 在能够执行时对已读消息做 best-effort 抑制。**不保证**“已读后绝不出现晚到通知”。

### 7.4 权限 / channel 关闭时行为（修正）

关键修正：**provider 接受消息 ≠ OS 一定展示；且权限 / channel 关闭通常无法由 Broker 从 provider success/failure 得知。**

- FCM/APNs 的 “accepted/success” 只表示消息被 provider **接收并尝试投递**，不代表 OS 一定展示。用户关闭 Mira 通知权限、关闭 `mira_messages` channel、或开启系统免打扰时，**OS 直接抑制展示**；provider 仍可能返回成功，Broker 无法据此判断“没展示”。
- 因此冻结为：
  1. **OS 抑制展示**：permission/channel off 或 DND 时，由 OS 抑制展示。这是**展示层语义，不是投递失败**。
  2. **Broker 不因“未展示”重试**：Broker 无法（也不应尝试）观测 OS 是否展示；因此**不基于展示结果做任何重试判定**。
  3. **只有 provider transport failure 才进入 bounded retry/TTL**：当 FCM/APNs 明确返回传输/凭据层失败（如 token 失效、provider 拒绝、网络/服务错误）时，Broker 按 bounded retry + TTL 处理；超 TTL 丢弃。不忙循环、不崩溃。
- Mobile 读取真实系统状态（既有 `getPermissionStatus`：POST_NOTIFICATIONS ∧ master ∧ channel importance ≠ NONE）仅用于**应用内状态展示与前台 gate**，不作为 Broker 的投递依据。
- 点击通知的最低合同：回到 Mira（沿用 #168 已落地行为）。

---

## 8. 最终冻结的四项合同摘要

| 问题 | 冻结结论 |
| --- | --- |
| **Topology** | `Host canonical message → Host durable outbox → Mira-owned Push Broker（新服务，非 Relay） → FCM/APNs → Mobile native → system notification`。Relay 保持 transport-only。 |
| **Identity** | 无中央 Host/account authority。授权唯一来源 = 已配对 Mobile 对 `(hostId, hostPublicKey, sourceScope, nonce)` 的显式签名批准；`hostId`/`hostPublicKey` 经既有已认证 Host 连接交给 Mobile，Host 不向 Broker 自证。Broker 仅执行 Mobile 批准，Host 持不透明 `deliveryToken`。 |
| **Registration** | Mobile 直连 Broker 注册 raw provider token；Host 只收不透明 installation/delivery capability，永不接触 raw token。 |
| **Delivery semantics** | user-visible alert notification（generic，无正文），不依赖 silent push；at-least-once attempt + 强 broker/event 去重 + bounded TTL；provider 接受 ≠ OS 展示；OS 抑制展示不算失败，Broker 不因此重试；仅 provider transport failure 进入 bounded retry/TTL；已读后晚到 = **不保证**；前台不弹系统通知。 |
| **Event semantics** | 唯一 predicate = 状态转换 `eligible(previous, next)`：`absent → user-visible final`（路径 A）或 `placeholder/running → user-visible final`（路径 B）；仅首次转换 eligible，canonicalMessageId 做幂等，refresh/update 不重复，`run.completed` 永不直接触发；Host 同事务写 canonical + outbox；幂等键 `(installationId, canonicalMessageId, eligibilityEvent)`。 |

---

## 9. 失败矩阵（v1）

| 场景 | 行为 |
| --- | --- |
| Host 离线（产生消息时） | 消息仍落 canonical + outbox；Host 恢复后 outbox 重试投递（有 TTL）。 |
| Broker 失败 | Host outbox 重试；超 TTL 丢弃。 |
| provider token 失效 | Broker 收到 provider transport failure，按 bounded retry + TTL 处理，超时丢弃；等待 Mobile refresh；不忙循环。 |
| 重复事件 | Broker `(installationId, eventId)` 去重；Host outbox 唯一约束兜底。 |
| 消息已删除 | 通知仍可按已生成事件投递或按 TTL 丢弃；点击回到 Mira 时以 canonical 现状为准（v1 不保证深链）。 |
| 解除配对 / 撤销 | Mobile 撤销 Broker 绑定（立即停止投递）**且** 使 `mira_device_*` 失效——两个独立动作都必须发生。 |
| 权限/channel 关闭 或 系统免打扰 | 由 **OS 抑制展示**；Broker 无法从 provider success/failure 得知，**不因此重试**；不崩溃、不忙循环。 |
| provider 明确 transport failure | 唯一进入 bounded retry + TTL 的情形；超 TTL 丢弃。 |
| OS 在 killed 态直接展示 | 接受；属平台 best-effort，不承诺抑制。 |

---

## 10. Ownership 与实现切片建议

**Ownership：**

| 层 | 拥有 |
| --- | --- |
| Host（mira-desktop） | canonical message 事实、outbox 写入与事务耦合、eligibility predicate、`hostId`、投递重试与 TTL。 |
| Push Broker（新 Mira-owned 服务） | installation 注册、绑定批准执行、`deliveryToken`、provider token 托管、FCM/APNs 调用、broker 级去重、平台服务端密钥。 |
| Relay（mira-desktop/packages/remote-relay） | 仅既有 transport；**不**参与 push。 |
| Mobile（mira-mobile） | 获取 provider token、直连 Broker 注册、installation key、显式批准、AppState gate、本地已读 best-effort 抑制、通知展示接线。 |

**切片建议（各自可独立验收）：**

1. **Broker 最小服务 + installation register + Mobile 直连注册**（Mobile↔Broker，Host 不参与）。
2. **Host 绑定流程**（request-binding + Mobile approve + deliveryToken 签发）。
3. **Host outbox + eligibility predicate + 事务耦合**（Host 侧，可用单测证明原子性与幂等键）。
4. **Broker → FCM/APNs 投递 + 平台凭据托管 + 去重/TTL**。
5. **Mobile 接收/展示接线 + 权限 gate + best-effort suppress + 点击回 Mira**（#208 在此层承接 presentation/policy）。
6. **失败矩阵 smoke（release candidate 一次性）**。

每个切片都以“合同级证据”验收，不以代码/PR 数量验收。

---

## 11. #208 的定位

在上述基础设施切片 1–5 落地前，#208 **保持 open / blocked**，不得降级为瞬态 JS 或测试通知近似。基础设施到位后，#208 只承担 **Mobile presentation / policy** 工作（接收接线、权限 gate、best-effort suppress、点击回 Mira），不承载对 Host/Broker 合同的重新定义。

---

## 12. 结论与阻塞

**#213 是否具备关闭条件：** 是。本文已冻结四项问题的最终合同、最终 topology / identity / registration / delivery semantics，以及 ownership 与切片。

**唯一剩余 blocker：** 无。四项问题均已有可实施、可验证的冻结结论；实现拆卡由维护者决定，不属于本卡阻塞项。

**设计复杂度判断：** `CONTINUE_WITH_CURRENT_AGENT`。前案方向成立，本轮仅在信任锚、注册路径、事件 predicate、投递保证四处收敛；Rev.2 进一步消除 Q1 循环并修正 permission/channel 与 eligibility 语义；未引入需要更强代理的新问题域。

**已作出的关键架构决定：**
- Q1：Mobile installation key 直连 Broker 建立 installation（无需 Host 背书）；Host 的 `hostId`/`hostPublicKey` 经既有已认证 Host 连接交给 Mobile；Mobile 以 installation key 显式签名批准该 Host key，Broker 以此作为唯一 Host→installation 投递授权来源；不引入中央 Host identity，Host 不向 Broker 自证。
- Q2：采用“Mobile 直连 Broker 注册”，Host 永不接触 raw provider token。
- Q3：eligibility = 无歧义状态转换；`run.completed` 永不直接触发。
- Q4：user-visible alert notification（无正文），不依赖 silent push；provider 接受 ≠ OS 展示；仅 provider transport failure 进入 bounded retry/TTL。

DESIGN_FROZEN
