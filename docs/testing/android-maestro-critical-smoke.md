# Android Maestro critical smoke

MOB-059 establishes the first Android T4 black-box acceptance layer for Mira Mobile.

## Trigger and artifact identity

The stable workflow job key is `android-maestro` and its display name is
**Android Maestro critical smoke**.

It runs when:

- `test` receives a push; or
- Mobile CI is explicitly started with `workflow_dispatch`.

It does not rebuild Mira. The job has `needs: android`, downloads
`uichat-mira-mobile-android-debug` from the same workflow run, installs that APK
once, and records its SHA-256 in the evidence report.

## Runner

- Maestro CLI is pinned to `2.11.0`.
- Android emulator target: API 35 / Google APIs / x86_64 / Pixel 6 profile.
- Metro is started locally for the React Native debug artifact and exposed to the
  emulator through `adb reverse tcp:8081 tcp:8081`.
- The deterministic Host fixture listens on the runner and is reached by the
  emulator through `10.0.2.2`.

The suite executes each flow exactly once with a 150-second hard timeout. There
is no automatic retry.

## Host fixture boundary

`.github/e2e/host-fixture.cjs` implements only the published Mobile contracts
needed by critical smoke:

- `GET /health`;
- direct Remote Pairing V1 claim + poll with one-time credential delivery;
- `GET /remote/v1/manifest`;
- canonical thread list / detail / messages;
- capability-gated `POST /threads`.

Protected routes require the same Bearer device credential shape consumed by
Mobile. Pairing is driven through the public `mira://pair` Android deep link, so
the suite exercises production pairing parsing, secure credential storage and
manifest verification instead of pre-seeding client state.

This fixture is deterministic T4 evidence for Mobile behavior. It must not be
described as real Desktop / Relay cross-end evidence.

## Critical flows

Permanent flow names describe capabilities rather than task IDs:

- `00-pair-and-thread-list.yaml` — public deep link → authorization → secure
  pairing → canonical list becomes usable.
- `01-settings-navigation.yaml` — open Settings and enter the General page.
- `02-open-thread.yaml` — open the deterministic remote thread and read its
  canonical message history.
- `03-create-thread.yaml` — use the Drawer new-chat action, choose Remote Host,
  create a canonical thread and enter Chat.

## Evidence

The workflow uploads `uichat-mira-mobile-android-maestro`, containing:

- `report.md` with per-flow PASS / FAIL;
- `metadata.txt` with tested commit SHA, Maestro version, Android API and emulator identity;
- `apk.sha256` proving the exact reused build artifact;
- per-flow Maestro stdout/stderr;
- on failure: PNG screenshot, UI Automator hierarchy and flow-scoped logcat;
- full device logcat, Metro log and fixture log.

A flow failure makes the job fail after evidence collection. Later flows are
still attempted so the artifact shows the whole critical-smoke state instead of
only the first exit code.
