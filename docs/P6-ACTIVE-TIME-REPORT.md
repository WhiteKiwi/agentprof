# Observed turn Active Time in the unified report

## Specification draft — 2026-10-04 UTC

Parent scope: P6 issue #7, with the already implemented P5 Active Time contract from issue #58. This is a missing presentation connection, not a new metric or diagnostic. The immutable report prerequisite is draft PR #154 at `596bd0842ae1c84735fb44469c677d6ba2eff0e1`; main is currently `d1b84f166eb33f11d5b7a22ca407dbf14226fd24`. PR #154's author explicitly released its implementation reservation; independent review/integration/merge remains pending. Preserve its complete exploration result and all other report domains.

The existing `report --unified` stored and fresh flows should include the unchanged `analyzeSourceActiveTime` result from the same transaction-pinned source. Show supported native turn interval union and observed span separately, grouped by session and interval scope/evidence. Recorded turn duration never supplies positioned endpoints. Union excludes gaps; span includes gaps. Completed/cancelled native turn evidence, source/shape/coverage/unsupported reasons, excluded populations, numeric-overflow nulls and genuine zero values retain the analyzer's meaning.

Display one Active Time assessment in the overview and a linked detail section. Use the report's existing session aliases and escape all text. Compute population/omission counts before display caps. The report must never pool incomparable sessions/contracts, infer CPU/task time, fabricate complete history, infer waste/savings or silently activate capture. Complete native evidence remains available through the existing `stats --active-time --json` command. Unknown/unavailable is not zero.

The overview and section retain `activeTimeAssessmentReason` as well as `suppressionReason`. Unsupported provider/parser, excluded-turn partial coverage, no eligible turns and partial shape coverage must not be replaced with an empty reason just because inherited source suppression is null. Validate the existing shared session alias of every native partition before the display cap, including omitted rows; turn-only sessions are already present in the unified model's session catalogue.

## Scope boundary

Proposed production paths: additive Active Time composition in `src/report/unified-model.ts`, section/navigation/overview integration in `src/report/unified-page.ts`, and a new `src/report/active-time-section.ts`. New narrowly scoped tests and these scoped contract/verification documents are permitted. No parser/analyzer/store/scanner/schema/CLI flag/design/dependency/workflow change and no existing-test weakening. Shared maintained planning documents stay with their current owner; this scoped contract supplies the implementation plan and findings links.

## Research questions before implementation

1. Confirm immutable main/PR154 report topology and unused Active Time analyzer contract; identify exact metadata compatibility checks and shared alias boundaries.
2. Decide minimal useful detail that preserves native proof/turn identity privacy without silently truncating populations. Confirm hard source/turn/observation bounds and 1 MiB final HTML cap.
3. Define falsifiable stored/fresh/default/timing/pattern modes, unavailable/unsupported/empty/partial/zero/overflow and whole-population-before-cap checks. Confirm prior-build parity controls and actual installed artifact path.

Implementation is NOT STARTED. Research, reviewed plan, issue creation/claim/readback and separate developer handoff must precede code. No merge/release or broad parent completion is included.

## Proposed implementation plan

1. Compose one unchanged Active Time result from the same pinned source. Verify its source ID, provider, revision, parser/normalization/key versions and completed/observed byte bounds before including it. Add normalization/key versions to the internal unified envelope so the renderer can independently verify all eight fields. Preserve all existing domains, exploration and pattern waste membership. **Verify:** direct analyzer equality and one invocation; a mismatch in each envelope field is rejected at composition and rendering; the model is deterministic and does not mutate source input; non-unified report never invokes this analyzer.
2. Add overview assessment, navigation and one bounded Active Time section. Reuse session aliases, full analyzer summary/exclusions/reasons and at most twelve partitions in native deterministic order. Display native interval scope/evidence, admitted turn count, distinct corroborating observation count, union and span with their separate arithmetic reasons. Aggregate union-overflow and span-overflow partition counts over the full population before clipping; those counts can overlap. Preserve native source/capability/readiness context. Do not expose turn/proof identities or add aliases, a chart, inferred percentages or pooled totals. **Verify:** union/span differ for long gaps; overlap/adjacency/zero/cancelled and overflow retain exact meanings; all source suppression, unsupported-provider/parser, empty and partial states remain explicit; omitted partitions still participate in population/overflow counts and alias checks; counts and omissions agree at the 4,096-turn/8,192-proof bound.
3. Verify actual public paths and compatibility. Use synthetic Codex and Claude inputs under default, usage-timing and pattern-evidence modes; stored reports are generated after deleting original inputs, and fresh/stored outputs are compared to unchanged stats Active Time JSON. **Verify:** one pinned read, unchanged DB/key bytes and permissions, output collision and revision refusal, private HTML without raw/persistent identities, prior immutable build parity for non-unified report and existing stats/help/version, and genuine scripts-disabled installed binary behavior. Existing tests and numeric/privacy assertions remain unchanged.
4. Freeze the candidate for independent review and qualification, then publish one stacked Draft. **Verify:** strict typecheck/build, focused new cases and full regression with the authentic schema5 seed, existing artifact verifier, normal-registry hosted exact-head CI and remote blob/tree equality. Review every changed path. Distinguish passed/failed/skipped/not-run checks and local environment constraints. Preserve PR154 ancestry; no changes to its branch, main, unrelated source or broad issue completion.

