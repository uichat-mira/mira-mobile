# Mobile CI gate

Mira Mobile exposes one stable Organization aggregate status: **Mira Gate**.

The layer-specific jobs remain visible for diagnosis. Mira Gate does not rerun their
checks; it evaluates their GitHub Actions `needs.*.result` values after all
dependencies have settled.

## Stage policy

| Trigger / branch | Required success | Explicitly not applicable |
| --- | --- | --- |
| Pull request | quality, Android debug build, iOS builds | Android signed release, dev publication, prod publication |
| push to `test` | quality, Android debug build, Android Maestro critical smoke, iOS builds | Android signed release, dev publication, prod publication |
| push to other non-release branches handled by this workflow | quality, Android debug build, iOS builds | Android Maestro critical smoke, Android signed release, dev publication, prod publication |
| push to `dev` | quality, Android debug build, Android signed release, iOS builds, dev publication | prod publication |
| push to `prod` | quality, Android debug build, Android signed release, iOS builds, prod publication | dev publication |
| manual `workflow_dispatch` on `dev` / `prod` | quality, Android debug build, Android Maestro critical smoke, Android signed release, iOS builds | dev publication, prod publication |
| manual `workflow_dispatch` on other branches | quality, Android debug build, Android Maestro critical smoke, iOS builds | Android signed release, dev publication, prod publication |

A required result must be `success`. A job classified as not applicable must be
`skipped`. Failure, cancellation, a missing result, or an unexpected skip makes
Mira Gate fail.

If a future job is added to Mira Gate's `needs` list without a policy entry, it
is treated as required by default. This prevents a new dependency from silently
becoming an optional green skip.

The policy evaluator lives in
`.github/scripts/evaluate-mobile-gate.cjs` and is covered by executable
Node tests. The workflow-level job uses `if: ${{ always() }}` so it still runs
when an upstream dependency fails or is skipped.

MOB-059 adds `Android Maestro critical smoke` as required T4 evidence on a
`test` push. The job reuses the Android debug artifact produced by the same
workflow/SHA; it does not rebuild the app per flow. Manual workflow dispatch also
runs this smoke so the harness can be exercised before promotion. MOB-060 may add
the iOS T4 job later and must classify it explicitly in the same stage policy.
