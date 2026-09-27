# MOB-031：拾言录音确认页主次交互收口

状态：**通过（PASS）**（PR #87 已合入 `dev`；产品负责人于 2026-09-03 完成视觉与真机验收：Acceptance 第 1–10 项全部通过，第 11 项 MOB-029 行为回归保护确认通过）

负责人：`mob_031_shiyan_confirm_hierarchy`

执行仓库：`dangjingtao/uichat-mira-mobile`

施工基线：从施工时最新 `dev` 创建独立 feature 分支；本卡首次派发基于 2026-09-01 当前 `dev`。

## 背景

现有确认页已经具备小播放器、标题编辑、场景 Action Sheet、提交、本地保留和删除能力。烟测通过后，剩余问题主要是主次关系仍偏重：用户刚结束录音，真正必须做的只有“确认标题 / 场景并开始处理”；保存、删除、配置等低频能力不应与主动作争夺注意力。

本卡不重做 MOB-029，不改变播放器、Scene snapshot、LocalCapture 或提交合同，只收口交互层级。

## Goal

把确认页从“完整操作面板”收成“轻确认页”：

- 顶部轻量播放器用于快速试听；
- 标题与当前场景清晰可改；
- `开始整理` / `提交并开始处理` 是唯一主按钮；
- 本地保留、删除等能力仍存在，但降到次级入口；
- 返回行为必须安全，不要求用户额外理解保存机制。

## Must Read

- `AGENTS.md`
- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/task-cards/MOB-017-shiyan-recording-local-recovery.md`
- `docs/task-cards/MOB-029-shiyan-confirmation-ux.md`
- `src/shiyan/ShiyanCaptureSubmitScreen.tsx`
- `src/shiyan/playback/PlaybackAdapter.ts`
- `src/shiyan/recording/localCaptureRepository.ts`
- `src/shiyan/confirmation/sceneConfirmation.ts`
- `src/theme/tokens.ts`

如交互与 PRD 冲突，以 PRD 为准；如涉及保存、恢复或 task 创建时机，以 TECHNICAL_DESIGN 为准。

## Verified Context

- 用户结束录音后，本地文件已可靠保存；确认页不是“是否保存录音”的第一次机会。
- 只有用户明确提交后才创建云端 CaptureTask。
- MOB-029 已定义并实现确认页播放器与场景 bottom sheet 基础模式；本卡不得复制第二套 playback / scene state machine。

## Design Reference

![MOB-031 Audio Player design](./assets/MOB-031-audio-player-design.webp)

这张图是 MOB-031 的确认页与 Audio Player 视觉 / 交互参考，表达信息层级、播放器状态与可复用方式；它不是新的颜色、圆角、字号或 spacing 真相源，最终视觉仍必须使用现有 `src/theme/` Design Token。

本轮 UI 审查新增明确决策：**播放器必须成为独立、可复用组件，而不是继续作为 `ShiyanCaptureSubmitScreen` 内部的一段页面实现。** 确认页只是它的第一个消费方；历史记录或任务详情需要回听音频时应能够复用同一组件，而不是复制另一套 seek / playback UI。

## Interaction Contract

### A. 页面主层级

推荐顺序：

```text
确认并提交

[ mini player ]

标题
[ ... ]

场景
会议采集                                      >

[ 开始整理 ]   // 唯一 Primary CTA

