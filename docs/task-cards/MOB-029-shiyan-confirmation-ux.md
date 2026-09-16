# MOB-029：拾言确认页播放器、场景 Action Sheet 与 Cloud 配置入口

状态：**完成**（2026-09-04 真机验收通过验收条目 1–9）

负责人：`mob_029_shiyan_confirmation_ux`

执行仓库：`dangjingtao/uichat-mira-mobile`

首次派卡基线：`dev @ a90dfb6c2d80079fd85084fff0214968e137e653`

## 背景

拾言现有产品合同已经明确：录音结束后不立即提交，而是进入轻确认步骤，确认 / 修改标题与场景后再提交处理。

当前 Mobile 实现存在三处 dogfood 体验问题：

1. Cloud 配置按钮放在「确认并提交」页右上角，而用户希望 canonical 配置入口位于「拾言」主页标题栏右侧；
2. 录音信息只是一张静态摘要卡，无法在提交前试听与拖动确认；
3. 场景当前把所有选项平铺成大按钮，看起来像重新填写表单，而不是确认已有选择。

本卡只收口确认阶段 UX，不改变拾言 CaptureTask / Transcript / AI Draft / Final Draft / Delivery 合同。

## 产品目标

1. 「拾言」主页标题栏右侧提供明确 Cloud 配置入口。
2. 「确认并提交」页顶部录音摘要改为小播放器，可播放 / 暂停、显示当前时间与总时长、拖动进度。
3. 场景区域只回显当前单选值；用户需要修改时，通过底部 Action Sheet 选择。
4. 整页体验从“再填一遍表单”调整为“确认录音详情后提交”。

## Scope

### 1. Cloud 配置入口

- `ShiyanHomeScreen` 顶部标题栏右侧增加 Cloud / Settings 入口，点击进入现有 `ShiyanCloudConfig`。
- 这是拾言 Cloud 配置的 canonical 页面入口。
- 当前「确认并提交」页右上角 Settings 按钮移除，避免配置入口漂移。
- 与该按钮位置绑定的旧错误文案需要同步修正，例如不能继续提示“可点右上角设置”。
- 错误状态可以给出真实的“Cloud 尚未配置”说明，但不要再制造第二个长期主入口。

### 2. 录音小播放器

确认页顶部静态 summary 改为紧凑播放器，至少包含：

- 播放 / 暂停；
- 当前播放时间；
- 总时长；
- 可见进度条；
- 用户可拖动 / 点击 seek 到指定时间；
- 文件大小等次要信息可以保留，但不能压过播放器主操作。

播放对象是已经可靠保存在 App 本地目录的该条录音文件。

#### Playback contract

当前 `RecordingAdapter` 只负责录音生命周期，没有 playback 能力。本卡不要把播放状态粗暴塞进现有 recording state machine。优先新增一个小型、职责单一的本地音频 playback adapter，例如：

```text
load(filePath)
play()
pause()
seek(positionMs)
getSnapshot() / subscribe()
stop()/dispose()
```

具体 native 实现由 Builder 根据当前工程选择最小方案，但必须同时核对 Android / iOS：

- 优先复用系统原生音频能力或现有 native audio 层；
- 不无理由引入体积较大的第三方播放器依赖；
- 如果确实需要新增依赖，先报告依赖理由、平台覆盖与 APK / iOS build 影响。

播放器生命周期要求：

- 页面离开 / unmount 时停止并释放资源；
- 删除本地录音前停止播放；
- 切换到另一条录音时不残留前一条播放状态；
- seek 后 UI 与真实播放位置一致；
- 播放到结尾后回到可再次播放的合理状态；
- 加载 / 播放失败不得影响本地录音文件本身，也不得伪装成录音损坏。

### 3. 场景单选回显 + Action Sheet

确认页不再平铺全部 scene button。

默认显示一个紧凑的当前场景行，例如：

```text
场景
(○/●) 会议采集                       >
```

具体视觉沿用当前 token / Lucide；核心是：

- 页面只回显当前选中的单选值；
- 点击该行后，从底部弹出 Action Sheet / bottom sheet；
- Action Sheet 列出当前允许的内置场景与有效自定义场景；
- 当前项带明确 selected / check 状态；
- 用户只能单选；
- 选择后关闭 sheet 并回写确认页。

首版内置场景继续是：

- 会议采集；
- 临时口述需求；
- 个人复盘 / 想法记录。

Action Sheet 必须是 Android / iOS 都成立的产品模式。不要只调用 iOS-only API 后让 Android 退化成 Alert 列表；如果项目没有现成 cross-platform sheet，可用受控 `Modal` 实现轻量 bottom sheet，不为了本卡引入大型 UI 框架。

### 4. 既有场景快照与提交语义

