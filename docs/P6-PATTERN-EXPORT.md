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

Initial planning receipt: plan recorded before implementation, with no new test PASS asserted at that stage.

### Executed source qualification — 2026-10-03

Published [Draft PR #134](https://github.com/WhiteKiwi/agentprof/pull/134), tracked by [issue #133](https://github.com/WhiteKiwi/agentprof/issues/133). Planning commit `b010988b76846106b9379dce8b9338ae0b25c8fc` precedes implementation. Code/test head is `cc419303a0b6ca8f24a0cbb3af0aee17a0986fbe`, a non-force descendant of the fixed PR132 parent `bc9b2782218914d53fc9b59e27e0ba0e267fbcb4`.

[Foundation run 37126153945](https://github.com/WhiteKiwi/agentprof/actions/runs/37126153945) completed successfully in all four jobs: Node24.15.0/24.21.0/26.7.0 `pnpm check` and unsupported Node22 early guard. Directly read Node26.7 job `111211729462`: actual checkout is test merge `1b4d365ab4dff0a71b3f3969c922c05b80895a6f`, merging this source into the fixed parent. This is GitHub's synthetic test merge, not an authorized PR merge.

| Check | Observed result |
| --- | --- |
| Production typecheck / build | PASS |
| Full source suite, directly inspected Node26.7 log | **2,771 PASS / 68 inherited conditional SKIP / 0 FAIL**; 110 files (108 PASS / 2 SKIP) |
| New pattern-export suites | **34 PASS / no new skips**: page14 + CLI19 + installed1 |
| Previously delivered history export suites | All29 tests execute and PASS again on this combined parent/child stack |
| Existing artifact verifier | **84 package files PASS**, scripts disabled; tarball npm-exec/global install and existing read-only stats/insights/failures; published:false |
| Dedicated installed pattern-export scenario | Actual script-disabled install outside repo, ordinary Codex/Claude scan, raw-input deletion, installed/built HTML and old human/JSON parity, mode0600 and unchanged DB/key bytes PASS |
| Single-generation path | One runPatterns, one pinned readSource and one native failure-admission pass, verified by spies and transaction assertion |
| Output safety | Existing/private-store/symlink destination refusal, duplicate/invalid options before I/O, wrong key/missing source, and truthful post-link warning receipts PASS |
| Display semantics | Four positive normalized-evidence rule controls, unknown/suppressed/empty/zero states, exact first-result/scope denominators, query clipping vs qualification witnesses, privacy/escaping/hash-CSP/internal links and deterministic caps PASS |

No new test failure was observed in the first published source run. Skipped inherited optional scenarios are not counted as passes and are not required for the new installed scenario, which executes without a skip condition.

The ordinary Claude Edit/Bash/Bash input produces an observed cycle and first-pass1/1 while keeping declared validation scope unknown and full-validation ratio null. Ordinary Codex input without error identity remains not_evaluable; the report does not manufacture a retry diagnosis. Positive retry/error/context/validation controls use synthetic normalized evidence and are not an ordinary provider-support upgrade. The independent retry12/error8/overlap5=>union15 case is a synthetic interval/display control, not a captured user-log performance claim.

The many-session controls verify12/20 time and validation partitions,16/60 cycles and exact candidate omissions with resolving links. A100-event episode retains all analysis evidence while showing12/100 event aliases and16/98 witnesses. These are correctness/display-bound tests, not representative performance benchmarks or exhaustive maximum combinations. No browser was launched; static markup/CSS/CSP tests are not visual, screen-reader, keyboard, print or offline browser-runtime qualification.

### Review handoff and remaining work

The exact compare contains eight scoped paths. The only inherited production edit is `src/cli/patterns.ts` registration/dispatch: export option, export-only global duplicate guards and lazy export action. Its existing validator, runPatterns and default formatter are unchanged. All analyzers, history, common helper/writer/style, main, old report/insights/stats, parser/store/schema/normalizer, dependencies and CI remain untouched.

This final documentation-only commit records the already executed source qualification; its own hosted result is checked and recorded in PR134/issue133 separately. Release only this issue's active implementation reservation at handoff, leaving independent maintainer review, parent-first latest-main integration/regression and authorized merge open. No other contributor's reservations or broad #6/#7 status are changed.

Still unimplemented by these exports: ordinary provider error/content/change/validation-scope/usage-timestamp capture and associated parser/checkpoint compatibility, daily token attribution, latest-source deletion/move lifecycle, and broader unified report behavior. macOS/browser/real-user usefulness/false-positive/performance and release acceptance remain separate. No real user logs, secrets, automatic experiments, package publication or main merge were performed.
