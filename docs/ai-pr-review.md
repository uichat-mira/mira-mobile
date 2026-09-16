# Mira Mobile PR Review

Mira Mobile 的 **Mira Organization AI Review** 主链路已经在真实仓库运行；首个 Mobile 试点当前因 CodeRabbit 自动旁审行为与迁移前基线不一致而重新打开，尚未完成最终验收。

```text
Mobile PR event
  -> trusted pull_request_target caller
  -> Control Room Review Gateway
  -> Organization policy + base-side Mobile review profile/contracts
  -> trusted GitHub task relation where applicable
  -> provider execution + Mira normalization
  -> freshness re-check
  -> deterministic GitHub publication
```

Organization 通用 Review 制度、标准 verdict、finding 结构、stale / unavailable 语义和发布合同由 `uichat-mira/.github` 维护；Mobile 仓库只保留 `.ai/review-profile.md` 中的 Mobile 专项审查知识，不在本仓库复制一套通用 Review 政策，也不维护 Provider / baseURL / model / API-key 矩阵。

## Current pilot status

Mobile 是 Organization AI Review 的首个真实仓库试点。当前已验证：

- `.ai/review-profile.md` 已存在于可信 base side；
- `.github/workflows/mira-ai-review.yml` 是薄 caller，不 checkout、读取或执行 PR head 代码；
- caller 只持有 purpose-specific `AI_REVIEW_GATEWAY_TOKEN`，不持有 GitHub publisher token 或模型 Provider 凭据；
- `feat/* -> dev` 已完成真实 `CODE_REVIEW`；
- Review metadata 绑定精确 base/head SHA、Organization policy、Mobile profile、root contract、trusted task contract、runtime 和 provider identity；
- 新 push 后旧 comment 曾真实处于旧 head、而 PR 已指向新 head 的 stale 窗口，随后同一条 Mira sticky comment 被更新到新 head；
- trusted Task / PR Contract 已通过 GitHub server-side work-item relation 成功进入 review package；
- `dev -> test` 已完成 evidence-only `PROMOTION_REVIEW` dry run；在 Promotion route 未启用时，Gateway 发布 `REVIEW_UNAVAILABLE`，没有 provider attempt，也没有偷偷启用 fallback；
- `NO_BLOCKING_FINDINGS`、`HUMAN_CHECK_NEEDED`、`REVIEW_UNAVAILABLE` 均已在真实 GitHub 路径中出现并按 Organization contract 发布；
- CodeRabbit 在 Organization 仓库授权恢复后，PR #112 已证明手动 `@coderabbitai review` 可以执行完整独立审查；但 PR #116 的自动触发被 CodeRabbit 以 `This repository does not receive automatic reviews because it has fewer than 10 stars.` 跳过，而迁移前同一仓库的 PR #98 曾正常自动 Review。当前差异尚未解释，不能把 `<10 stars>` 直接归纳为普遍 OSS 政策。

Pilot 的验收与证据以 Issue #109 为准；#109 当前因 CodeRabbit 自动旁审回归重新打开。在该行为恢复到迁移前基线，或维护者明确接受并记录合同变化以前，不向 Desktop / Relay / Docs 等仓库继续推广。

## Trigger and trust boundary

当前 trusted caller 使用 `pull_request_target`，监听 `dev` / `test` / `prod`，但只接受 Organization 环境模型中的合法转换：

```text
feat/* -> dev   = CODE_REVIEW
dev    -> test  = PROMOTION_REVIEW
test   -> prod  = RELEASE_REVIEW
```

Caller 只从 GitHub event 读取 repository identity 与 PR number，然后交给 Control Room。PR 作者不能通过 PR head 选择：

- Organization policy；
- Mobile review profile；
- Provider / model / endpoint；
- GitHub read / publish credential；
- Review mode；
- trusted task contract。

Control Room 会独立重新读取当前 PR、base/head、Organization policy、base-side profile/contracts 和 GitHub task relation，并在发布前再次检查 freshness。

`mira-mobile` 的 GitHub default branch 当前仍是 `prod`。`pull_request_target` 的可信 workflow surface 必须在默认分支可见，因此 Organization Review dispatcher 保持在 `prod`；这不改变 `prod` 的生产环境语义，也不授权绕过 `dev -> test -> prod` 的产品晋级链。

## Trusted work-item contract

Mira Review 不把 PR body 中的一段文字直接当成最高优先级任务合同。Control Room 从 GitHub server-side Issue / PR relation 读取 trusted Task / PR Contract。

需要特别注意：GitHub 的 `Closes #123` 等 closing keyword 只有在 PR 面向 repository default branch 时才会建立自动 closing relation。Mobile 日常 `feat/* -> dev` PR 因此不能假设在 PR body 写 `Closes #...` 就一定形成 trusted relation。

