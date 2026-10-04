# Exploration report implementation and qualification

## Scope and reservation amendment — 2026-10-04

Issue #152 follows the pre-code `P6-EXPLORATION-REPORT.md` plan at b92651f40b175616ce00a04f48c046f0bce0f82c. The immutable source baseline is actual main d1b84f166eb33f11d5b7a22ca407dbf14226fd24, which already includes the independently reviewed PR151 INFO correction and PR150 fresh workflows. The temporary tracked-source snapshot at 7a9dc3193b98aeca1fa0a075a7c7fa7c0a882248 has tree b17e7b7edf2ec9b33d8b23033d71128f170d0240; the extracted local tracked tree was checked against that tree before implementation.

The active issue #5 directory-membership owner also reserves the maintained SPEC/FINDINGS/IMPLEMENTATION/ACCEPTANCE append areas. To avoid overlapping that work, this PR retains the specification, findings, reviewed implementation and executed Verify in its two scoped documents instead. Local shared-document proposals were restored to baseline and were never published. This reduction of the original documentation scope is recorded in issue #152 comment 5975783384. No #5 source, tests, schema or membership changes are taken.

Final product delta: `src/report/unified-model.ts`, `src/report/unified-page.ts`, new `src/report/exploration-section.ts`, and two new `tests/exploration-report*.test.ts` files. The original plan plus this qualification document are the only final documentation changes. Existing tests, analyzers, parsers, CLI, scanner, store, design, dependency pins, and Foundation workflow remain unchanged.

## Implemented contract

- The existing stored and fresh `report --unified` paths compose the unchanged exploration analyzer from their transaction-pinned source. The native result is retained rather than recomputed or interpreted as a generic stats view. Provider, source identity, parser version, revision and completed/observed byte bounds must match the report envelope.
- The overview and navigation expose the exploration assessment. The dedicated section displays native closed-window thresholds, full-population state/reason counts, bounded per-session eligibility, first qualifying candidates, repeated-request group counts, selected event aliases and owned proof counts. Full JSON remains available through `insights --exploration --json`.
- Session and event aliases reuse the other report sections' maps. Durable source/session/event/proof IDs and lookup keys are not serialized into the new section. All selected references are checked, including references on omitted cards. Native INFO severity and empty Detected Waste event membership are enforced.
- Display limits are twelve partitions, twelve candidates, twelve repeated groups and twelve event aliases per candidate. Counts are calculated before clipping and omissions are explicit. The final existing 1 MiB HTML ceiling remains enforced. Null candidate populations and unavailable counters stay unavailable, not zero.
- The unchanged native thresholds are 600000 ms closed windows, at least twenty completed native lookups, at least five matching exact searches, at most one intersecting Edit/Write and no intersecting opaque action. The HTML does not infer content equality, inefficiency, root cause, productivity or savings. It renders the necessary-work counterexample, investigation, suggested matched experiment and quality guardrail even without a candidate.
- Default non-unified reports and existing analysis CLI output are unchanged. Exploration does not alter pattern membership, detected-waste intervals, time attribution or any source data. Its current provider support remains exactly the native analyzer's support, not an expanded HTML-specific contract.

## Executed local verification

Environment: Node 24.21.0, Linux x64. Strict TypeScript check and normal build pass. The full run used one Vitest worker and a 512 MiB Node old-space limit. The genuine historical schema5 build at 5614a3107b53022f29ea32d44ba83f533fd58b92 was supplied; the remaining optional historical/installed cases were not silently substituted or counted as executed.

| Check | Executed result |
| --- | --- |
| New report model/render suite | 32 PASS, 0 FAIL, 0 SKIP |
| New real source/fresh/built/installed CLI suite | 10 PASS, 0 FAIL, 0 SKIP |
| Full regression | 4544 PASS, 0 FAIL, 138 inherited conditional SKIP; 4682 total cases across 152 test files |
| Existing artifact verifier | PASS; 137 artifact files, scripts-disabled npm-exec/global install and stored stats/insights/failures parity; published:false |
| Genuine baseline comparison outside Vitest | Two CLI calls: actual pre-feature main-d1 build versus candidate non-unified report; stdout/stderr/exit/41568-byte HTML and private DB/key names, modes and bytes all equal |