次级入口 / 更多
```

具体文案可在不改变语义前提下使用 `开始整理` 或现有 `提交并开始处理`；同一页面不得同时存在两个等权主按钮。

### B. Audio Player / Mini Player

- 播放器实现为独立、可复用的 Audio Player 组件；组件名可按当前代码约定确定，但组件边界必须独立于确认页。
- 组件只负责音频播放语义：加载、播放 / 暂停、当前时间、总时长、seek、播放完成与 dispose；不得依赖 `CaptureTask`、Cloud、确认页提交状态或其它拾言业务概念。
- 页面负责提供 audio source 与必要的展示 metadata；页面不得自行再实现第二套进度条或 seek 状态机。
- 保留播放 / 暂停、当前时间 / 总时长、seek。
- **完整轨道必须始终存在。** `progress` 只能控制 played fill / thumb 位置，不能控制整个 slider / track 容器宽度。
- `0%`、播放中、播放完成、拖拽 seek 时都必须保留完整的 inactive track 和完整可触摸 seek 区域；不得再出现 `0:00` 时只剩半个 thumb、播放几秒后只显示一小截轨道的情况。
- 文件大小、已安全保存等信息降为辅助信息，不得超过标题 / 场景 / 主 CTA 的视觉权重。
- 播放失败只影响试听，不得把录音标成损坏。
- 页面离开和删除前继续按既有 playback contract dispose；若组件内部承接 dispose 生命周期，必须保证不会与现有 `PlaybackAdapter` 形成第二套资源管理协议。

### C. 场景

- 确认页只回显当前场景：`场景  会议采集  >`。
- 不在确认页平铺选项，不显示误导性的 radio + chevron 双语义。
- 点击整行打开现有 cross-platform Bottom Sheet / Action Sheet。
- Sheet 当前项显示 check；选择即更新并关闭，无额外确认按钮。

### D. 主提交动作

- 页面唯一 Primary CTA 负责：本地确认标题 / scene snapshot -> 创建 CaptureTask -> 上传 / 进入异步处理。
- 点击后保留现有真实进度与错误恢复语义。
- 创建任务、同步场景、确认录音等内部技术阶段不作为主文案逐条暴露；用户可见进度优先归纳为 `正在提交` / `正在上传` / `已进入整理` 等产品语言。
- 若实现层仍需要细粒度 progress phase，保留在代码中，不需要删除。

### E. 返回 / 稍后处理

- 用户点击系统返回 / 顶部返回时，不得删除已完成本地录音。
- 返回后该 LocalCapture 仍可从统一记录或现有本地恢复入口找到。
- **能力必须保留，但不要求一个与主 CTA 等权的“大号稍后提交按钮”。**
- 若现有产品合同要求显式“先保存在本机，稍后提交”入口，可将其降为 text button / secondary row / `···` 菜单项；不得移除该语义。
- 未保存的标题 / scene 编辑如何落盘必须沿用已有 `localCaptureRepository.confirm()` / recovery 语义；不要新造自动保存协议。

### F. 删除

- `删除本地录音` 属于 destructive low-frequency action。
- 不与主 CTA 同一区域争夺视觉权重；优先放页面底部弱入口或 `···` Action Sheet。
- 点击后必须二次确认，文案说明删除本地文件不可恢复。
- 若已有 cloud task，不能把删除本地文件伪装成删除云端 Task。

### G. 配置

- 确认页不新增长期 Cloud Settings 主入口。
- Cloud 未配置等错误可以提供一次性可操作跳转，但 canonical 配置入口仍在拾言主页 / 既有配置路径。

## Hard Constraints

- PRD 不改。
- 不删除“稍后处理 / 本地恢复”能力，只能改变它的呈现层级。
- 不修改 CaptureTask 创建时机。
- 不修改 Scene snapshot 冻结规则。
- 不重写 PlaybackAdapter / RecordingAdapter。
- **不得把播放器继续写成确认页私有 UI；必须形成独立可复用组件。**
- 不新增音频编辑、倍速、波形剪辑等能力。
- 视觉必须使用当前 Design Token。

## Execution Entry Points

- `src/shiyan/ShiyanCaptureSubmitScreen.tsx`
- `src/shiyan/playback/`（新增/整理独立 Audio Player 组件的优先位置；具体文件名按现有结构确定）
- `src/shiyan/recording/localCaptureRepository.ts`
- `src/shiyan/confirmation/sceneConfirmation.ts`
- `src/shiyan/playback/PlaybackAdapter.ts`（原则上复用现有能力，不重写 adapter）

## Acceptance

1. 页面只有一个视觉 Primary CTA。
2. Audio Player 已形成独立组件，组件自身不依赖 `CaptureTask` / Cloud / 提交页业务状态；确认页只消费其公开 props / callbacks。
3. `0%`、播放中、播放完成、拖拽 seek 四种状态均显示完整轨道；played fill 只表示播放比例，不改变轨道总宽度。
4. seek 的可触摸区域覆盖完整轨道，用户可以从 `0:00` 直接拖到尚未播放的位置。
5. 当前场景以整行值 + chevron 回显；选项只在 Sheet 内出现。
6. 用户返回后录音仍可恢复，不要求重新录音。
7. 显式“稍后处理”能力若保留按钮，视觉等级低于主 CTA。
8. 删除动作降级且必须二次确认。
9. 技术进度不再用“创建任务 / 同步场景 / 确认录音”占据主要产品文案。
10. 提交失败仍明确告诉用户本地录音安全、可重试。
11. MOB-029 已有 playback / scene 行为不回归；本卡只把播放器 UI 与生命周期边界收成可复用组件。

## Validation

至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

测试 / smoke 至少覆盖：

- 独立 Audio Player 在无拾言业务上下文时可渲染；
- `0%` / playing / completed / seek-drag 的完整轨道与时间映射；
- 从未播放位置直接 seek 到中后段；
- 播放 / pause / seek / dispose 不回归；
- 场景切换与 scene snapshot 正确；
- 返回后 LocalCapture 可恢复；
- submit 成功、upload 失败、Cloud 未配置；
- 删除本地文件与 cloud task 语义分离。

## Implementation Evidence — 2026-09-02

- Mobile PR #87 已 squash 合入 `dev`，merge commit `f4fdde412896567f500004978a81ebffdb399c8a`。
- 新增 `src/shiyan/playback/AudioPlayer.tsx`：复用既有 `PlaybackAdapter`，独立承接 load / play / pause / seek / dispose；不依赖 CaptureTask、Cloud 或确认页提交状态。
- `ShiyanCaptureSubmitScreen` 已改为消费 `AudioPlayer`；完整 inactive track、played fill、thumb 与完整 seek touch area 分离，页面离开通过 `active={isFocused}` 释放 playback，删除前通过组件 ref 显式 dispose。
- 确认页场景收为“当前值 + chevron”，check 只存在于现有 Sheet；主操作收为唯一 `开始整理`，内部技术 phase 对用户归纳为 `正在提交…` / `正在上传 X%`。
- `稍后处理` 与 `删除本地录音` 已降为次级动作；删除继续二次确认，并保持本地文件与 cloud task 的语义边界。
- 自动门禁：Typecheck、Lint、全量 Jest、Android debug build、iOS simulator build、unsigned iPhone build / IPA verify / artifact upload 全部通过。
- 当前 head OpenCode Review：无高置信 P0-P2 finding；首轮针对旧 MOB-029 source-contract 测试的 finding 已迁移合同并解决。
- **当前待视觉验收。** 尚未取得页面实际渲染的视觉确认，以及 Android / iOS 真机播放器 UI / 拖拽 seek / 前后台切换 / 播放中删除等人工 smoke 证据，因此本卡保持 **REVIEW**，不得记为 PASS。

## Parallel / Integration

- 可与 MOB-030 并行。
- 不建议与其它任务同时大改 `ShiyanCaptureSubmitScreen.tsx`。
- MOB-034 最终统一检查 Secondary action、Action Sheet 与 token 视觉层级。

## Unknown / Human Decision

None。若施工发现“返回自动保留”与当前 local confirmation persistence 冲突，不自行改变保存合同，先报告并保留现有安全语义。

## Handoff

先确认当前 `dev` 已有 MOB-029 的真实实现；已有正确的 playback adapter / scene 行为不重写。播放器 UI 需要从确认页中抽离成独立可复用组件，再按本卡与设计参考收口页面主次层级。

## Acceptance Evidence — 2026-09-03

产品负责人完成本卡视觉与真机验收，Acceptance 第 1–10 项全部通过（含唯一主 CTA、Audio Player 完整轨道 / seek 视觉、场景整行回显 + Sheet 单选、返回恢复、删除降级二次确认、提交失败反馈等项）。

第 11 项回归保护（MOB-029 已有 playback / scene 行为不回归）由产品负责人确认通过：播放 / 暂停 / 拖动 / 重播、释放资源、删除停止播放、场景单选回写与 snapshot 冻结在重构后的 AudioPlayer 组件上行为不变。

本卡由 REVIEW 记为 PASS。
