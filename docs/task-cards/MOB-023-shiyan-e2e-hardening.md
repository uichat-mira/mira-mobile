# MOB-023：拾言 MVP 端到端验收与加固

状态：**REVIEW · 验收中**（2026-09-07 启动）

负责人：`mob_023_shiyan_e2e_hardening`

执行仓库：`dangjingtao/uichat-mira-mobile` + `dangjingtao/mira-shiyan-cloud` + `dangjingtao/mira-shiyan`

目标基线：MOB-016～MOB-022 全部合入后的集成基线

目标里程碑：Shiyan MVP

依赖：MOB-016、MOB-017、MOB-018、MOB-019、MOB-020、MOB-021、MOB-022

## 背景

拾言 MVP 的最终标准不是“每个模块单测通过”，而是一段约 40 分钟真实会议能从录音走到可编辑整理稿，再由用户确认并投递到真实 GitHub 链接，同时错误恢复语义正确。

## 目标

完成三仓端到端联调、40 分钟真实会议 smoke、主要失败路径恢复验证与必要的观测补强，给出明确的 MVP 验收结论。

## 范围

- 按 PRD 正常会议场景完成：选择场景 -> 录音 -> 确认标题 / 场景 -> 上传 -> STT -> AI 整理 -> AI 调整 -> 用户最终编辑 -> GitHub 投递；
- 验证会议结束后 5 分钟内进入可编辑整理稿的目标；若真实 Provider / 音频长度导致不达标，记录实测瓶颈，不伪造通过；
- 验证用户无需重新听完整录音即可完成最终确认与投递；
- 验证本地录音恢复：弱网、上传中断、App 重启；
- 验证 STT 失败、LLM 整理失败、GitHub 投递失败均只影响对应 Stage；
- 验证重试不重复创建任务、音频或 GitHub 文档；
- 验证原始录音默认 3 天策略与“保留原始录音”语义；
- 验证历史任务最终显示真实 GitHub canonical link；
- 验证日志 / 错误信息不泄露录音正文、credential、PAT、Provider Key；
- 补齐三仓 README / canonical 文档中施工后实际发生但属于实现事实的说明；如发现需要改变 PRD / 技术设计，停止并先回到 Mobile canonical truth 更新评审。

## Hard Constraints

- 不在验收卡顺手新增产品功能；
- 不为了过指标把失败状态伪装为完成；
- 自动化验证不能冒充 iOS / Android 真机长录音验证；
- 发现跨仓库合同冲突时，以 Mobile `docs/shiyan/` 为准，先修合同一致性再继续；
- 不跳过真实 GitHub Destination；
- 不把单次 Provider 偶发成功当作稳定性证明。

## Validation Matrix

至少形成以下证据：

1. Android 真机约 40 分钟录音；
2. iOS 真机或可等价证明原生录音稳定性的 40 分钟验证；若设备条件不足必须明确列为未验收，不得写通过；
3. 正常端到端 GitHub 投递与真实 URL；
4. 无网结束录音后本地保留；
5. 上传失败恢复；
6. STT Stage 失败 / 重试；
7. LLM Stage 失败 / fallback / 重试；
8. Destination 失败 / 重试；
9. Final Draft 不被后台 AI 覆盖；
10. 三仓 typecheck / lint / test / deploy dry-run 或项目现有等价验证。

## 验收

1. 40 分钟真实会议闭环成功；
2. 会议结束后 5 分钟内可进入可编辑整理稿，或给出真实数据证明该指标当前未满足并登记阻塞；
3. 用户无需重听完整录音即可完成确认与投递；
4. 关键失败路径均可恢复且不丢已经成功的产物；
5. 历史任务可打开真实 GitHub 文档；
6. 三仓合同与 canonical truth 一致；
7. 所有未完成真机 / Provider / 权限验证均明确列出，不做“有条件通过”之外的夸大结论。

## 非目标

- 不做 speaker diarization；
- 不做 PDF / Word；
- 不做 Notion；
- 不做 Desktop 完整工作台；
- 不做 MVP+1 原文时间点跳转。

## 并行边界

本卡是集成验收卡，不承担新的产品功能开发。2026-09-07 起进入正式验收：基于已经落地的 MOB-016～MOB-022 集成基线，集中收集三仓联调、真机长录音、真实 Provider、失败恢复和 GitHub Destination 证据；未通过项回流对应实现卡，不在 MOB-023 内顺手扩功能。