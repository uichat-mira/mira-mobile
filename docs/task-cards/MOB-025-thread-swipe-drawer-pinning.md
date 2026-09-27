# MOB-025：线程左滑操作与 Drawer 置顶分组修复

状态：**PASS**（2026-09-05 Android 真机 dogfood 验收通过；PR #83 已合入 `dev`，最终 CI / AI Review 已通过）

负责人：`mob_025_thread_swipe_drawer_pinning`

执行仓库：`dangjingtao/uichat-mira-mobile`

首次派卡基线：`dev @ a90dfb6c2d80079fd85084fff0214968e137e653`

## 2026-09-01 Reopen Evidence

产品负责人确认：MOB-025 的右滑问题已经至少三次宣称修复但真机仍失败。旧 `dev` 的 `SessionListScreen` 使用自定义 `PanResponder` 与行内 `Pressable` / `FlatList` 做 responder 竞争；此前 MOB-011 与 MOB-025 的修改均继续沿用同一路线，只调整 capture、阈值、速度与 settle 行为。

因此本卡重新打开，后续施工必须遵守：

- 不再把调整 `dx`、`vx`、capture 阈值或 spring 参数作为主修复方案；
- 优先替换脆弱的自定义 responder 手势层，采用经过 React Native 移动端验证的 swipe/gesture 方案；
- 若需要新增原生手势依赖，必须按 `AGENTS.md` 明确记录依赖理由、双平台影响与构建验证；
- **没有 Android 真机证据不得进入 PASS，也不得再写“有条件完成”来代替真实交互验收。**

## 2026-09-01 Reimplementation Evidence

PR #83（`fix/mob-025-native-swipe -> dev`）已经换掉旧手势机制，而不是继续调 `PanResponder` 参数，并以 squash commit `01fd9575c471b8003692b8f92f79b81440a0cfc3` 合入 `dev`：

- `SessionListScreen` 删除 Session row 的 `PanResponder`、capture、`dx` / `vx` 与 `Animated.Value` 手势实现；
- 新增 `SessionSwipeRow`，使用 React Native 原生横向 `ScrollView` 承担横向 reveal，外层 `FlatList` 继续承担纵向滚动；
- 未新增 native dependency，不修改 Pods / Gradle；
- 保持产品方向为**向左滑动，露出右侧「置顶 / 删除」操作区**；
- 保持单行打开、点击已打开行收起、纵向列表开始滚动时收起操作区；
- 保持 MOB-007 device-local pin、Host-authoritative delete、Drawer pinned 分组与原有导航合同不变；
- 44pt settle threshold 抽成纯函数并补单元测试；
- 自查发现父组件 rerender 可能打断 settle 动画后，已改为 callback ref，并同时处理 momentum scroll end；旧 head 上 Codex 指出的同一 P2 已在最终 head 前修复并关闭。

最终 PR head `ff84ea2d89f09e78dcf16c67995a20acc7870153` 的自动证据：

- `npm run typecheck`：通过；
- `npm run lint`：通过；
- Jest：通过；
- Android debug APK：构建并上传成功；
- iOS simulator app：构建并上传成功；
- unsigned iPhone app / IPA：构建、打包校验并上传成功；
- Mira Mobile OpenCode PR Review：`No high-confidence P0-P2 findings`。

自动门禁已足够支持从 DOING 进入 REVIEW，但仍**不能替代 Android 真机手势验收**。MOB-025 在产品负责人确认真机左滑、纵向滚动、点击、置顶 / 删除与持久化行为之前不得进入 PASS。

## 背景

MOB-007 已完成设备本地线程置顶，现有合同继续有效：置顶状态只保存在当前设备，不同步为 Host / Desktop 的账户级事实。

当前目标是把主线程列表左滑稳定性真正收口，同时保留已经成立的 Drawer 置顶分组、设备本地 pin 与 authoritative delete 语义。

这是一张 MOB-007 之后的交互回归 / 展示收口卡，不重开 MOB-007，也不改变其本地状态合同。

## 目标

1. 修复主线程列表左滑无法稳定呼出操作的问题。
2. 保留「置顶 / 取消置顶」「删除」能力，并把滑出操作区做成完整、精致的移动端交互，而不是两个生硬按钮。
3. Drawer 中把置顶线程独立为「置顶」分组，排在「最近」之前。
4. 取消置顶后线程回到普通最近列表；重启 App 后置顶状态仍按既有本地 store 恢复。

## Scope

### 主线程列表左滑

- 继续采用**向左滑动呼出右侧操作区**的产品方向。
- 修复手势竞争 / 命中 / 阈值 / 回弹问题，使 Android 真机上可以可靠打开和关闭操作区。
- 操作区包含：
  - 置顶线程：`取消置顶`；
  - 未置顶线程：`置顶`；
  - `删除`。