Pilot 已证明 GitHub 的 permission-gated manual closing reference 可以为非默认分支 PR 建立可信关系；当前长期自动化方式尚未在 Mobile 仓库固化。若没有可信 relation，Review 必须显式记录 task-contract unavailable，而不能解析 PR-head 指令自行猜任务卡。

## Mobile review profile

`.ai/review-profile.md` 只定义 Mobile 专项检查，包括：

- Remote Host / Local Provider 的 authority 与 credential boundary；
- React Native lifecycle、foreground/background、reconnect / resume、hydration 与 async race；
- navigation / session / run / source identity；
- local persistence 与 authoritative state 的区分；
- Android / iOS parity、permissions、deep links、native configuration、Gradle / CocoaPods、signing；
- pairing/auth/secrets 与 Tool Gateway / Agent Runtime 边界；
- CI / release / branch safety；
- loading / empty / error / data 等交互状态；
- 真机、Host / Relay、Local Provider、签名和跨仓库协议等 validation gaps。

缺少真机、外部服务或签名验证时，默认应记录为 validation gap；只有当现有证据足以建立实际缺陷时，才升级为 blocking finding。

## Output contract

Mira Organization Review 的 verdict 只允许：

```text
NO_BLOCKING_FINDINGS
CHANGES_NEEDED
HUMAN_CHECK_NEEDED
CONTRACT_CONFLICT
```

`REVIEW_UNAVAILABLE` 和 `STALE_REVIEW` 是 runtime / publication state，不是假装成 verdict 的另一套词。

实质 finding 继续要求清楚区分：

```text
Observation
Inference
Judgment
```

并包含 severity、impact、location、suggested fix 与 verification。当前 Review 是 advisory evidence，不拥有 merge / approve / request-changes / task-acceptance 权限。

## CodeRabbit side reviewer

CodeRabbit 继续作为 **independent side reviewer** 存在，不被 Mira Review 替换。仓库根目录 `.coderabbit.yaml` 配置：

- language: `zh-CN`；
- profile: `assertive`；
- auto review: enabled；
- incremental review: enabled；
- drafts: disabled；
- base branch: `dev`。

这里必须区分仓库配置、迁移前运行事实和当前 Organization 安装的服务端行为：

- 迁移前 PR #98 在同一仓库正常产生 CodeRabbit 自动 Review，使用 `.coderabbit.yaml`、`ASSERTIVE`、`Advanced`，其评论显示当时计划提供每小时 10 次 included reviews；
- 仓库迁移到 `uichat-mira` 后曾缺少 CodeRabbit GitHub App / repository authorization；恢复授权后，PR #112 证明手动 Review 已恢复；
- 但 PR #116 的自动触发被 CodeRabbit 明确跳过，理由为仓库少于 10 stars。

因此目前只能确认：**当前 Organization 安装上下文下，CodeRabbit 自动 Review 被服务端跳过，而手动 Review 可用。** 现有证据不足以把这一现象归因于普遍的 CodeRabbit OSS 政策；由于同一仓库迁移前可以自动 Review，更需要继续检查 Organization migration 是否改变了 installation / account / plan / OSS eligibility 等上下文。

PR #112 的安装后手动验证取得了真实独立 Review：

- `coderabbitai[bot]` 接收并执行了 `@coderabbitai review`；
- 使用仓库 `.coderabbit.yaml`；
- Review profile 为 `ASSERTIVE`；
- Run ID：`6a30f780-56a9-4a22-be71-e9916995bbe9`；
- 审查范围覆盖 `docs/ai-review-pilot-smoke.md`，截至 head `561135e55b2ad45db07ff006985e483941cb55de`；
- 结果为 `No actionable comments were generated in the recent review`，Merge Risk 为 Minimal。

所以 CodeRabbit 的 Organization 授权问题已经恢复，但**自动旁审等价性仍未恢复**。当前手动旁审只能作为临时可用路径和验证证据，不能视为与迁移前 Mobile 自动 Review 合同等价。Issue #109 保持打开，直到自动旁审恢复，或维护者明确决定接受并记录这一行为变化。Mira Review 与 CodeRabbit 仍是两条独立 Review 路径；两者结果都是维护者的审查证据，不拥有自动 merge、approve 或任务验收权。

## Legacy OpenCode retirement

旧的 repository-local OpenCode PR Review runtime 已从当前仓库退役。旧 workflow、OpenCode runner、项目级 review skill、本地 `review:pull` handoff 与 `.ai/reviews/` inbox 不再是当前接口，也不应被新的施工线程重新启用。

历史实现和迁移证据仍保留在 Git history 中；当前事实来源只有 Organization AI Review policy/output contract、当前 PR/Issue 合同、base-side `.ai/review-profile.md` 与 `AGENTS.md`、Control Room Review Gateway，以及 CodeRabbit 独立旁审证据。
