# P5 evidence stats completion

## Scope and specification addendum — 2026-10-03

Complete the existing issues #116–#125 together, rather than create more near-duplicate tickets. The baseline is `5faab62acd34eea79da66ac408d053a9f7e72397` (merged Recovery PR #55). This addendum applies the existing SPEC/METRICS contracts; it does not expand native provider support, introduce a new diagnosis, or complete parent #6.

The ten opt-in stats views are recovery distribution, observed chain resolution, failure admission, failure timing coverage, Read identity coverage, search identity coverage, invocation boundary coverage, Slow Tool candidates, Slow Tool partition coverage and provider-aware token-component presence. Existing unmerged per-view branches are retained as history. Publish one coherent completion PR because they all modify the same stats dispatcher.

## Findings before implementation

The incomplete `feat/failure-admission-coverage` branch uses `await import(...)` inside the synchronous pinned-store callback and omits its new result from `StatsResult`. Several planned views also stringify their analysis before JSON serialization. These are not qualified implementations. Dynamic imports must finish before entering the synchronous read transaction, and JSON must retain structured native analysis and its evidence IDs.

Ratios must preserve a known zero numerator but remain null for a missing/zero/unsafe denominator or unavailable assessment. An identity-incomplete but admitted population may expose its known missing-identity count; unsupported or provenance-unresolved populations may not become 0%/100% coverage. Token-component presence must distinguish provider-inapplicable components from missing applicable components; it is not overall usage coverage.

## Implementation and Verify

1. Add pure, bounded projections of the existing analyzer outputs, retaining native scope, suppression, partition reasons and denominators. No raw source or fingerprint fields enter the projections. **Verify:** positive/zero/null ratios, overflow, identity-unresolved versus provenance-unresolved, recovery resolved-only quantiles, provider-specific token fields, immutable output and deterministic ordering.
2. Add opt-in argument selection and lazy analyzer loading outside the pinned read transaction. Analyze one selected stored generation exactly once. **Verify:** all ten modes; pairwise conflicts with new and existing modes; false/omitted parity; duplicate CLI flags; source requirement; invalid options fail before storage access; no unsafe result casts or asynchronous transaction callback.
3. Add a bounded human formatter and structured JSON result carrying the unchanged selected native analysis. **Verify:** exact displayed fractions and units; full JSON proofs; explicit omitted-row counts; unsupported/null states; no global failure rate, savings, inferred error identity or provider-wide coverage claim.
4. Publish the completion draft with executed test results. **Verify:** local syntax/pure projection checks, repository typecheck/build/tests/artifact CI on the exact published head when available. Keep CI-pending and NOT RUN checks explicit. Do not merge or close broad product tickets.

## Ownership and verification limits

Owner: this ChatGPT continuation, human-readable attribution only. A runtime session UUID is not exposed and is not invented. No separate development/review subagent is available in this continuation; independent maintainer review remains required. The scope is the new evidence-view modules, their tests, stats-only changes in `src/cli/stats.ts` and `src/cli/main.ts`, and this plan. Other sessions' #5/#7/#50 ownership, parser/store/schema/CI/package versions, and prior source documents are preserved. Cloud GitHub Actions is the supported-runtime qualification path; the local container has Node 22 and no outbound repository access. No user logs are collected or uploaded.

## Initial execution record

At plan publication, implementation, tests and exact-head CI were pending. The executed receipt below supersedes that initial status without turning broader product work into completed work.

## Executed verification receipt — 2026-10-03

Published [Draft PR #126](https://github.com/WhiteKiwi/agentprof/pull/126) with source head `51c0ac1b09d782d0b19c6580b17172ec9c220614`. All five production/test file blobs matched the inspected local copies. The six-path diff is this document, `src/analysis/source-evidence-views.ts`, `src/cli/evidence-stats.ts`, stats-only changes in `src/cli/stats.ts` and `src/cli/main.ts`, and `tests/evidence-stats.test.ts`. The prior stats formatter text and unrelated commands were preserved.

Local Node22.16.0 pure harness: **226 passed, zero failures, zero skips**. It used synthetic native-analysis-shaped inputs and a SafeError dependency substitute; this is not a supported-runtime/full-product qualification. TypeScript syntax transpilation of five changed TS files had no syntax diagnostics; this alone is not typechecking.

Actual [Foundation run 37113193177](https://github.com/WhiteKiwi/agentprof/actions/runs/37113193177) completed successfully for source head `51c0ac1b09d782d0b19c6580b17172ec9c220614`: Node24.15.0, Node24.21.0, Node26.7.0 and the unsupported Node22 guard all passed. The Node26.7.0 job log confirms checkout of test-merge `63e100cdcbc7eb3d613d0b8537ed56b75dfba49e` combining the source with the stated main baseline, successful typecheck/build, **2,603 passed / 65 skipped tests across 92 files (90 passed, two skipped)**, and all **161 new evidence-stats tests executed and passed**. The unchanged artifact verifier reports **68 files**, scripts-disabled tarball npm-exec/global-install and synthetic read-only stats/insights/failure checks PASS, unpublished. These inherited artifact checks are not represented as dedicated installed tests of all ten new flags.

The new repository tests exercise real synthetic ordinary Codex ingestion, SQLite close/read and raw-input deletion for all ten API selections, an ordinary Claude Read/Grep boundary/identity positive case, exactly one pinned source read and selected analyzer, old-mode false/omitted output equality, actual built CLI selection and duplicate-option failures, structured JSON proof retention, provider-specific component presence, fraction/null/overflow and bounded human output. The 65 skips are inherited optional historical-baseline/installed environments; none of the 161 new tests is skipped.

This receipt commit changes documentation only. Its final-head CI is recorded separately in the PR. Independent maintainer review, merge, actual-user-log usefulness, complete maximum-size end-to-end JSON qualification, native browser QA, npm publication and broad #5/#6/#7/#8/#10/#50 acceptance remain separate and are not claimed completed here. Previously opened feature PRs are not automatically qualified or merged by this completion PR.
