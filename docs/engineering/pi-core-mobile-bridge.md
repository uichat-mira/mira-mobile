# Mobile Local Agent: Pi Core 1.6

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
- An uncertain Host approval resolution is an error, not ordinary cancellation.
- Tool result size bounds, app suspension, run cancellation and execution
  deadlines are enforced by Pi just as before.

## Validation and rollout

Node 26 typecheck, lint and Jest are the source-level gates, including migrated
regressions from the former loop. Tests execute the real Pi Agent while faking
only Provider/Host external IO when appropriate; Cloud adapter fixture tests
exercise the actual client boundary.

Metro/Hermes bundling was checked for the earlier isolated bridge candidate.
Default cutover still requires **one Android true-device validation**:
1. Local Provider plain text and conversation persistence.
2. One approved Desktop tool call with model continuation.
3. Multiple Desktop Hosts: visible choice without guessing.
4. Who-You separate consent for search and body, no chained side effects.
5. Reject, timeout, approval uncertainty, app/background cancellation.
6. Update budget in General and verify next-turn enforcement.

Do not equate JS/Jest green with device execution. Promote to test/prod only
with explicit release authority. Recovery is by reverting the cutover commit,
not by retaining two active loop implementations indefinitely.
