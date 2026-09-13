# Mira Mobile PR Review

Mira Mobile 正在从仓库自有的自动 Review 迁移到 **Mira Organization AI Review**。

当前已经实际运行的主链路是：

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

- `.ai/review-profile.md` 已存在于 `dev` 的可信 base side；
- `.github/workflows/mira-ai-review.yml` 是薄 caller，不 checkout、读取或执行 PR head 代码；
- caller 只持有 purpose-specific `AI_REVIEW_GATEWAY_TOKEN`，不持有 GitHub publisher token 或模型 Provider 凭据；
- `feat/* -> dev` 已完成真实 `CODE_REVIEW`；
- Review metadata 绑定精确 base/head SHA、Organization policy、Mobile profile、root contract、trusted task contract、runtime 和 provider identity；
- 新 push 后旧 comment 曾真实处于旧 head、而 PR 已指向新 head 的 stale 窗口，随后同一条 Mira sticky comment 被更新到新 head；
- trusted Task / PR Contract 已通过 GitHub server-side work-item relation 成功进入 review package；
- `dev -> test` 已完成 evidence-only `PROMOTION_REVIEW` dry run；在 Promotion route 未启用时，Gateway 发布 `REVIEW_UNAVAILABLE`，没有 provider attempt，也没有偷偷启用 fallback；
- `NO_BLOCKING_FINDINGS`、`HUMAN_CHECK_NEEDED`、`REVIEW_UNAVAILABLE` 均已在真实 GitHub 路径中出现并按 Organization contract 发布。

Pilot 的工作项与验收证据以 Issue #109 为准。在 #109 被明确接受以前，不向 Desktop / Relay / Docs 等仓库推广。

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

`mira-mobile` 的 GitHub default branch 当前仍是 `prod`。由于 `pull_request_target` 的 workflow 必须从 GitHub trusted/default-branch surface 可见，Pilot 曾将已经在 `dev` 验证过的同一份 dispatcher 最小化 bootstrap 到 `prod`；这不改变 `prod` 的生产环境语义，也没有把当前巨大且分叉的 `dev -> test` 产品差异一并晋级。

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

CodeRabbit 在迁移设计中仍应作为 **independent side reviewer** 存在，而不是被 Mira Review 替换。仓库根目录 `.coderabbit.yaml` 仍配置：

- language: `zh-CN`；
- profile: `assertive`；
- auto review: enabled；
- incremental review: enabled；
- drafts: disabled；
- base branch: `dev`。

但当前真实运行状态与配置文件并不一致：仓库迁移到 `uichat-mira` Organization 后，PR #108 / #110 / #111 / #112 均没有观察到 `coderabbitai[bot]` review/check；在 #112 手动发出 `@coderabbitai review` 后也没有 bot 响应。迁移前 PR #98 则有真实 CodeRabbit Advanced review，且其 CodeRabbit 链接仍指向旧的 `dangjingtao/uichat-mira-mobile` 仓库路径。

因此当前将这一项视为 **CodeRabbit GitHub App / Organization repository authorization 的外部迁移阻塞**，而不是 Mira Review runtime 故障。直到 CodeRabbit 在 Organization 仓库恢复并完成一次独立对照，Issue #109 不应被接受，Organization-wide rollout 也继续保持 blocked。

## Historical OpenCode reviewer

仓库历史上存在项目专用 OpenCode PR Review skill、脚本与 workflow。旧 OpenCode 自动 Review 已停用，不再承担当前正常 PR Review runtime。

`.opencode/skills/mira-mobile-pr-review/SKILL.md` 等历史实现仍可作为 Mobile review knowledge 的迁移参考，但当前自动 Review 的事实来源已经变为：

1. Organization AI Review policy / output contract；
2. 当前 PR / Issue task contract；
3. base-side `.ai/review-profile.md` 与 `AGENTS.md`；
4. Control Room Review Gateway runtime；
5. CodeRabbit（在外部授权恢复后）作为独立旁路证据。

历史 OpenCode runtime 如需最终删除或归档，应单独处理，不在普通产品 PR 中顺手清理。