These are planned Verify gates, not executed passes. Separate research must confirm the contract, and the coordinator must record plan approval and a complete issue claim before the developer edits production or test files.

## Research and plan review — 2026-10-04 UTC

Separate source-only research was completed after this specification draft. [Source-backed findings](P6-ACTIVE-TIME-REPORT-FINDINGS.md) confirm no technical prerequisite beyond the existing pinned source and unchanged analyzer. The coordinator accepts the count-only section, native-order cap, distinct corroborating observation counts, full arithmetic-qualification counts, all-partition alias checks and all-eight-field envelope validation. No new aliases, chart, metric, capture or native-evidence admission rule is needed.

The new presentation predecessor is genuine PR154 `596bd084`; historical `AGENTPROF_ACTIVE_TIME_BASELINE_BINARY` keeps its older PR57 horizon and must not be redirected to this newer baseline. New tests use a separate predecessor input. The immutable base was materialized from 461 Git blobs and independently reproduces tree `21beeb624118d9e11569e0304cdd57a9b133146b`. This is source verification, not a test pass.

Plan review: approved within the requested P6 report-connection scope. Production/test implementation still waits for the new issue claim/readback and separate developer registration. Full acceptance, independent review, exact-head CI and actual merge remain separate gates.

## Focused implementation handoff — 2026-10-04 UTC

After issue161's actual developer claim/readback and coordinator GO, the separate developer implemented only the three reviewed report paths and two new test files. No contract change was needed: the internal model retains the full unchanged analysis, validates all eight envelope fields, and the count-only section keeps native order, full population/overflow counts, shared aliases and native reasons before its twelve-partition display cap.

[Focused verification](P6-ACTIVE-TIME-REPORT-VERIFY.md) records strict typecheck/build,158 passing cases with zero skips (including genuine PR154 and actual scripts-disabled installed controls), unchanged inherited tests and full-analysis/store/privacy boundaries. The retained first baseline environment failure and corrected new null-inventory assertion are documented separately. The candidate remains uncommitted for independent review and coordinator full/schema5/artifact/current-head qualification; publication/merge and broader P6 acceptance are not implied.

## Current-main integration plan — 2026-10-04 UTC

PR154 was actually merged as `61652839e7a1f91f02d0a9d8e6f6bf1411ab6b10` while the original candidate was being qualified. Its source head `db3d1fe449e2766a611589b5675cf135cf2931b9` incorporates the independently maintained schema7 directory foundation, related historical controls and qualification documents. The three report production paths used by this feature have no upstream semantic change. Original PR154 `596bd084` and its qualified candidate/installed witness remain preserved as the earlier comparison horizon.

1. Materialize exact main616, tree `a108601271fa1a6634ac566f18db9ce7fd1b94fd`. **Verify:** all470 Git blobs and the recomputed complete tree match; preserve every incoming source/test/doc byte and its file mode.
2. Compose only the eight already scoped feature paths onto that base. **Verify:** the five independently reviewed production/test files retain their exact frozen hashes, all other incoming main paths are byte-identical, and no schema/analyzer/test-oracle correction is authored by this integration.
3. Build a genuine main616 predecessor and requalify the composed candidate. **Verify:** same103 new tests, old command/non-unified/exploration behavior, actual scripts-disabled installation, current-schema read-only safety, authentic schema5 full suite and existing artifact verifier. The new report-only predecessor variable uses this immediate schema7 baseline for this run; the original596 evidence and older historical variables retain their original horizons. Distinguish the two runs and do not add their counts.
4. Publish one Draft against main, with the published plan and actual main616 as retained parents. **Verify:** fresh base/ref readback, eight-path delta, exact remote tree/source hashes and hosted final-head checks. PR154 is now a completed dependency; no main merge, release or broad P6 closure is included.

This is a source-preserving composition plan, reviewed before integration. No production or test logic change is required; if one becomes necessary, update the contract and obtain a separately registered developer before editing it.
