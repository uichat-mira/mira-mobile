# Mira Mobile E2E Acceptance Plan

Status: **Documented / Deferred**

Date: 2026-09-02

This document records the intended E2E acceptance direction for Mira Mobile. It does not activate new CI work immediately and does not replace existing task-card validation.

## Goal

Move Mobile acceptance from:

```text
code looks correct
-> typecheck/lint/Jest green
-> build succeeds
-> product owner later finds interaction regression
```

into:

```text
feature work
-> dev integration
-> merge/promote to test
-> build once per platform
-> execute black-box interaction flows
-> collect report/evidence
-> only then treat user-visible behavior as accepted
```

The E2E layer should cover repeatable interaction behavior that does not require a human to judge feel or hardware-specific behavior.

## Proposed stack

Initial implementation choice:

- **GitHub Actions** as execution environment.
- **Maestro CLI** as black-box mobile E2E runner.
- **`test` branch** as the primary E2E trigger point.
- Existing Android/iOS build jobs should be reused or extended rather than rebuilding once per task card.
- Test output should include machine-readable results plus human-readable failure evidence.

Do not adopt a paid mobile-device cloud for the first version. Do not add predictive/ML test selection before the repository has meaningful E2E history.

## Why `test`, not every task card

A task card is a unit of change. A test is a durable statement about product capability.

Therefore tests should be organized by capability, for example:

```text
e2e/
  threads/
    create-thread.yaml
    swipe-actions.yaml
    delete-thread.yaml
  chat/
    send-message.yaml
    retry-message.yaml
  settings/
    open-plugins.yaml
  shiyan/
    record-confirm.yaml
    playback-seek.yaml
```

Do **not** create test files whose identity is a task number such as `MOB-025-test.yaml`. MOB-025 can close; the thread swipe behavior must remain protected.

Task cards/PRs remain useful as change provenance when a regression appears.

## Execution model

### Feature / PR level

Keep fast gates:

```text
npm run typecheck
npm run lint
npm test -- --runInBand
```

Add only targeted integration tests where needed. Do not start a full simulator fleet for every small card.

### `dev`

`dev` remains the integration branch. Code can be merged after the normal code/contract review rules, but user-visible cards must not be treated as fully accepted solely because `dev` CI is green.

### `test`

A push/merge to `test` triggers the E2E acceptance workflow.

Target flow:

```text
test SHA
  -> quality gates
  -> Android build artifact
  -> iOS simulator build artifact
  -> Android E2E suite(s)
  -> iOS E2E suite(s)
  -> aggregate verdict
  -> publish report/evidence
```

Build artifacts should be reused by multiple E2E suites where practical. A capability test failure should not cause an unrelated suite to rebuild the application from source if the same build artifact is still valid.

The existing `mobile-ci.yml` already watches `test` and already produces Android debug and iOS simulator build artifacts. The E2E implementation should build on that fact rather than create an entirely separate duplicate build pipeline.

## Initial test suites

Start small. The first useful suite should protect the product paths that have recently generated repeated regressions.

### Critical smoke

- App starts to a usable state.
- Pairing/connection state is presented correctly for the configured test fixture.
- Thread list opens.
- A thread can be opened.
- New thread flow can enter the canonical chat path when the test Host fixture allows it.
- Settings opens and important rows are tappable.

### Conversation / Drawer

- Swipe action can reveal thread actions on the supported platform fixture.
- Open/close swipe state does not block vertical list interaction.
- Pin/unpin presentation updates.
- Delete confirmation appears and cancel remains non-destructive.
- Drawer navigation remains usable.

### Shiyan

Only add flows after the relevant Shiyan UI/task contracts are stable. Prioritize deterministic UI/navigation flows before real Provider or long-recording scenarios.

## Test data and Host strategy

E2E must not depend on an unpredictable personal Desktop session.

The implementation card must decide and document a deterministic fixture strategy, likely one of:

1. a controlled test Host/service fixture exposing the published Mobile contract; or
2. a local/stubbed contract-compatible test server started inside CI for flows that do not require real Desktop/native integration.

Real Desktop/Relay/Provider interoperability remains a separate integration smoke where appropriate.

The E2E suite must not invent server behavior that contradicts the canonical Desktop contract.

## Evidence contract

Each `test` run should produce at least:

- overall PASS / FAIL;
- individual flow results;
- JUnit or equivalent machine-readable result;
- failure screenshot where supported;
- runner/app logs relevant to the failed flow;
- video/recording where practical and stable;
- tested Git commit SHA;
- platform/device/simulator identity.

A failed user-visible interaction must not be summarized merely as `exit code 1` when richer evidence is available.

## Email / notification expectation

The product owner wants a test report notification after Mobile changes reach `test`.

First implementation should prefer GitHub-native workflow notifications and keep the notification surface simple:

```text
Mira Mobile test: PASS / FAIL
Android: summary
IOS: summary
failed flow(s), if any
link to workflow/report artifacts
```

Do not add SMTP credentials or a third-party reporting SaaS in the first version unless GitHub-native notification proves insufficient.

The repository should keep the detailed report/artifacts in the workflow run; email is the attention signal, not the canonical evidence store.

## Regression attribution

Do not encode task-card IDs into permanent test names.

When a `test` run regresses, attribution should use source-control evidence:

1. record the last fully green `test` SHA;
2. compare last-green SHA to the failing SHA;
3. list commits/PRs and changed files in that interval;
4. correlate the failing capability area with touched files and PR scope;
5. report one or more **suspect changes**, with evidence and confidence, rather than declaring a task guilty without proof.

Example:

```text
FAIL: threads/swipe-actions

Suspect changes:
- PR #xx / MOB-xxx — high relevance: SessionSwipeRow.tsx changed
- PR #yy / MOB-yyy — medium relevance: SessionListScreen.tsx changed

Evidence:
- failure screenshot
- flow log
- current SHA
- last green SHA
```

Later, if enough historical E2E data accumulates, test-impact selection can be considered. It is explicitly out of scope for the first implementation.

## Acceptance semantics after E2E exists

Recommended minimum semantics:

| Change type | Minimum acceptance evidence |
| --- | --- |
| pure parser/domain/helper | unit/integration + CI |
| ordinary UI/navigation/state | automated E2E on supported simulator/emulator + CI |
| gestures/native recording/playback/permissions/network lifecycle | E2E where deterministic **plus** real-device smoke when device behavior is material |
| Desktop <-> Mobile canonical integration | explicit cross-end smoke against real compatible Host when required |

A `validation gap` may remain visible in `REVIEW`; it must not be converted into `PASS` by wording.

## Cost / simplicity principles

- Reuse one build artifact across multiple flows where practical.
- Run full E2E primarily at the `test` integration boundary, not once per task card.
- Keep the initial flow count small and high-value.
- Avoid paid device clouds until local hosted runners are proven insufficient.
- Avoid elaborate dashboards; GitHub run summary + artifacts are enough for the first version.
- Flaky tests are defects in the acceptance system and must not be normalized with unlimited retries.

## Deferred execution condition

Do not implement this E2E system in the middle of the currently closing Mobile feature work.

The product owner requested that the E2E harness and code-hygiene work be handled as one concentrated engineering-governance batch after the current active feature card/batch finishes.

At that point:

1. re-check the latest GitHub Actions workflows and Mobile branch/release rules;
2. create a dedicated E2E infrastructure card;
3. land the smallest Android-first critical smoke if cross-platform setup would otherwise delay useful coverage;
4. add iOS simulator coverage immediately after the harness proves stable;
5. only then change task-card PASS rules to depend on the new E2E evidence.
