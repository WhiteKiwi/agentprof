# Exploration evidence in the unified offline report

## Specification — 2026-10-04, before implementation

Complete the remaining P6 integration of the merged PR151 exploration diagnostic. Base main is d1b84f166eb33f11d5b7a22ca407dbf14226fd24. `report --unified`, both stored and explicit fresh input, includes the existing informational exploration assessment in the same pinned generation as the other sections. No new CLI flag, provider support or changed detection threshold is introduced. Default non-unified HTML, insights JSON/human, patterns, Detected Waste and source storage retain their contracts.

The report shows the native assessment, suppression and unavailable/blocked reasons; literal closed-window thresholds; bounded session partitions and first candidate per session; source-local event aliases, repeated-search group counts and proof counts. Absent/unavailable candidates are not rendered as a measured zero. A candidate remains INFO: orientation or audit can legitimately require repeated searches. Necessary-work counterexample, investigative action, suggested matched experiment and quality guardrail remain visible even without candidates. Exploration contributes no Detected Waste time or events.

## Source findings

PR151 is merged and issue50 closed after its bounded verification. `buildUnifiedSourceReport` currently composes nine domain analyses without exploration; `renderUnifiedSourceReport` explicitly says exploration is outside the layout. The merged diagnostic supports exact known Claude parser2/3/4 contracts, not Codex. Shared evidence-page helpers already escape cells, generate report-local aliases and enforce a final 1 MiB offline page ceiling. The existing report workflow provides one transaction-pinned read and a no-overwrite writer. Issue5 has another active directory-membership owner; no scanner/schema changes are taken here.

## Reviewed implementation and Verify

1. Add the unchanged exploration analyzer to the existing unified internal composition and source-envelope equality checks. Verify deep equality with direct analyzer output, exactly one direct exploration call per unified build, generation/provider/prefix mismatch rejection and unchanged other analyses including pattern-time membership.
2. Add a native semantic exploration section with the existing escaped table/alias/page helpers, overview assessment and section navigation. Verify positive/insufficient/empty/blocked/unavailable/unsupported/suppressed states, literal20/5/1/600000 arithmetic, shared aliases, full-population state/reason counts before display caps, exact omissions, no persistent IDs/raw keys/scripts and unchanged Detected Waste contribution. Display bounds:12 partitions,12 candidates,12 repeated groups and12 event aliases per candidate; complete engine evidence remains in insights --exploration --json.
3. Test actual validated stored sources, fresh capture and binary/installed flows. Verify stored/raw-deleted output, one pinned read, default legacy byte parity, both providers/capture modes, no-overwrite, revision guard, maximum input/combined output and supported typecheck/build/focused/full/package checks. Static HTML checks do not stand in for actual browser/accessibility testing.
4. Publish a scoped Draft and evidence. Verify exact source/test blob equality and final-head hosted CI; release only this implementation reservation. Independent maintainer review/latest-main integration and merge remain outstanding. Do not close P6 or launch Work/Codex tasks.

Production scope: src/report/unified-model.ts, src/report/unified-page.ts, new src/report/exploration-section.ts. New narrowly named report tests; this scoped document and additive SPEC/FINDINGS/IMPLEMENTATION/ACCEPTANCE entries only. No existing product tests, analyzer/parser/store/scanner/CLI/design dependencies or permanent workflow changes are planned. Transport-only source snapshot/publisher files are removed from the final tree.

This continuation uses the current ChatGPT and an isolated container. Separate collaboration subagents/runtime UUIDs are not available and are not invented; independent maintainer review remains a separate gate.

## Execution evidence

Not yet executed. Planned tests and documentation are not feature qualification.

## Maintainer composition specification — 2026-10-04 KST

Actual153 main e58bf63b3049a4641feee409e2abc1d9b2059c6d contributes the
authenticated schema7 membership prerequisite and genuine old-schema compatibility
controls. It does not change this report feature or authorize broad5/6/7 closure.
The intentional unified exploration addition can change its dedicated section,
its overview assessment row and its navigation entry. Every inherited unified
section, unrelated HTML, exact CLI JSON/human/exit and all non-unified report
bytes remain preserved. The genuine historical report input must stay an original
schema6 generation; only its current private copy is explicitly migrated to7.

A conditional genuine-baseline test currently requires whole unified HTML to be
identical to the older report. Independently investigate the exact additive
differences before changing that oracle. A repair may permit only these declared
new exploration additions while comparing all old content exactly, and must
verify the new section's assessments/privacy/reference safeguards with the actual
installed runtime. Do not remove arbitrary nodes/text or skip the historical
control. Complete separate findings/reviewed implementation and concrete issue
Verify, then register a separate developer before any code change.