- 继续使用当前 `canonicalShiyanSceneId()`、`toShiyanSceneSnapshot()` 与 `localCaptureRepository.confirm()` 语义。
- 修改场景后，真正提交 / 保存时仍冻结正确 Scene snapshot。
- 旧录音缺少完整自定义场景规则时，现有校验继续生效，不能因为 UI 改成 sheet 就绕过。
- 标题仍可编辑。
- 「提交并开始处理」「先保存在本机，稍后提交」「删除本地录音」行为保持原合同。

## Hard Constraints

- 不改变 `docs/shiyan/` 已冻结的 CaptureTask / Transcript / Draft / Delivery 边界。
- 不把本卡扩大成实时转写、波形编辑、音频裁剪、倍速播放或原文时间点引用。
- 不重写 `RecordingAdapter` 的录音生命周期合同。
- 不因 UI 改版绕过 Scene snapshot 冻结 / legacy scene 校验。
- Cloud 配置入口移动不能导致配置页面失联。
- 不无理由引入大型媒体 / bottom-sheet 依赖。

## Must Read

- `AGENTS.md`
- `docs/work-ledger.md`
- `docs/shiyan/PRD.md`
- `docs/shiyan/TECHNICAL_DESIGN.md`
- `docs/shiyan/README.md`
- `docs/task-cards/MOB-016-shiyan-plugin-shell.md`
- `docs/task-cards/MOB-017-shiyan-recording-local-recovery.md`
- `src/shiyan/ShiyanRecordingScreens.tsx`
- `src/shiyan/ShiyanCaptureSubmitScreen.tsx`
- `src/shiyan/ShiyanCloudConfigScreen.tsx`
- `src/shiyan/recording/RecordingAdapter.ts`
- `src/shiyan/recording/nativeAudioRecorder.ts`
- `src/shiyan/recording/localCaptureRepository.ts`
- `src/shiyan/scenes.ts`
- Android / iOS 当前原生录音模块

## Execution Entry Points

- `src/shiyan/ShiyanRecordingScreens.tsx`
- `src/shiyan/ShiyanCaptureSubmitScreen.tsx`
- 可新增 `src/shiyan/playback/` 或等价小型 adapter 层
- `android/app/src/main/java/io/tomz/mira/mobile/`（若采用原生 playback）
- `ios/MiraAudioRecorder/` 或独立的最小 native playback module（根据当前工程事实选择）
- `src/shiyan/scenes.ts`（只在需要复用 scene list/helper 时）

## Validation

自动化至少执行：

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

如涉及原生代码，还必须执行当前项目已有 Android / iOS 等价构建门禁，并如实记录结果。

自动化 / domain 测试至少覆盖：

1. scene 当前值正确回显；
2. Action Sheet 单选后 sceneId 更新；
3. 自定义 / legacy scene 校验仍生效；
4. playback snapshot 的 play / pause / seek / end / dispose 状态；
5. 删除前会释放播放器；
6. 页面退出后不会继续持有本地音频播放资源。

真机 / 模拟器 smoke 至少覆盖：

1. 拾言主页右上角进入 Cloud 配置并能返回；
2. 录一段短音频 -> 确认页 -> 可播放 / 暂停；
3. 拖动进度条后从目标位置继续；
4. 播放结束可重新播放；
5. 当前场景只显示一项；
6. 点击场景打开底部 Action Sheet，切换三类内置场景并正确回显；
7. 修改标题 / 场景后“先保存”仍能恢复正确值；
8. 提交时 scene snapshot 正确；
9. 删除录音时播放器停止且文件删除语义不变。

若 iOS 真机不可得，可使用当前项目允许的 simulator / native build evidence，但必须明确剩余真机 gap。

## Parallel / Integration

可与 MOB-025、MOB-026、MOB-027 并行。

与 MOB-028 在其保持“系统 / 浏览器下载、不新增 native installer module”的合同下也可并行。若 MOB-028 或本卡需要修改共享 `MainApplication` / native package registration / Podfile 等共同 native 配置，两个 Builder 必须报告并协调集成顺序，不得各自覆盖。

建议该卡在 025-028 之后或独立 worktree 中合入，因为它是本批唯一可能同时触碰 Android / iOS native audio 的任务。

## Open / Unknown

当前基线没有现成 playback adapter，也没有发现已安装的通用音频播放依赖。具体采用 Android / iOS 系统原生能力还是新增小型依赖属于技术实现选择；如果选择新增依赖，必须先报告理由与体积 / 构建影响。

## Handoff

先核对当前拾言 canonical 文档与原生录音实现。若当前 HEAD 已出现 playback 或统一 bottom-sheet 基础设施，优先复用；若仓库事实与本卡入口路径冲突，先报告，不得复制第二套音频状态机或第二套 Scene truth。