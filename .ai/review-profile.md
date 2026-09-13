# Mira Mobile AI Review Profile

Profile version: `mira-mobile-review-profile/v1`

This file contains only Mira Mobile-specific review rules. Organization-wide reviewer role, trust, severity, verdict, finding structure, stale handling, and publication behavior come from the Mira Organization AI Review policy and output contract.

## Product and authority boundaries

Mira Mobile has two intentional execution paths. Review changes against the path they actually affect.

### Remote Host

Mobile may pair/connect through Direct or Relay transport and consume Host-side sessions, durable Agent runs, and Tool Gateway capabilities. Host / Harness remains authoritative for server state, persistent Agent execution, tool policy, and actual remote tool execution.

Report a defect when a change newly or materially:

- moves Host/Harness-authoritative Planner, Tool execution, MCP, knowledge-base, server business truth, or Host credentials onto the device without an explicit contract change;
- fabricates successful pairing, approval, tool execution, unread/pinned state, or server status;
- bypasses the established client / adapter / protocol / runtime boundary from UI code;
- treats device-local state as account-global or cross-device truth;
- guesses Remote endpoints, fields, permission results, error codes, or server state instead of consuming the established contract.

For Remote/protocol changes, check external-data parsing, authentication, timeout/retry/reconnect, replay/idempotency where mutations are involved, pagination/cursor behavior, stale/partial data, and recovery after foreground/background or network changes.

### Local Provider

Mobile may securely store a user-provided Provider API Key, create device-local sessions, call the configured model directly, and run the established foreground Mobile Agent Loop. These are valid Mobile capabilities.

Report a defect when a change newly or materially:

- leaks Local Provider credentials to Host or moves Host Provider / Tool / MCP credentials to Mobile;
- bypasses the established secure credential store;
- creates a second incompatible Provider/Agent runtime instead of extending current adapter/runtime boundaries;
- introduces provider behavior through URL/vendor guessing where explicit configuration or adapter behavior is required;
- breaks local session lifecycle, streaming, cancellation, or source routing between Local Provider and Remote Host.

## React Native lifecycle and concurrency

Prioritize concrete failures involving:

- foreground/background transitions;
- reconnect/resume after network changes;
- stale async responses overwriting newer state;
- duplicate subscriptions, listeners, timers, or mutation replay;
- aborted requests updating unmounted or no-longer-current screens;
- persistence hydration races and invalid fallback state;
- navigation state losing IDs, ownership, source, run/thread identity, or current context.

## Android and iOS parity

When shared JS/TS or native configuration can affect platform behavior, reason about both Android and iOS. For native changes, inspect the relevant counterpart when present; otherwise record the unverified platform as a validation gap rather than assuming parity.

Pay particular attention to permissions and permission timing, camera/files/share/notifications, deep links and URL schemes, lifecycle hooks, manifests/plist/entitlements, Gradle/CocoaPods, signing, and generated native artifacts.

## Local persistence and state truth

For device-local sessions, pins, unread state, cached Remote data, or recovery pointers:

- use stable identifiers and preserve source ownership;
- do not clear or advance local state after failed authoritative reads unless the contract explicitly allows it;
- do not imply synchronization that does not exist;
- keep business state, network state, persisted device state, and transient UI state distinct;
- preserve recoverable data when a transient remote failure should not destroy the last known usable state.

## Security and privacy

Treat credential, pairing/auth, signing, and authorization-boundary regressions as high priority. Check that secrets are not committed, logged, surfaced in ordinary debug/UI state, copied across Remote/Local trust boundaries, or exposed to untrusted PR execution through CI.

External inputs such as pairing URIs, Host responses, Provider responses, deep links, and persisted data must be parsed/validated before becoming authoritative application state.

## CI, release, and branch behavior

The active promotion model is:

```text
feat/* -> dev -> test -> prod
```

`predev` is a repository-specific historical buffer and must not become a bypass around that chain.

For workflow/build changes, check least-necessary permissions, secret exposure to untrusted PR code, Android/iOS build assumptions, artifact integrity, version/channel isolation, signing, and whether the changed workflow preserves the intended environment boundary.

## UI and interaction behavior

Review behavior before visual preference. Check loading / empty / error / data states, navigation to the intended entity, coherent back behavior, consistent business truth across list/search/drawer views where required, and confirmation/recovery around destructive or irreversible actions.

Do not report subjective visual taste unless the change violates an explicit interaction or design contract.

## Mobile validation gaps

When relevant evidence is unavailable, call it out explicitly instead of inventing a code defect. Common Mobile-only gaps include:

- Android or iOS real-device behavior;
- camera/permission/deep-link behavior;
- real Host / Relay interoperability;
- real Local Provider compatibility;
- signing/release artifact verification;
- cross-repository protocol behavior.

A passing typecheck, lint, unit test, static review, simulator build, or one-platform build does not by itself prove those higher-level behaviors.

## Historical reviewer compatibility

The old local OpenCode review skill remains useful as migration reference, and CodeRabbit continues as an independent side reviewer during the pilot. The Organization reviewer does **not** retain the old `<!-- mira-mobile-review-skill:v1 -->` marker: that marker identifies the previous repository-local review output, while this profile preserves the Mobile-specific review semantics under the Organization output contract.
