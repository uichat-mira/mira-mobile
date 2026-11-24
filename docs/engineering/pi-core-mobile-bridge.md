# Mobile Local Agent: Pi Core 1.6

> **文档边界（2026-11-24）**：本文仅描述当前 Pi Core 和 Tool Gateway 的已实现行为及验收边界。0.4.0 以后确认的三层渐进式披露、Desktop 能力严选、跨工具合法调用等**目标产品决策与外部研究**统一见 [Mobile 0.4.0 产品决策与研究唯一真相](../mobile-0.4.0-product-decisions-and-research.md)。特别是下文的邮件调用链阻断属于**当前实现**，不代表新的 D9 产品目标已经交付；不得未经实施合同就移除敏感数据保护。

## Current implementation

Pi Core is the sole orchestration loop for the Mobile **Local Provider** path.
The source src/runtime/piAgentLoop.ts uses the real
@earendil-works/pi-agent-core@1.6.0 Agent, routing model requests through Mira's
existing LocalProviderExecutor. src/runtime/localAgentRunController.ts retains
run tokens, cancellation and approval UI lifecycle. ConversationRuntime owns
message persistence.

The old MobileAgentLoop and development-only engine selection were removed.
Remote Host sessions continue to use their own Host-authoritative runtime:
Pi Core is not a Mobile copy of the Desktop Harness. Pi does not receive
Host tool credentials, Cloud Auth secrets or Local Provider keys.

## Execution budget

The sole user-configurable execution budget lives in
src/settings/agentExecutionBudget.ts; it is persisted with the existing
src/settings/generalSettings.ts document under Settings → 通用 → 常规.

- Default: **16 tool rounds**, **15 minutes** overall.
- Configurable: 1–64 tool rounds, 1–120 minutes.
- Stored in the existing General settings key (mira.mobile.general.v1).
  Pre-existing records without an agentBudget field use the new defaults;
  malformed values are normalized to bounded safe values.
- LocalAgentRunController.beginRun reloads budget each new run and passes it
  to Pi. A currently running turn retains its start-of-run budget.
- This is **not** a cost, Token, or thinking budget. The overall timeout
  currently includes user-approval waiting time.

These bounds are execution guards, not measurements of actual model spend.
There is no independent or hidden second budget in Pi.

## Tool and provider boundaries

- The Local Provider's wire protocol, API key, stream and cancellation remain
  owned by LocalProviderExecutor.
- Tool Gateway discovery, Host selection, approval and result authority remain
  with the existing gateway; Pi executes authorized calls only.
- Bad Provider streams and missing Tool Gateway scopes surface as failures.
  An unavailable channel can degrade to plain-model output with a visible
  notice; requested unavailable tools fail rather than claiming success.
- A preflight checks the entire tool batch before any tool executes, including
  mailbox privacy rules and exclusive Desktop discovery.
- whoyou_mail_search and whoyou_mail_message_get must carry the exact expected
  sensitivity roles. Mail search may only be followed by mail-body retrieval;
  after a body result no further tool calls may occur in that user turn.
  Consent is requested through the existing user approval with recipient notice.
- Cloud Desktop discovery refreshes the validated manifest set dynamically.
  Multiple real Hosts produce a deterministic user choice based on directory
  data, never an invented or silently chosen Host.
- Discovery may include a trusted service catalog with optional capability
  descriptors. Pi can call `mira_tools_disclose` to load real schemas from that
  catalog in the same run, or call an already available tool directly. There is
  no fixed three-step discovery count. The gateway still owns every schema and
  rechecks authority/approval on actual calls; plain tool result text cannot add
  tools. This is the protocol-neutral Mobile foundation, not an OPS-046 or
  third-party MCP manifest implementation.
- An uncertain Host approval resolution is an error, not ordinary cancellation.
- Tool result size bounds, app suspension, run cancellation and execution
  deadlines are enforced by Pi just as before.

### Host discovery and Provider compatibility (2026-11-23)

- `mira_desktop_hosts` is a discovery entry, not an unconditional grant to
  every Desktop tool. Its results can refresh the current run's tool manifests;
  a new Local Agent run resolves its current Cloud / Host authority again.
- The model-facing conversion in `src/runtime/piAgentLoop.ts`
  (`toProviderParameters()`, [Mobile PR #358](https://github.com/uichat-mira/mira-mobile/pull/358))
  adds root `type: "object"` only to root-untyped `oneOf` schemas whose
  every branch is explicitly an object. The original Host manifest, branches,
  invocation checks and approvals are preserved. This avoids a reproduced
  OpenAI-compatible Provider HTTP 400 after Desktop discovery.
- The four observed affected Desktop tools are `github_repository`,
  `github_issue`, `github_pull_request` and `github_actions`.
  Their exported Schema ownership remains Desktop-side; follow
  [Desktop AGT-070](https://github.com/uichat-mira/mira-desktop/issues/491).
  Do not remove the Mobile compatibility layer without independent evidence.
- `news_search` queries Desktop's News Hub cache, **not live internet news**.
  `web_search` is a separate Desktop capability gated by configured search
  provider readiness and current Host authority. A registered Desktop tool
  is not necessarily exposed to a given Mobile session.

## Validation and rollout

Node 26 typecheck, lint and Jest are the source-level gates, including migrated
regressions from the former loop. Tests execute the real Pi Agent while faking
only Provider/Host external IO when appropriate; Cloud adapter fixture tests
exercise the actual client boundary.

The earlier isolated Metro/Hermes bridge was checked. On 2026-11-23, a
signed **0.3.36 Build 38 iPhone 17 Pro / iOS 26.5 simulator** with candidate
JavaScript completed real `local_weather_current` (Open-Meteo result → model
reply) and `mira_desktop_hosts → news_search → model reply` (real empty cache
result). See [MOB-089](https://github.com/uichat-mira/mira-mobile/issues/349)
and [PR #358](https://github.com/uichat-mira/mira-mobile/pull/358).
These results do **not** prove a newly built post-merge installation, Android
device behavior, live `web_search`, or full Who-You consent/reading acceptance.

Remaining Android true-device and cross-service acceptance includes:
1. Local Provider plain text and conversation persistence.
2. One approved Desktop tool call with model continuation.
3. Multiple Desktop Hosts: visible choice without guessing.
4. Who-You separate consent for search and body, no chained side effects.
5. Reject, timeout, approval uncertainty, app/background cancellation.
6. Update budget in General and verify next-turn enforcement.

Do not equate JS/Jest green with device execution. Promote to test/prod only
with explicit release authority. Recovery is by reverting the cutover commit,
not by retaining two active loop implementations indefinitely.