- 视觉使用现有 theme token / Lucide 体系，处理好：
  - 图标与文字层级；
  - 操作块宽度与间距；
  - 危险操作与普通操作的区分；
  - 滑动跟手、打开、回弹 / 收起动画。
- 不允许为了“能滑”破坏列表纵向滚动、点击进入会话或无障碍点击目标。

### 删除语义

- 删除仍调用现有 authoritative Host 删除能力，不创建本地假删除。
- 保留删除确认。
- 删除成功后继续清理对应本地 pin / read state。
- 失败时必须保持真实会话可见，并给出真实错误；不得仅从 UI 消失。

### Drawer 置顶分组

- `CustomDrawer` 的 Thread 区域改为：

```text
置顶
  pinned thread ...

最近
  normal thread ...
```

- `置顶` 只在存在置顶项时出现。
- 组内排序沿用 MOB-007 既有规则：同组按 Host `updatedAt` 稳定排序。
- **不得先 `slice(0, N)` 再找置顶**，否则较旧但仍被置顶的线程会从 Drawer 消失。先按 pin state 分组，再对普通 Recent 做展示上限；如需对 pinned 本身设上限，必须显式说明而不能由 Recent cap 隐式裁掉。
- 取消置顶后立即从置顶组移回 Recent。

## Hard Constraints

- 不改变 `threadId -> pinnedAt` 的设备本地语义。
- 不新增 Host / Remote API，不把 pin 同步到 Desktop。
- 不重新设计 Thread / Workspace 关系。
- 不顺手重构整个 Session list / Drawer。
- 删除仍是 Host authoritative side effect；不得用本地 state 假装成功。

## Must Read

- `AGENTS.md`
- `docs/work-ledger.md`
- `docs/task-cards/MOB-007-local-thread-pinning.md`
- `src/screens/SessionListScreen.tsx`
- `src/components/CustomDrawer.tsx`
- `src/store/threadPinStore.ts`
- `src/store/threadPinning.ts`
- `src/store/threadPinning.test.ts`

## Execution Entry Points

- `src/screens/SessionListScreen.tsx`
- `src/screens/SessionSwipeRow.tsx`
- `src/screens/sessionSwipe.ts` / `sessionSwipe.test.ts`
- `src/components/CustomDrawer.tsx`（仅保持既有分组合同，不因本轮 swipe 重写）
- `src/store/threadPinStore.ts`（仅在确有必要时）
- `src/store/threadPinning.ts` / tests（如排序行为需要补回归）

## Validation

自动化至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

并补足与本卡直接相关的行为测试。真机 / 模拟器 smoke 至少覆盖：

1. 未置顶线程左滑 -> 显示「置顶 / 删除」；
2. 置顶线程左滑 -> 显示「取消置顶 / 删除」；
3. 左滑打开后可收起，不阻塞纵向滚动和点击进入；
4. 删除确认 / 取消 / 成功 / 失败状态正确；
5. Drawer 中 pinned 独立成组并位于 Recent 上方；
6. 较旧 pinned thread 不因 Recent 展示上限消失；
7. 取消置顶后回到 Recent；
8. App 重启后 pin 状态仍正确。

若无法取得真机证据，必须明确写成 validation gap，不得伪造。

## Parallel / Integration

PR #83 已在与当时最新 `dev` 对齐后合入，没有覆盖 MOB-035 等并行台账改动。后续若真机验收再发现问题，从最新 `dev` 开新的 fix，不在已合并历史上追加未审查修复。

## Open / Unknown

当前唯一剩余未知项是：**新的 native horizontal ScrollView 方案是否在 Android 真机上稳定满足左滑、纵向滚动与点击三者共存。** 自动 CI 与平台构建不能关闭这个问题。

## Handoff

产品负责人在 Android 真机至少完成：左滑打开 / 收起、纵向滚动、点击进入、置顶 / 取消置顶、删除确认及一次重启后的 pin 持久化。通过后可把 MOB-025 从 REVIEW 更新为 PASS；任一核心路径失败则重新进入 DOING，并以真实复现为新修复基线。

## Acceptance Evidence — 2026-09-05

Android 真机 dogfood 验收全部通过，本卡标 PASS：

1. 未置顶线程左滑 -> 显示「置顶 / 删除」 ✅
2. 置顶线程左滑 -> 显示「取消置顶 / 删除」 ✅
3. 左滑打开后可收起，不阻塞纵向滚动和点击进入 ✅
4. 删除确认 / 取消 / 成功 / 失败状态正确（失败时会话保留并给出真实错误） ✅
5. Drawer 中 pinned 独立成组并位于 Recent 上方 ✅
6. 较旧 pinned thread 不因 Recent 展示上限消失 ✅
7. 取消置顶后回到 Recent ✅
8. App 重启后 pin 状态仍正确 ✅

Handoff 中要求的唯一未知项（native horizontal ScrollView 三者共存）已在真机上验证：左滑、纵向滚动与点击可稳定共存。
