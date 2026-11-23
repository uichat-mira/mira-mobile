# Node 26 toolchain and Pi Core Mobile bridge (MOB-089)

Status: implementation candidate on a `feat/*` branch. Production behavior is
unchanged; the existing `MobileAgentLoop` remains the default Local Agent engine.

## Stage A: Node 26 LTS

The project-owned Node runtime is now Node 26 LTS (`26.13.1`, Node "Lithium",
released 2026-11-10). The update is intentionally limited to JavaScript
tooling; Android/iOS native toolchains were not changed.

Changed surfaces:

- `package.json` / `package-lock.json`: `engines.node` is `>=26.13.1 <27`.
- `README.md`: environment requirement is Node 26.x (>= 26.13.1, LTS).
- `.github/workflows/feat-ci.yml`, `mobile-ci.yml`, `predev-ci.yml`,
  `r2-release-truth.yml`: `actions/setup-node` pins `26.13.1` everywhere the
  repository uses Node.
- `.github/mira-validation-profiles.json` and
  `.github/scripts/node26-env.sh`: the repository-owned `mobile-feature`
  Validation Profile no longer searches for `*/22.*/x64/bin/node`. It resolves
  Node 26 from the runner tool cache, or downloads the official v26.13.1
  linux-x64 archive and verifies it against `SHASUMS256.txt` before use.

The Validation Profile is read from the Candidate **base SHA** by the trusted
verifier. The profile edit therefore applies to later Candidates; it cannot
retroactively change the validator that ran for this work item. This run's
trusted verification may still execute with the old Node 22 profile, so the
Node 26 evidence below was produced independently and must not be read as a
trusted-validator result.

### Stage A evidence (actual Node 26.13.1 runtime)

```text
$ node -v
v26.13.1
$ npm -v
11.20.0
$ npm ci
added 1010 packages, audited 1011 packages ... exit 0
$ npm run typecheck
tsc --noEmit ... exit 0
$ npm run lint
417 problems (0 errors, 417 warnings) ... exit 0
$ npm test -- --runInBand
Test Suites: 177 passed, 177 total
Tests:       1474 passed, 1474 total
```

The lint warning count matches the pre-existing baseline; no new errors were
introduced.

The lockfile is regenerated with the runner's npm 10.9.9 rather than npm 11.
npm 11 had written a `package-lock.json` that npm 10 rejected
(`Missing: ws@8.23.0 from lock file`), which would have broken the base-frozen
validator. Both npm 10.9.9 (`npm ci`) and npm 11.20.0 (`npm ci`) now install
from the same lockfile successfully.

As a compatibility check for this frozen round, the same candidate was also
run under the runner's Node 22.23.5 (the version the base profile resolves):

```text
$ node -v                      v22.23.5
$ npm ci                       exit 0 (EBADENGINE warning only)
$ npm run typecheck            exit 0
$ npm run lint                 0 errors, 417 warnings; exit 0
$ npm test -- --runInBand
Test Suites: 178 passed, 178 total
Tests:       1485 passed, 1485 total
```

That run is frozen-validator compatibility evidence, not Node 26 evidence.

After the Pi dependency was added, the same Node 26 runtime was used again:

```text
$ npm ci                       exit 0 (lockfile unchanged)
$ npm run typecheck            exit 0
$ npm run lint                 0 errors, 417 warnings; exit 0
$ npm test -- --runInBand
Test Suites: 178 passed, 178 total
Tests:       1485 passed, 1485 total
```

## Stage B: minimal Pi Agent Core bridge

Dependency: official `@earendil-works/pi-agent-core@1.6.0` (exact pin), which
pulls `@earendil-works/pi-ai@1.6.0` and `@earendil-works/pi-schema@1.6.0`.
No `pi-coding-agent`, Pi Durable, Cordis, Expo, or a second persistence layer
was added.

`pi-ai` declares provider SDKs (OpenAI, Anthropic, AWS Bedrock, Google GenAI,
and others) as regular dependencies, so `npm ci` installs about 80 additional
packages and pi-ai occupies roughly 42 MB in `node_modules`. Metro's actual
graph reaches only the core agent loop, transcript, schema, event-stream, and
telemetry modules; the provider SDKs are not bundled. This footprint is a
dependency-review risk, not a Mobile runtime dependency.

Implementation:

- `src/runtime/piAgentLoop.ts` runs Pi's real `Agent` loop (`agent.continue()`
  and the package's tool execution path). Mira supplies both boundaries:
  - `streamFn` translates Mira's existing `LocalProviderExecutor`
    `RuntimeEvent` stream into Pi `AssistantMessageEvent`s, and translates Pi's
    transcript back into Mira `OpenAiMessage`s for each model round.
  - Tools are exposed from the existing `ToolGatewayClient`; `execute` calls
    `gateway.callTool`, and approval uses the existing
    `ToolApprovalRequiredError` -> `requestApproval` -> `resolveApproval`
    contract. Rejection pauses the run instead of feeding a fabricated result
    to the model. Provider and tool failures reject the run, matching the
    existing loop so a partial answer is not persisted as a completed turn.
- `src/runtime/localAgentRunController.ts` selects the engine and still owns
  run token, abort signal, approval queue, and the shared `ConversationRuntime`
  event contract.
- `src/runtime/localProviderRuntime.ts` accepts an opt-in `agentLoopEngine`
  option. `src/runtime/localAgentEngine.ts` pins the production default to
  `mobile`; there is no user-visible switch. A Pi acceptance build changes that
  one constant (or constructs the runtime with `agentLoopEngine: 'pi-core'`).
