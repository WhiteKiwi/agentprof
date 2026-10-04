# Observed exploration diagnostic — issue 50 continuation

## Specification — 2026-10-04

Continue issue #50 on immutable main `4f33d2d86c68c941ccb4c5b8f720c7c95de2786e`. The current issue explicitly releases the historical owner's reservation; the old branch is not published. Reuse this issue, not a duplicate ticket. This is a bounded source-local informational diagnostic, not proven inefficient work, Detected Waste, a savings estimate or full P5 completion.

Public entry: `agentprof insights --source FULL_ID --exploration [--json]`. Omitted or boolean false retains current Slow Tool results. Missing source remains INSIGHTS_SELECTION_REQUIRED. Invalid exploration types, repeated flags, excess arguments and mixed input roots must fail before storage. The new result mode is selected_source_exploration and schema is agentprof.source-exploration/v1.

A candidate requires >=20 completed exact native Read/Grep/Glob calls in a closed trailing 600,000 ms window ending at a distinct completion timestamp, >=5 exact matching native search lookup identities, <=1 observed Edit/Write interval intersecting that window and no intersecting opaque action. Process completion ties as one bucket; emit at most the first qualifying window per session. Failed Edit/Write intervals also count. Model records are inventory only. Pending/unpositioned mutation or opaque events and incomplete completed lookup boundaries/identity make the session unavailable, including below-threshold samples. Inconsistent native tuples are not silently counted as lookup or model events.

Reuse unchanged invocation-overlap admission exactly once. Consume only its admitted event IDs and decisive ordinary call/result proof IDs. Wrapper/provenance/source suppression stays authoritative. Unsupported source records prevent a complete source diagnosis; retain explicit partial coverage rather than calling it a healthy full-history result. Never decode or emit lookupKey, operationKey, raw command, file identity, input path or returned content. Selected candidate proofs must belong to selected events and matching sessions. includedEventIds is always empty.

Current-main amendment to the historical plan: allow exact known Claude parser2/3/4 with matching source/capability headers, because merged PR142/147 preserve the native call/result contract for timing and enriched capture. Claude1, Codex and unknown future versions stay unsupported. No parser version is relabelled. Original unpublished fourteen-artifact hashes are historical, not available executable proof; this continuation will use newly recorded regression/oracle tests and retain that limitation. No independent research/development/review subagent is available in this chat; no such execution or runtime UUID will be invented. Independent maintainer review remains pending.

## Findings and implementation plan

Source evidence: current `source-invocation-overlap.ts` already admits ordinary paired Claude boundaries and picks decisive proof pairs; `source-failures.ts` owns terminal provenance and source suppression; `source-search-recurrence.ts` supports exact Claude2/3/4 aliases; `insights.ts` currently selects only Slow Tool. The existing scope contract is in METRICS exploration-thrashing and issue50. No external provider inference is needed.

1. Build one pure analyzer using a source/session index and the unchanged overlap analyzer. Verify source/header suppression, completed/native classification, missing timestamps/search identities, unsafe dates, conflicting results, and selected proof ownership.
2. Use completion-sorted sliding windows, lookup frequencies plus frequency-of-frequencies, and start/end monotonic pointers for mutation/opaque intersection counts. Verify inclusive boundaries, ties, spans crossing both window ends, failed edits, counterexamples and deterministic input permutations. No event/observation/key-map rescan per endpoint; materialize membership only for the first selected candidate per session.
3. Add bounded human formatting and a discriminated insights result; import modules before the read-only callback. Verify one pinned source read/one chosen analyzer, omitted/false old output, safe argument rejection, no raw input access and unchanged DB/key bytes.
4. Qualify synthetic store round trips, ordinary provider input, built/installed CLI, maximum inputs and a separate brute-force window oracle. Verify human <=160 lines/32KiB and JSON <=8MiB without dropping native proofs; preserve existing regression assertions and report exact pass/fail/skip evidence.
5. Publish a main-based Draft with scoped changes and final-head CI. Verify remote source/test blobs equal the tested candidate. Leave issue open for independent review/merge and release only this implementation reservation at handoff.

Reserved production: new `src/analysis/source-exploration.ts`, new `src/cli/exploration.ts`, `src/cli/insights.ts`, and insights-only registration/help in `src/cli/main.ts`. New exploration tests/helper and this scoped specification/evidence document are allowed. Historical help comparators may gain only removal of the explicitly added exploration option/trailer, retaining their original baselines and other assertions. No parser, store, schema, scan/report, dependency or existing CI change. PR150 fresh workflows remain independent except non-overlapping main.ts hunks.

## Verification status

Plan precedes implementation. Tests not yet run. Browser/native/real-user usefulness, representative performance, false-positive rates and package release are not inferred from synthetic tests. Directory-wide durable membership is a separate remaining development scope.

## Maintainer enum correction — 2026-10-04 KST

After the additive SPEC, separate FINDINGS, reviewed IMPLEMENTATION and saved issue50 developer claim, `/root/exploration151_development` changed only the new exploration candidate's declared/emitted severity to `INFO`, matching the maintained diagnostic vocabulary. Human informational explanation, fixed thresholds, native proof/privacy gates and empty waste membership remain unchanged. New pure/formatter and actual built/scripts-disabled installed CLI assertions cover the enum and human `severity=INFO` across ordinary Claude2/3/4 default/timing/pattern captures. The developer ran no build, test or installation; the parent owns qualification, exact-source publication and actual merged-main verification. Earlier author evidence and broader acceptance limits remain historical and separate.
