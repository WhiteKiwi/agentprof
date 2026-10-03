# Offline source-pattern export

## Specification and rationale — 2026-10-03

Implement the remaining patterns-to-HTML path under the owner's continue-development request. Parent is PR132 documentation head `bc9b2782218914d53fc9b59e27e0ba0e267fbcb4`; its source `34442895318dba52b56be397a4ba618e447ae169` passed all four hosted jobs and29 new tests. Issue131 released active implementation reservations, retaining independent review. This successor consumes its static evidence-page helper read-only. PR128's analyzer and PR130 history stay unchanged. Broad #5/#7 ownership, #50 exploration and old stats-review reservations are preserved.

`patterns --source ID [--from UTC --to UTC] --output new.html [--json]` exports exactly one SourcePatternAnalysis returned by one existing runPatterns call. No second source read/analyzer, reclassification or new measured values. Omitting --output preserves existing patterns human/JSON results. With --output stdout is a publication receipt. Validate output/type/root/boolean/period arguments before private I/O, reject duplicates including globals on the export path, and preserve the default command's old argument semantics. Reuse no-overwrite0600 writer; postpublication warnings remain published with exit1. No browser/scan/discovery/migration/network action.

## Display contract

- Show selected source revision/provider/parser, observed byte prefix/availability, suppression, native/positioned/unresolved coverage and explicit time-contribution query. Source/session/event/turn/proof identities and all raw strings stay out of HTML; use report-local aliases. Unknown is not zero or no finding.
- All four rule assessments retain version, literal occurrence/window/session thresholds, status, eligible count, missing evidence/blocked-session counts and reasons. Slow Tool and Exploration remain explicitly outside this report. No claim that the engine now supports ordinary provider fields it does not capture.
- Show at most12 candidates in rule-ID/ID order. Each keeps occurrence/contribution counts, severity, full necessary-work counterexample/investigation/matched experiment/quality guardrail, all avoidability/root-cause/improvement caveats, at most12 evidence-event role rows and16 qualification witnesses with exact omissions. Timed-contribution count is based on positioned source evidence before query clipping; it is not an in-query execution count. Candidate interval/qualification semantics remain inherited.
- Show at most12 compatible time partitions, preserving sum, busy union, category exclusivity/concurrency, per-rule unions, pattern union, multiple-rule intersection, multiplicity-weighted overlap excess and qualified-subset flags. Never add partitions or per-rule unions to manufacture a total. Optional bar is pattern-associated union divided by the same partition's busy union. It is not a savings percentage; null/zero denominators remain explicit.
- Show at most12 edit-validation partitions and16 earliest observed cycles. Preserve exact first-pass numerator/first-terminal denominator, full-scope numerator/known-first-scope denominator, missing scope, unvalidated edits and unavailable reasons. These counts remain stored-prefix values, not query-period values or causal proof. Cycle details preserve bounded edit/validation aliases and decisive first/successful result aliases; no changed-file/line coverage is invented. Candidate-to-cycle links resolve only to rendered cycles and expose exact omissions.
- Deterministic selections are display caps, not new statistical populations. Complete unmodified machine evidence remains available without --output. Use the shared static no-JS/hash-CSP/escaping/table/focus/print primitives, preserve native details and1MiB UTF-8 refusal. All links are internal and resolve.

## Findings

SourcePatternAnalysis already provides the required query distinction, rule assessments/candidates, compatible time partitions and editValidation denominators. Missing error/content/change/scope evidence causes partial/not_evaluable; an export must display those outcomes instead of constructing positive provider findings. PatternTimePartition.overlapExcess can exceed wall-time because multiplicity is intentional. Existing paired ordinary Claude Edit/Bash input can prove an ordered cycle without declaring test scope. The common static page and publication writer were qualified in the history slice; this successor still needs its own integration and installation tests.

## Implementation and Verify

1. Add bounded pattern-page projection. Verify actual normalized-evidence retry/error/context/validation controls, all-null/empty/suppressed/partial states, exact retry12/error8/overlap5=>union15 display control, first-pass and known-scope denominators, preserved rule/time semantics, immutable deterministic ordering, caps/omissions, raw-free aliases, escaped text/CSP and resolving anchors.
2. Add pattern-export plus opt-in CLI branch only. Verify invalid arguments before source read, one pinned runPatterns/source/native-analysis pass, no-output human/JSON parity, safe no-overwrite/private/symlink destinations, and truthful post-link warning receipt. No modifications to existing analyzers/history/helper/writer/main/old report paths.
3. Add ordinary synthetic scan/store/raw-deleted and installed package scenarios. Verify Codex missing-evidence display and ordinary Claude edit-validation cycle with unknown scope, built/installed HTML equality, immutable private store/key, optional query bounds and safe binary errors. Run full supported-runtime typecheck/build/tests/artifact and exact-head CI; record all failures/skips/NOT RUN.
4. Publish Draft and hand off. Verify scoped patch and final-head checks, leave independent review/parent-first main integration/merge open. Never close broad #6/#7 or publish a release.

## Ownership

Owner is this ChatGPT continuation, with no exposed runtime UUID or independent developer/reviewer sub-session; none is invented. Independent maintainer review remains required. Active issue is only this successor after131's implementation handoff. Branch `feat/pattern-html-export`, stacked against `feat/history-html-export`. Reserved: this plan, new `src/report/pattern-page.ts`, `src/cli/pattern-export.ts`, only export-option/action code in `src/cli/patterns.ts`, and new pattern-export test/support files. No parser/store/schema/normalizer/helper/style/writer/main/old report/insights/stats/dependencies/CI or other branch edits. Shared specification additions are proposed in this scoped document instead of overwriting others' shared plans.

Provider evidence/timestamps, daily token calculations, latest-source lifecycle, broader unified report flow, empirical usefulness, macOS/browser visual/keyboard/print/accessibility qualification and release remain uncompleted. Use only synthetic logs. No Work/Codex task, automatic experiment or merge is launched.

## Execution record

Plan recorded before implementation. No new test PASS asserted yet.
