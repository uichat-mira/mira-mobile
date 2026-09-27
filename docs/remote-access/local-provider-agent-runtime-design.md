# Mobile Dual-Entry and Local Provider Agent Runtime Design

Status: Tracked by MOB-037 (DOING, Phase A)
Date: 2026-09-05
Scope: `uichat-mira-mobile` client architecture and interaction design

## 1. Decision Summary

Mira Mobile will expose two conversation sources behind one stable task-list UI:

- **Remote Host**: a paired Mira Host owns provider configuration, agent execution,
  server-side session state, and remote tool policy.
- **Local Provider**: the phone connects directly to a user-configured
  OpenAI-compatible provider. The phone owns the local conversation and may run a
  bounded foreground agent loop.

"Local Provider" means direct provider access from the phone. It does not mean
that a large language model, a desktop shell, or the complete Mira Host runtime
is installed on the phone.

External tools for the Local Provider path are remote-first in V1. The mobile
client must call a Mira-approved Tool Gateway or another explicitly agreed remote
MCP adapter. It must not spawn arbitrary local MCP processes, shells, or scripts.
When a concrete remote invocation requires human approval, that approval interaction
is completed on Mobile; the remote Gateway / Runtime remains authoritative for
policy validation and actual execution.

Long-running, background, approval-heavy, or resumable agent jobs remain owned by
Mira Host or a Pi/agent sidecar. The phone can observe and control those jobs.

## 2. Context and Problem

The current mobile client is organized around a paired Remote Host. Its session
list, chat stream, agent status, and approval actions are remote-specific. The
product direction adds a second path in which the phone talks directly to an
OpenAI-compatible provider while preserving the current list, chat, drawer,
search, settings, and creation interactions.

The design must avoid three kinds of accidental coupling:

1. A provider connection must not be treated as a Mira Host connection.
2. A mobile foreground agent loop must not be mistaken for durable server-side
   execution.
3. MCP tool access must not require placing arbitrary tool credentials or local
   process execution inside the mobile app.

## 3. Goals

- Keep the current session-list and chat interaction model recognizable.
- Add Remote Host and Local Provider as explicit, independently managed sources.
- Support OpenAI-compatible chat completions in V1.
- Support standard streaming text and standard `tool_calls`.
- Allow a bounded foreground agent loop on the phone.
- Route external tools through a remote MCP/Tool Gateway.
- Keep provider keys, Host credentials, and Tool Gateway credentials separate.
- Make cancellation, timeout, provider failure, tool failure, and reconnect
  visible and actionable.
- Leave room for Pi or another durable Agent Runtime without coupling the mobile
  UI to a specific runtime implementation.

## 4. Non-Goals for V1

- Running a large language model inside the Android or iOS application.
- Installing the full Pi/PiLoop desktop environment in React Native.
- Local shell, JavaScript, Python, Git, worktree, or arbitrary file execution.
- Starting arbitrary MCP server processes from the phone.
- Background execution guarantees after the app is suspended or terminated.
- Multimodal provider requests, audio models, batch jobs, or provider-specific
  response event formats.
- Reimplementing Mira Host provider management, model keys, or business rules.

## 5. Terminology

### Provider

An OpenAI-compatible model endpoint. It supplies model inference and returns
text, structured tool calls, and streaming deltas. It is not responsible for
Mira session persistence or mobile UI state.

### Agent Runtime

The execution engine that calls a model, interprets tool calls, invokes tools,
feeds tool results back to the model, and repeats until the run finishes,
fails, is cancelled, or reaches a policy limit.

### Pi Runtime

The Pi implementation of an Agent Runtime. In this document the term means a
Pi process or SDK-backed service that can be reached through a stable RPC or
HTTP/WebSocket adapter. It does not imply that Pi is bundled into the mobile
binary.

### Tool Gateway

The remote boundary through which the mobile client accesses approved MCP tools.
The concrete route, authentication model, discovery payload, and approval
contract are still Mira protocol questions and must not be invented in the
mobile screen layer.

## 6. Runtime Placement

### 6.1 Remote Host path

```text
Mobile UI
  -> Remote Host adapter
  -> Mira Host session and Agent Runtime
  -> Host-configured Provider
  -> Host-configured MCP/tools
```

This path continues to use the existing paired credential, canonical Host
session state, stream contract, and remote Agent Run approval APIs.

### 6.2 Local Provider conversation path

```text
Mobile UI
  -> Local Provider adapter
  -> OpenAI-compatible Provider
  -> Local session store
```

The phone owns the local transcript and can continue a normal foreground
conversation when the provider is reachable.

### 6.3 Local Provider bounded agent path

```text
Mobile UI
  -> Mobile bounded Agent Runtime
  -> OpenAI-compatible Provider
  -> Remote Tool Gateway / MCP adapter
  -> Mobile bounded Agent Runtime
```

This runtime is intentionally small. It can execute a limited number of tool
rounds while the app is active. It must stop at a timeout, cancellation, app
suspension boundary, provider error, tool error, or loop limit.