- `src/runtime/localAgentEngine.ts` is deliberately the only selection point.

Safety boundaries retained:

- Provider API keys remain in the existing Local Provider credential store; Pi
  never receives them.
- Host credentials, tool ids, approvals, and results stay behind the existing
  Tool Gateway.
- Mailbox-sensitive tools (`sensitiveResult`) are not exposed by this
  experimental engine until the mail chaining policy is shared as a reusable
  contract. The run emits `toolset-degraded` so the reduction is visible.
- `hostSelectionRequired` fails closed with an explicit error; the Pi bridge
  does not select or guess a Desktop Host. The existing loop owns that policy.
- `maxToolRounds`, timeout, cancellation, app suspension, tool-result limits,
  and no-silent-success behavior follow the existing option names.

### Metro / ESM / Hermes notes

Pi ships ESM-only `exports` with no CommonJS fallback. Adaptations:

- `jest.config.js` maps Pi package roots to their built ESM files and allows
  Babel to transform `@earendil-works`.
- Metro bundles the packages through its normal ESM path.
- `node_modules/@earendil-works/pi-ai/dist/auth/context.js` contains a
  variable-specifier dynamic import for `node:fs/promises` that Metro cannot
  transform. `metro.config.js` replaces that module with
  `src/runtime/piAiAuthContextShim.ts`, which preserves the browser-safe
  contract (no env, no filesystem). Mira owns Local Provider auth, so Pi's
  provider-auth/model-catalog path is not used. This is a targeted
  compatibility shim, not a general Node polyfill.
- `@earendil-works/pi-ai/dist/utils/uuid.js` calls
  `globalThis.crypto.getRandomValues`; the current bridge does not exercise
  Pi's UUID path, but Hermes runtime availability of that API is not proven by
  the bundle check.

Bundle evidence produced locally with Node 26:

```text
$ npx react-native bundle --platform android --dev false --entry-file index.js \
    --bundle-output .tmp-metro-check/index.android.bundle --reset-cache
Done writing bundle output
Copying 21 asset files
Done copying assets

$ node_modules/hermes-compiler/hermesc/linux64-bin/hermesc -O -emit-binary \
    -out .tmp-metro-check/index.android.bundle.hbc \
    .tmp-metro-check/index.android.bundle
exit 0 (19.6 MB Hermes bytecode)
```

This proves Metro module-graph resolution and Hermes bytecode compilation. It
does not prove runtime behavior on a device.

## Tests

- `src/runtime/piAgentLoop.test.ts` exercises the real Pi loop with a fake
  provider and fake Tool Gateway. It covers streaming text, an approval-gated
  tool call -> result -> second model round, approval rejection, tool permission
  failure, provider failure, cancellation, approval timeout, malformed
  tool-call handling, sensitive-tool filtering, and controller wiring.
- `src/runtime/localProviderRuntime.test.ts` adds a `ConversationRuntime`
  integration test with `agentLoopEngine: 'pi-core'`, resolving approval through
  `runtime.resolveToolApproval` and asserting persisted assistant output. It
  also asserts the default engine remains `mobile`.

## Upstream / Cherry comparison

- Uses the official `pi-agent-core` `Agent` loop; no fork.
- Mira supplies `streamFn` instead of importing Pi AI provider adapters, so
  Provider credentials and wire protocol stay in Mira.
- No Expo, native OAuth, Cordis, Pi Durable, or plugin/persistence service.
- Cherry's Hermes/Metro research informed the ESM and dynamic-import risks; no
  AGPL code or architecture was copied.

## VALIDATION_GAP

- No Android/iOS device or emulator execution was performed. Hermes bundle
  compilation is not runtime evidence.
- Android/iOS native CI (Gradle/Xcode with `setup-node` 26.13.1) was not run in
  this worker; only the Metro Android JS bundle and Hermes bytecode were
  produced.
- The trusted verifier for this Candidate is frozen to the base SHA and may
  still use Node 22; the Node 26 evidence above is a separate, explicitly
  reported run.
- Pi's provider-auth, OAuth, model catalog, and UUID modules are not part of the
  bridge path and were not runtime-verified on Hermes.

## One-time maintainer Android acceptance checklist

1. Set `LOCAL_AGENT_ENGINE = 'pi-core'` in `src/runtime/localAgentEngine.ts`
   (or construct `LocalProviderRuntime` with `agentLoopEngine: 'pi-core'`) and
   build one Android candidate. Do not merge that switch as the default.
2. Local Provider plain text: send a prompt with Agent mode off; expect a normal
   streamed answer.
3. Agent text: enable Agent mode on a Local session with no tool need; expect
   streamed text and a completed turn.
4. Authorized tool: request a tool that requires approval; confirm the approval
   sheet, approve, verify the tool result reaches the model and the final
   answer continues.
5. Rejection: repeat and reject; verify the run pauses as
   `approval-rejected`, no tool result is invented, and no final success text is
   produced.
6. Cancel/suspend: start a long model or tool call, cancel from the UI, and send
   the app to background; verify `cancelled` / `app-suspended` pause behavior.
7. Rollback: set `LOCAL_AGENT_ENGINE = 'mobile'`, rebuild, and repeat the
   Local Provider text and Agent tool turn to confirm the existing loop still
   works.
8. Confirm no Host credential or Provider API key appears in logs, approval
   text, or rendered tool results.
