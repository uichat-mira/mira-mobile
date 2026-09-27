# MOB-030：拾言首页与统一记录入口

状态：**PASS（2026-09-04 真机验收通过）**

负责人：`mob_030_shiyan_home_records`

执行仓库：`dangjingtao/uichat-mira-mobile`

施工基线：`dev @ c987df8b177a6ba8537899acc63a9fdfdf9cdf61`

## 背景

拾言 MVP 已跑通真实烟测。当前主要问题不再是功能缺失，而是首页仍明显暴露实现结构：`开始拾言`、`本地录音草稿`、`历史任务` 被作为三个并列的大入口，但用户真正理解的是“一条拾言记录在不同阶段”，不会主动区分 LocalCapture 与 Cloud CaptureTask。

本卡只调整 Mobile presentation / navigation，不修改 PRD，不合并底层事实模型。

## Goal

把拾言首页收成一个轻量工作入口：

1. `开始拾言` 是唯一主 CTA；
2. 场景通过轻入口选择，不占用第二个大页面动作；
3. 首页提供一个统一的 `全部记录` 入口，并可展示少量最近记录；
4. LocalCapture 与 CaptureTask 在 UI 列表中统一呈现生命周期，但底层继续严格分离。

## Must Read

- `AGENTS.md`
- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/task-cards/MOB-017-shiyan-recording-local-recovery.md`
- `docs/task-cards/MOB-021-shiyan-mobile-results-history.md`
- `docs/task-cards/MOB-029-shiyan-confirmation-ux.md`
- `src/shiyan/ShiyanRecordingScreens.tsx`
- `src/shiyan/ShiyanHistoryScreen.tsx`
- `src/shiyan/history.ts`
- `src/shiyan/recording/localCaptureRepository.ts`
- `src/theme/tokens.ts`
- `src/theme/palette.ts`

如本卡描述与 `docs/shiyan/PRD.md` 冲突，以 PRD 为准；涉及 LocalCapture / CaptureTask / Stage / authoritative state 时，以 `TECHNICAL_DESIGN.md` 为准。

## Verified Context

- Local-first 是冻结技术边界：提交前可以只有 LocalCapture；用户点击提交后才创建云端 CaptureTask。
- `localCaptureId -> taskId` 可以在提交后形成绑定，但本地记录和云端任务不是同一个数据对象。
- 当前已有 `ShiyanLocalDrafts`、`ShiyanHistory`、`ShiyanTaskDetail` 路由与数据读取能力。
- 本卡不得为了“统一列表”修改 Cloud schema、CaptureTask 合同或本地持久化模型。

## Interaction Contract

### A. 首页布局

首页首屏只保留以下主层级：

```text
拾言                                      ··· / Settings

先说下来，再慢慢整理。

[ 开始拾言 ]
  当前场景：会议采集 ⌄

全部记录                                  >
最近记录 1
最近记录 2
...
```

具体视觉必须使用现有 Design Token，不照设计稿硬编码颜色、圆角、阴影、字号或间距。

### B. 场景选择

- 首页显示当前场景的轻量回显，例如 `会议采集 ⌄`。
- 点击场景回显后打开 cross-platform Bottom Sheet / Action Sheet。
- Sheet 中列出当前有效内置场景与有效自定义场景。
- 当前场景显示 check / selected 状态。
- 点击任一场景后立即更新当前选择并关闭 Sheet，不再出现额外“确定”按钮。
- `开始拾言` 点击后直接使用当前选中场景进入现有录音页。
- 不删除现有 `ShiyanSceneSelect` 路由，若其它入口或兼容路径仍依赖它，允许保留；但首页主路径不应强迫用户先进入一整页场景选择再录音。

### C. 统一“全部记录”

UI 层建立 presentation projection：

```text
LocalCapture ───────┐
                    ├── UnifiedRecordPresentation[]
