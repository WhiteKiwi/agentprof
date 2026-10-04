# Explicit evidence capture in fresh workflows

## Specification — 2026-10-04

Continue the owner's request to implement remaining AgentProf development. Base main is `4f33d2d86c68c941ccb4c5b8f720c7c95de2786e`. PR139 unified reports, PR142 usage timestamps/daily tokens, PR145 explicit-file lifecycle and PR147 provider evidence are already merged; do not recreate them. Broad #5/#7 acceptance and #50's exploration reservation remain separate.

Existing `report`, `patterns` and `history` explicit-file workflows shall accept `--usage-timing` and `--pattern-evidence`. These are explicit capture choices, not report filters. Pattern evidence implies usage timing using the existing captureMode policy. Omitted/false choices preserve the existing collector invocation, legacy capture, receipt shape and default output. Stored-source invocations reject capture flags rather than silently ignoring them or rescanning data.

`history --tokens --provider codex|claude --input FILE.jsonl --usage-timing --from UTC --to UTC --output NEW.html` shall collect one file and render the existing daily usage analysis from that exact source revision. `--pattern-evidence` also satisfies the timestamp requirement. Missing capture opt-in is an error before filesystem or storage access; requesting tokens must not silently opt into a different parser. Provisional usage remains provisional, unknown time remains undated, and no billing/date/completeness/savings claims are introduced.

Every fresh path retains explicit input/output validation, receipt-proven generation selection, read-only revision pinning, no stale fallback, safe no-overwrite publication, partial warnings, interruption semantics and existing privacy boundaries. Capture mode/type/combination errors fail before bootstrap. New CLI flags reject duplicate occurrences. Unsupported mixed source/fresh selection remains invalid. No directory discovery, automatic browser opening, merge, release or new provider semantics are added.

## Findings

Read current `src/cli/scan.ts` and `src/parsers/capture.ts`: collectScan already accepts a validated fourth ParserCaptureOptions argument; pattern evidence implies timestamps. `report-fresh.ts` and `fresh-analysis.ts` still invoke it with three arguments. `history.ts` dispatches --tokens to the stored-only usage path before fresh dispatch. Existing fresh helpers already prove source/provider/revision and distinguish published-with-warning/aborted outcomes. The missing work is explicit policy propagation and composing the existing usage analyzer/renderer, not another metric engine.

## Implementation and Verify

1. Reuse captureMode in one small fresh-capture helper, propagate explicit choices through report/pattern/history fresh paths without changing absent/false behavior. **Verify:** invalid types and duplicate flags fail before I/O; all exact Codex1/2/3 and Claude2/3/4 selections, pattern-implies-timing, one collector call, same-mode reuse and mode-change replay; legacy no-flag output/arguments stay equal.
2. Add fresh history token dispatch, using existing usage history analyzer and renderer in the same pinned read. **Verify:** required explicit timing/evidence opt-in, UTC/offset/session bounds, one source read, final/provisional/null and stored-export parity; failed/stale/intervening revisions cannot publish old data.
3. Add actual synthetic scan/store/CLI and installed-package regression tests; inspect changed-file scope. **Verify:** both providers, all fresh report modes, old stored paths and errors, no raw text/IDs in HTML, no private mutation from reads, no overwrite, no new skipped cases. Run typecheck/build/focused and full supported-runtime checks; record exact counts/failures and distinguish local/hosted results.
4. Publish Draft and hand off. **Verify:** remote tree equals tested changes, final-head CI status is observed, only implementation checks complete. Independent review and actual merge remain open; no broad parent closure.

## Execution environment and ownership

Owner is this ChatGPT continuation, one active narrow ticket. Runtime UUID and separate development/review subagents are not exposed; none is invented, and independent maintainer review remains necessary. Only scoped docs, fresh-capture helper, fresh-analysis/report-fresh code, history/pattern/report option/dispatch hunks and new tests are reserved. Existing analyzers/parsers/checkpoints/store/schema/legacy stats/insights/design/dependencies remain unchanged. Temporary branch-only snapshot tooling may package the public repository's tracked files, pinned dependencies and Node runtime for this isolated environment; no .git, credentials, environment files or user logs are collected, and the temporary workflow is removed before final handoff. No Work/Codex job is launched.

Directory-membership reconciliation and empirical/design/release acceptance remain outside this slice. This document is a narrow specification/implementation addendum; live progress belongs to the linked issue.

## Executed verification

Not yet executed. Planned checks are not PASS.