### 6.4 Durable agent path

```text
Mobile UI
  -> Mira Host or Pi Runtime RPC adapter
  -> Durable Agent Runtime
  -> Provider and remote MCP/tools
```

Durable execution is the required placement for long-running work, approval
pauses, background continuation, queueing, retry orchestration, or recovery
after the app is killed.

For Remote Host V1, MOB-043 freezes the durable wire contract as follows:

- Agent Run creation stays inside the existing persisted `POST /proxy/chat/default`
  flow. There is no standalone Mobile run-creation endpoint.
- The Host persists an Assistant Message with `metadata.agent.runId` as soon as
  the Run starts, then keeps the canonical Assistant Message and AgentRun state
  updated independently from the phone's SSE connection.
- Mobile reads and controls the Run through the manifest-advertised
  `GET /agent/runs/:runId`, `approve`, `reject`, and `cancel` routes.
- V1 reconnect is canonical-state replay. Because the manifest advertises
  `eventCursor: false`, Mobile observes durable Run changes by bounded polling;
  it must not claim lossless event replay.
- Leaving the foreground stops only Mobile observation. It does not cancel the
  Host Run. Returning to the app re-reads canonical Messages, recovers the
  stable Run id, then reloads Host state.
- A Local Provider session is not silently migrated into this path. Until a
  transcript/provider handoff contract exists, durable work must use an explicit
  Remote Host session. Mobile Provider keys stay on Mobile; Host Provider and
  Tool/MCP credentials stay on Host.

## 7. Mobile Agent Runtime Contract

The screen layer must depend on a runtime-neutral contract rather than directly
calling HTTP, SSE, or a provider SDK.

```ts
type RuntimeKind = 'remote-host' | 'local-provider';

interface ConversationRuntime {
  readonly kind: RuntimeKind;
  listSessions(): Promise<Session[]>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  sendMessage(
    sessionId: string,
    input: string,
    options?: { agentEnabled?: boolean },
  ): Promise<AsyncIterable<RuntimeEvent>>;
  cancelActiveRun(): void;
}
```

The runtime event model should be able to represent at least:

- text delta
- tool call requested
- tool call in progress
- tool result received
- approval required
- run completed
- run failed
- run cancelled
- run paused because the app lost its execution window

The exact wire protocol is intentionally not defined here. Remote Host events
must continue to follow the existing Host contract. Local Provider events must
be normalized at the adapter boundary.

## 8. OpenAI-Compatible V1 Surface

The first local adapter should target the common Chat Completions subset:

- `POST /v1/chat/completions`
- `model`
- `messages`
- `stream`
- `temperature`
- `max_tokens` where supported
- `tools`
- `tool_choice`

The adapter should normalize the common streaming fields:

- `delta.content`
- `delta.tool_calls`
- `finish_reason`
- SSE `data: ...`
- `data: [DONE]`

Provider-specific extensions must stay inside the provider adapter. They must
not leak into `ChatScreen`, the unified session list, or the generic runtime
event model.

## 9. Tool Boundary

The mobile client may send a tool request only after validating the model's
tool name and JSON arguments against the tool manifest available from the
approved remote boundary.

The V1 mobile policy is:

- no local process tools;
- no arbitrary URLs supplied by a model;
- no tool credentials embedded in message metadata;
- no silent approval for destructive operations; approval-required invocations are presented on Mobile for explicit approve/reject;
- tool calls are cancellable where the remote contract supports cancellation;
- tool results are treated as untrusted data and are size-limited before being
  added to the next provider request.

The Tool Gateway protocol remains a separate contract. Before implementation,
Mira Host must define discovery, authentication, tool naming, argument schema,
approval, timeout, result, and error semantics.

## 10. Provider and Credential Storage

Provider configuration is separate from paired Host credentials.

```ts
interface LocalProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  protocol: 'chat-completions';
  toolGatewayId?: string;
}
```

The API key is stored separately in platform secure storage and is never part of
the ordinary JSON configuration or debug logs.

Required validation:

- reject embedded URL credentials;
- require HTTPS in production builds;
- allow HTTP only in an explicit development mode;
- do not display the full key after saving;
- clear the key independently from Host pairing credentials;
- redact authorization headers and tool arguments in diagnostics.

## 11. Interaction Design

The existing session list remains the primary screen. The header title becomes a
source selector with three options:

```text
全部任务
远程 Host
本地 Provider
```

The selector is a compact sheet or menu, not a new navigation stack. Each row
shows a source icon and concise source label so mixed results remain clear.

Creation behavior:

- Remote Host selected: create a Remote Host session.
- Local Provider selected: create a Local Provider session.
- All selected: ask the user to choose the source before creating.

The chat header shows the active source and model/Host name. Existing message
rendering, composer, cancellation, search, pinning, and settings remain shared.

The UI must distinguish these states with text and icons, not color alone:

- Provider unavailable
- Host disconnected
- Tool Gateway unavailable
- Agent paused because the app was suspended
- Agent waiting for approval
- Agent cancelled

## 12. Lifecycle and Reliability Rules