The new tests cover exact native analysis equality and one direct analyzer invocation; parser/provider/source/revision/prefix mismatch rejection; empty, insufficient, no-candidate, candidate, opaque-blocked, missing identity/boundary, unsupported-provider and unavailable-source states; all-population reason counts before display clipping; alias validation on omitted evidence; INFO/waste guards; text escaping and the final HTML bound; deterministic input permutations; real persisted/raw-deleted sources; all three Claude capture modes; actual fresh and stored public binaries; revision-change refusal; no-overwrite; Codex unsupported output; and scripts-disabled installed-package parity for both providers and all three capture modes.

The actual installed case compares the built and installed JSON receipts, stdout/stderr/exit, HTML and the existing/new insights outputs. It removes the synthetic raw input before subsequent stored reads and checks DB/key bytes remain unchanged. Partial parser coverage is preserved rather than relabeled healthy. No actual user logs, private tokens or computer access were used.

Local public-registry DNS was unavailable. Package installation controls used a loopback registry serving only the existing pinned Commander 15 package, with matching integrity metadata; no dependency or lockfile was changed. This is not normal-registry qualification. The unmodified hosted Foundation CI must separately qualify its normal-registry frozen scripts-disabled installation. Local, focused and hosted counts are never summed to inflate the number of unique tests.

### Maximum validated native populations

All five cases pass the real stored-source validation before report construction; complete native evidence remains unmodified. The measured byte counts apply to these fixtures, not an empirical performance benchmark or a claimed absolute mathematical maximum.

| Population | HTML bytes |
| --- | ---: |
| 4096 tied events, 8192 native proofs | 59218 |
| 4096 unique searches | 57451 |
| 4096 single-event sessions | 94385 |
| 4000 events across 200 candidate sessions | 117793 |
| 4096 events with missing search identity | 57677 |

The final writer still rejects an actual generated document above 1048576 bytes rather than truncating native evidence.

### Actual Chromium rendering controls

A generated 58711-byte enriched Claude report was rendered with Chromium at 320x900 and 1440x900, in both light and dark color schemes, with reduced motion and an offline browser context. All four controls exercised real keyboard navigation to the exploration anchor, six focusable table regions with matching accessible captions, no document-wide horizontal overflow, no page errors and zero external HTTP requests. The 320px dark and 1440px light screenshots were visually inspected. These are four browser configurations, not four additional Vitest cases.

Direct `file://` navigation was blocked by the browser environment's administrator policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). The executed rendering controls used `page.set_content` with the actual generated HTML instead; the policy was not bypassed. This does **not** qualify real file-scheme navigation, OS opener behavior, native print/cancel, actual browser zoom, screen-reader usability, macOS/Windows or full accessibility acceptance. Those gates remain separate. The existing offline HTML and CSP contracts were not changed.

### Retained initial failures and corrected test expectations

Before implementation, a new gap control failed because the pre-feature unified model has no exploration member; this demonstrates the missing connection, not an existing product regression.

The first expanded suite ran 30 passing and two failing new cases. One missing-boundary fixture incorrectly retained a paired interval scope and was rejected by the real stored-source validator; the fixture now explicitly marks the interval unknown and still passes through that validator. The second expectation guessed `unsupported_metric_contract` for Codex instead of the actual native reason `unsupported_provider`; the expectation now matches native authority. No detector, existing test, privacy bound or product output was weakened. All 42 new cases subsequently executed successfully in the complete run.

## Publication and independent review

Publish the locally qualified UTF-8 product/test/document delta using a branch-only mechanical transport when ordinary git network access is unavailable. Validate the decompressed patch SHA256, its exact six-path product/test/qualification allowlist and every resulting Git blob. Remove the staging payload, the publisher workflow and the temporary snapshot workflow from the final tree, then perform only a non-force push to `feat/exploration-unified-report`. A concurrent remote branch change must fail rather than be force-replaced. Keep the pre-code plan unchanged. No credentials, `.git`, dependency directories, environment files, generated private stores or raw logs are part of the patch.

Exact published-head Foundation results and the actual tested synthetic-merge SHA are recorded in the PR after observation, not preclaimed here. Independent maintainer review and latest-main composition remain required before authorized merge. Do not close broad #6/#7 acceptance. The directory-membership and subsequent automatic deletion/move integration stay with issue #5's owner; native browser/usefulness/performance/release acceptance remain separate.
