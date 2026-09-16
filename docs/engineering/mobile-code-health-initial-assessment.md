# Mira Mobile Code Health — Initial Assessment

Status: **Targeted hygiene activated / Broad refactor deferred**

Date: 2026-09-02

This document records an initial engineering judgment and does not replace current task cards.

## Maintainer update — 2026-09-06

After review of the dual-entry Local Provider foundation commit `7bc3556`, the maintainer explicitly authorized MOB-048 as a **narrow post-submission hygiene pass**. MOB-048 is limited to code introduced or directly disturbed by the dual-entry batch: dead code, obvious token violations, stale imports/branches, and test-quality cleanup after MOB-045/046/047 land.

This does **not** activate the broader Conversation orchestration, Host gateway, or App/navigation refactor proposals below. Those remain deferred and require separate future cards.

## Why this exists

Recent Mobile fixes have shown a pattern: automated checks can be green while product behavior still fails on a real device. The current working hypothesis is that this is not only a testing problem. Some important user capabilities have grown across multiple technical layers without a matching feature/orchestration boundary, which increases change-localization cost and makes partial fixes more likely.

The goal of this document is to preserve that judgment until the current Mobile feature work is closed, then perform a focused cleanup batch with explicit scope and acceptance.

## Observation

### 1. Conversation behavior is spread across several layers

The current chat path is approximately:

```text
Screen
  -> Mobile compatibility adapter
  -> Remote Host client
  -> transport
  -> protocol
  -> Desktop canonical contract
```

`ChatScreen` currently owns substantial conversation behavior in addition to UI state, including message history loading, optimistic send state, stream consumption, retry/error handling, canonical reload, read-state sync, search, attachments and transient interaction state.

`AgentChatScreen` adds another orchestration layer around the same conversation lifecycle for Agent Run state and approval actions.

This means a user-visible chat change can require reasoning across nested screens, API adapters, remote transport and local stores rather than one clear conversation boundary.

### 2. The Host client layer contains more than transport

`miraHostClient` is a compatibility adapter between older screen-facing contracts and Remote Host V1, but it also performs model conversion, capability checks, store side effects, runtime event handling and message snapshot publication.

`remoteMiraHost` separately owns pairing/credential restore, direct-vs-relay selection, manifest access, thread/message calls, SSE chat and Agent operations.

These responsibilities are individually understandable, but the boundary between compatibility, domain orchestration and transport has become expensive to trace.

### 3. Repository organization contains two different maturity styles

Older Mobile code is primarily organized by technical layer:

```text
screens/
api/
store/
components/
protocol/
```

Newer Shiyan code is more feature-oriented and contains its own client, playback, recording, confirmation and domain helpers under one feature area.

This is evidence that feature cohesion is already useful in the repository; the recommendation is not a rewrite, but to gradually apply clearer capability boundaries to the older high-change paths.

### 4. App composition is accumulating global knowledge

`App.tsx` knows about a large number of screens and also participates in bootstrap/connection restoration and global lifecycle composition. This is manageable today, but it is a likely future maintenance hotspot.

### 5. Protocol isolation is comparatively healthy

Remote Host protocol parsing/contracts are already separated and tested. They are not the first cleanup target. Refactoring protocol code without a concrete contract defect would add risk without addressing the current maintenance problem.

## Inference

The main issue is **not simply large files or a messy directory tree**.

The stronger explanation is:

> Feature behavior grew faster than ownership boundaries.

As a result, a seemingly small Mobile issue can cross several files and architectural layers. A code agent can therefore produce a locally correct patch while missing an integration behavior elsewhere in the runtime path.

This is consistent with recent repeated Mobile regressions, but it is not proof that every bug is architectural. Device interaction, incomplete E2E coverage and Host integration gaps are separate causes and must remain separate in diagnosis.

## Judgment

Mira Mobile does **not** need a broad rewrite.

It does need a focused hygiene pass on the highest-change boundaries after the current feature batch is closed.

Provisional cleanup order:

1. **Feature/runtime ownership map** — document the actual runtime path and owner for Conversation, Connection/Pairing, Shiyan, Update and navigation composition.
2. **Conversation orchestration extraction** — move load/send/stream/retry/stop/title/read synchronization out of `ChatScreen` into a clear conversation orchestration boundary while preserving behavior.
3. **Host gateway boundary cleanup** — separate screen compatibility concerns, domain/session orchestration, transport selection and protocol parsing more clearly; no protocol behavior change as a cleanup goal.
4. **App/navigation composition cleanup** — reduce global control knowledge in `App.tsx` only after the higher-value boundaries are stable.

These broad packages remain candidate work packages and are **not assigned MOB cards yet**. MOB-048 is intentionally smaller and must not be used as authorization to begin them.

## Guardrails for the future cleanup batch

- No behavior-changing refactor without a failing test, explicit requirement or separately reviewed contract change.
- Do not mix broad cleanup into an unrelated bug fix.
- Preserve Desktop/Host canonical ownership; Mobile must not absorb provider, Agent, RAG or business truth.
- Preserve existing Remote Host protocol behavior unless a dedicated protocol card says otherwise.
- Prefer extraction and boundary clarification over file churn or directory renaming.
- Each cleanup card must identify the runtime path before modifying it.
- Each cleanup card must add or preserve executable acceptance evidence, including E2E where the behavior is user-visible.

## Execution condition

The former blanket deferral is superseded only for MOB-048 by the maintainer decision on 2026-09-06.

MOB-045, MOB-046 and MOB-047 may proceed from the shared `7bc3556` base. MOB-048 must **not** run in parallel with them: it starts only after those correctness fixes are integrated into `dev`, then re-reads the latest code and limits itself to the dual-entry touched surface.

Any broader cleanup batch still requires a new maintainer decision, fresh review of `dev`, and separate task cards. No repository-wide rewrite is authorized.


## MOB-048 targeted cleanup execution — 2026-09-07

MOB-048 started from the latest `dev` after MOB-045/046/047 were integrated. The cleanup remains intentionally limited to the dual-entry touched surface.

The execution scope is:

- remove the dead Shiyan JSX branch left by the dual-entry batch;
- replace the newly introduced Shiyan tab border hard-coded color with the existing semantic border token;
- make the already-existing `deleteSession` capability explicit on `ConversationRuntime`, so `RuntimeRegistry` delegates to the selected runtime instead of repeating a second kind branch;
- strengthen executable `RuntimeRegistry` coverage for explicit Local/Remote source filtering;
- retain source-string contract tests only where they still verify UI wiring without an existing render-level behavior harness; store/runtime behavior continues to be covered by executable tests.

The broader Conversation orchestration, Host gateway, and App/navigation composition refactors remain **deferred**. MOB-048 does not authorize them.

MOB-048 completed via PR #102, squash-merged as `1f3b7938`. Its final scope stayed within the targeted cleanup above; no broad refactor was started.