The mobile runtime must treat app suspension as a real boundary:

- foreground runs can stream and execute bounded tool rounds;
- entering background requests cancellation or persistence of a resumable local
  run, depending on the runtime capability;
- the app must not claim that a local run continued while suspended;
- a resumed screen reloads canonical local state before offering retry/continue;
- durable continuation is delegated to Host or Sidecar.

Initial limits for the mobile bounded runtime should be configurable constants,
with conservative defaults:

- maximum tool rounds: 8;
- per-provider request timeout: 60 seconds;
- overall foreground run timeout: 5 minutes;
- maximum tool result bytes added to context: implementation-defined and tested;
- one active local run per session.

These are product defaults, not a provider protocol. They may change after
device tests and real Tool Gateway measurements.

## 13. Proposed Module Boundaries

```text
src/runtime/
  conversationRuntime.ts       # runtime-neutral interface and events
  runtimeRegistry.ts           # selects Remote Host or Local Provider
  mobileAgentLoop.ts            # bounded foreground loop

src/provider/
  openAiCompatibleClient.ts     # provider HTTP/SSE adapter
  providerConfigStore.ts        # non-secret config
  providerCredentialStore.ts    # secure API key storage

src/tools/
  toolGatewayClient.ts          # remote contract adapter, once defined
  toolPolicy.ts                 # allow-list, schema, limits, approval

src/local/
  localSessionStore.ts          # local transcript and run state
  localSessionRepository.ts
```

### 13.1 Implemented bounded-loop boundary

`src/runtime/mobileAgentLoop.ts` now provides the protocol-neutral foreground
loop used by `LocalProviderRuntime` when `agentEnabled` is explicitly enabled
and a `ToolGatewayClient` is injected. The loop exposes a conservative maximum
of eight tool rounds, an overall timeout, cancellation, tool-result truncation,
and an explicit `run-paused` event when the app loses its foreground execution
window. `src/tools/toolGatewayClient.ts` remains an adapter contract only:
endpoint, authentication, discovery, approval, and MCP transport are not
invented by the mobile client.

The existing Remote Host client remains behind the runtime interface. No screen
should import both the remote client and the local provider client to decide
which transport to use.

## 14. Delivery Phases

### Phase 0: Contract and design

- Confirm the OpenAI-compatible subset.
- Confirm Tool Gateway ownership and protocol.
- Confirm whether local transcripts are device-only or exportable.
- Add tests for source selection and runtime routing.

### Phase 1: Local text conversation

- Add provider configuration and secure API key storage.
- Add Local Provider adapter with streaming text.
- Add local session persistence.
- Add source selector without agent tools.

### Phase 2: Bounded mobile tool loop

- Add normalized `tool_calls` parsing.
- Add remote Tool Gateway adapter after its contract is approved.
- Add loop limits, cancellation, timeout, and tool-result size limits.
- Add foreground-only run state and explicit suspension behavior.

### Phase 3: Durable runtime integration

- Add Host or Pi Runtime RPC adapter.
- Add pause/resume and approval synchronization.
- Reuse the same UI runtime events and source labels.

## 15. Acceptance Criteria

- A user can switch between Remote Host and Local Provider without leaving the
  main task-list flow.
- A local conversation never calls the Remote Host session API.
- A remote conversation never stores a provider API key in the Host credential.
- Local streaming text renders incrementally and can be cancelled.
- A standard tool call either reaches the approved remote Tool Gateway or fails
  with a visible actionable error.
- The app clearly reports when a foreground local run stopped because the app was
  suspended.
- No local runtime path can execute arbitrary shell, script, or MCP processes.
- Existing Remote Host pairing, session, streaming, and approval behavior stays
  regression-tested.
- Android and iOS secure storage, foreground cancellation, and resume behavior
  are tested on real devices before the feature is considered complete.

## 16. Open Questions Requiring Maintainer Confirmation

Resolved product decisions:

- V1 tools are remote-first; Mobile does not add a local tool execution surface.
- Human approval for approval-required remote tool invocations is completed on Mobile.

Remaining questions:

1. Is the first Tool Gateway a Mira Host endpoint, a standalone service, or both?
2. Which authentication method does the Tool Gateway use for a local Provider
   session?
3. Are local transcripts device-only, exportable, or syncable through Mira Host?
4. Should a provider API key be entered manually only, or may the app import a
   provider profile through a QR/deep link?
5. Does a paused mobile run resume by replaying the full transcript, or must it
   be handed to a durable Host/Pi Runtime?
6. Which models and context limits are supported in the first device matrix?

Until these questions are answered, the mobile implementation must use adapter
interfaces and test doubles rather than guessing Mira protocol fields or
endpoints.

## References

- OpenAI Agents SDK running agents and runner loop:
  https://developers.openai.com/api/docs/guides/agents/running-agents
- OpenAI Agents SDK human-in-the-loop state:
  https://openai.github.io/openai-agents-python/human_in_the_loop/
- Pi SDK documentation:
  https://pi.dev/docs/latest/sdk