CaptureTask ────────┘
```

规则：

- 未绑定 cloud task 的 LocalCapture：显示为 `待整理` / `待提交` 等用户可理解状态；点击进入现有确认页。
- 已绑定 taskId 或来自 Cloud History 的 CaptureTask：以 CaptureTask 为 authoritative 展示来源；点击进入 TaskDetail。
- 已投递：展示 `已投递`，有真实 canonical URL 时可在详情内打开；列表不需要固定占一整行“暂无真实投递链接”。
- Stage failed：不要把整条记录标成“失败”；列表显示类似 `整理遇到问题` / `需要处理`，进入详情后再精确恢复对应 Stage。
- 同一 LocalCapture 与已绑定 CaptureTask 不得重复出现两条记录。

### D. 最近记录

- 首页只展示少量最近记录（建议 2～4 条，由现有布局决定，不新增设置项）。
- 点击 `全部记录 >` 进入完整统一记录列表。
- 最近记录与完整列表必须复用同一 presentation mapping，禁止写两套状态文案逻辑。

### E. 配置入口

- 首页右上角保留一个小型配置入口。
- 可使用现有 Cloud/Settings/More 图标语义，但不要把“Cloud”作为首页主要产品概念重复展示。
- 点击进入现有 `ShiyanCloudConfig` 或包含该入口的轻量菜单；不得新增第二套配置真相。

## Hard Constraints

- **PRD 不能改。**
- 不新增搜索、录音标记、实时转写、时间点引用等 PRD 外能力。
- 不合并 LocalCapture 与 CaptureTask 的存储 / domain model。
- 不伪造 Cloud Task，不因为本地数据存在就假装已进入云端处理。
- 不删除恢复能力；弱网 / 未提交录音仍必须可从统一列表找到。
- 不为了统一列表引入新的本地数据库或全局状态框架。
- UI 视觉实现以现有 `src/theme/` Design Token 为准。

## Execution Entry Points

- `src/shiyan/ShiyanRecordingScreens.tsx`
- `src/shiyan/ShiyanHistoryScreen.tsx`
- `src/shiyan/history.ts`
- `src/shiyan/recording/localCaptureRepository.ts`
- `src/types/navigation.ts`（仅在确有路由收口需要时）

优先新增小型 presentation/helper，而不是把两套数据映射继续塞进 Screen 组件。

## Acceptance

1. 首页首屏只存在一个视觉主 CTA：`开始拾言`。
2. 场景选择通过轻量 Sheet 完成；选中后直接回显并可开始录音。
3. 用户无需理解“本地草稿 / Cloud 历史”即可从 `全部记录` 找到所有有效拾言记录。
4. 未提交本地录音与云端 Task 不重复展示。
5. 点击不同生命周期记录进入正确现有页面。
6. Stage 失败不被错误映射成整个 Task 失败。
7. 无网络时 LocalCapture 仍可显示；Cloud 读取失败不得把本地记录一起变成空列表。
8. 视觉使用当前 Design Token，不新增第二套主题常量。

## Validation

至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

需要新增/更新测试覆盖：

- LocalCapture-only -> unified record；
- localCaptureId 已绑定 taskId -> 去重；
- CaptureTask processing / ready / failed-stage / delivered presentation；
- Cloud history 读取失败时本地记录仍可呈现；
- 场景 Sheet 当前值、切换和开始录音参数。

真机 smoke：Android 至少验证首页 -> 场景 Sheet -> 录音、待提交记录 -> 确认、云端记录 -> 详情三条路径；iOS 无真机时明确 simulator gap。

## Parallel / Integration

- 可与 MOB-031 并行，二者尽量避免同时重构共享 ScreenShell / navigation registry。
- 可与 MOB-032 并行，但若双方都修改 `ShiyanHistoryScreen` / 共用 presentation helper，先协调接口。
- MOB-034 最终收口时会检查本卡的 token / 文案 / 低频入口一致性。

## Unknown / Human Decision

None。若统一列表实现需要改变 PRD 或 TECHNICAL_DESIGN 中的数据归属，停止施工并报告，不得自行修改合同。

## Current Implementation

PR #86 已 squash 合并到 `dev`，merge commit：`6065260750086aa19e58adb3f5e75b491a02cc41`。

当前实现已落地：

- `开始拾言` 已成为首页唯一主 CTA；
- 首页主路径直接使用当前场景进入现有录音页，不再强迫经过整页场景选择；
- 场景轻入口复用 MOB-029 已有 Sheet 的视觉/交互语义，并继续保留原 `ShiyanSceneSelect` 路由；
- 新增 `UnifiedRecordPresentation` projection，只读取 LocalCapture、submission pointer 和 CaptureTask summary，不修改任何存储/domain schema；
- `ShiyanHistory` 现有路由收口为 `全部记录`，最近记录与完整列表复用同一 projection 和 Row；
- Cloud history 失败时仍保留本地记录，并明确显示 Cloud 数据暂不可用，不伪装成空列表；
- projection/去重/Cloud 失败、场景当前值/切换/录音参数与 canonical delivery route 合同测试已补齐；最终 head Typecheck/Lint/Jest 全绿，最新 OpenCode Review 无 P0-P2；Android/iOS 真机与真实 Shiyan Cloud smoke 仍待人工验收。

## Handoff

代码已合并进入 `dev`。后续若人工验收发现 UI、平台或真实 Cloud 交互问题，在本卡继续补证据或修复。

## Acceptance Evidence — 2026-09-04

真机验收（Android/iOS）全部通过，本卡标 PASS：

1. 首页首屏唯一主 CTA `开始拾言` ✅
2. 场景选择轻量 Sheet，选中直接回显可录音 ✅
3. `全部记录` 汇聚本地草稿与云端历史，无需理解底层归属 ✅
4. 已提交云端任务的录音在列表不重复展示（去重） ✅
5. 不同生命周期记录点击进入正确现有页面 ✅
6. 单 Stage 失败不被映射成整个任务失败 ✅
7. 无网络时本地记录仍显示，Cloud 失败不清空本地记录 ✅
8. 视觉使用现有 Design Token，无新增第二套主题 ✅
