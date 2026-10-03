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

## Execution record

Implementation and tests: pending. Publication and exact-head CI: pending. This document is a plan, not a PASS receipt.
