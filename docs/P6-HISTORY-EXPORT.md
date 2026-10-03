# Offline selected-history export

## Specification — 2026-10-03

Bounded successor to PR #130 at `f8b6c6071e48fc052f5c3b63d1d9c1a0e9323d7d`, under the owner's request to continue remaining development. This implements the missing history-to-HTML path in SPEC's offline output/trends scope; it does not change measurement semantics. Broad #6/#7 ownership, #5 provider/storage work, #50 exploration and the oldest-first PR reviewer remain separate. Shared planning documents are not overwritten while other sessions own their additions; this scoped specification/implementation/evidence document is the proposed addendum for integration.

`history --source ID [--source ID ...] --from UTC --to UTC [--offset +09:00] [--session ID] --output new.html [--json]` writes a single static offline report. Omitting --output preserves the original human/JSON command exactly. The optional output changes stdout to a publication receipt, not a second analysis response. Invalid output arguments fail before store access. Only .html/.htm destinations are accepted, outside the private store, never overwritten; no --open, source discovery, rescan, network or browser invocation.

The report consumes exactly the one returned immutable SelectedHistoryAnalysis, never a second store read. Show the explicit UTC half-open period, fixed offset (not IANA/DST), exact selected source revisions and coverage, prefix-wide reconciliation/exclusions, dated counts and interval values. Do not create daily tokens, fill missing days, pool incompatible sessions/providers/evidence or call interval union savings. Count/time boundary populations remain distinct.

Display at most 12 provider/session/scope/evidence series and 31 chronological rows per series; show exact per-series and global omissions. Repeated dates from distinct series are not merged. All selected sources remain visible. Each shown day has a numeric table and a bar using the clipped day-window duration as the explicitly labeled denominator, not a maximum chosen from visible rows. Show zero and unavailable distinctly. Bounded expandable evidence contains at most 8 member executions per shown day and at most 16 copies per shown member, with source/revision/proof-count provenance. Correlatable event IDs, key IDs, paths, commands, fingerprint payloads and raw observations are never embedded; stable report-local source/session/execution aliases are used. The complete unchanged CLI JSON remains available via the original command without --output.

HTML has no scripts, forms, external assets or external links. Reuse existing semantic REPORT_CSS read-only, add only static scoped rules, hash the exact styles for CSP, escape every dynamic string, label tables/regions with unique local anchors and retain keyboard/native-details/no-JS support. A 1 MiB UTF-8 cap refuses output before publication instead of writing a truncated report. Publication reuses the existing no-overwrite mode0600 writer; post-link warnings remain published-with-warning and exit1. The report itself does not include output or private data-directory paths. The caller's explicitly requested output path is allowed only in its receipt.

## Source-grounded findings

`runHistory` already validates explicit sources/query, loads modules before its one synchronous pinned read, and returns a complete SelectedHistoryAnalysis. `HistoryDay` keeps full completion and membership populations plus clipped day windows. `writeReportOutput` already protects the private store, uses exclusive0600 temporary creation/no-overwrite link, and distinguishes prepublication errors from postpublication warnings. Reusing these prevents a second analysis generation or a new unsafe writer. The existing REPORT_CSS supplies both themes, small-screen tables, focus indicators and print rules. Source inspection is not browser execution.

## Implementation and Verify

1. Build shared static evidence-page helpers and a bounded history renderer. Verify: exact query/source context; sum20/union15; midnight count/time differences; zero/null/empty/partial/conflict handling; deterministic input order; explicit series/day/member omissions; numeric geometry; every local href resolves; no keys/raw strings or executable insertion; CSP hash and final UTF-8 cap.
2. Add opt-in export action to history. Verify: output validation before reading; exactly one runHistory call; existing result bytes when omitted; publication outside the store with original writer; errors before link leave no output; post-link warning receipt remains published; duplicate/extra/unknown arguments remain safe. Do not change main, analyzers, parser/store/schema, old report handlers, dependencies or CI.
3. Add ordinary synthetic stored-input and installed-tarball acceptance. Verify: scan/close/remove raw inputs/export, duplicate/conflicting copies and exact visible arithmetic, unchanged DB/key bytes, no overwrite/private destination/symlink destination, built/installed byte parity, supported-runtime typecheck/build/full suite/artifact and exact published-head CI. No fixture is uploaded from real user logs.
4. Publish draft and hand off. Verify: exact scope diff, executed test/skip records, independent maintainer review and parent-first integration before merge. Do not close broad #6/#7 or publish a package.

## Work identity and limits

Owner: current ChatGPT continuation; actual runtime UUID and independent development/review sub-session are not exposed by available tools and are not invented. This environment therefore cannot execute the repository's separate-collaborator gate; independent maintainer review remains explicitly required. No new Work/Codex task is launched. Reserved paths: this document; new `src/report/evidence-page.ts`, `src/report/history-page.ts`, `src/cli/history-export.ts`; `src/cli/history.ts` only export option/action; new history export tests. One active ticket; return implementation reservations when handed to review.

Provider error/content/change/validation-scope/usage timestamps, daily token calculation, latest-source lifecycle, broader report flow, real-user calibration, macOS/browser/accessibility visual acceptance and release are not completed by this slice.

## Execution record

Initial planning state: plan recorded before code; no new tests had run. Supported-runtime and browser verification were not inferred from static source review.

### Executed qualification and handoff — 2026-10-03

[Draft PR #132](https://github.com/WhiteKiwi/agentprof/pull/132), [issue #131](https://github.com/WhiteKiwi/agentprof/issues/131). Source/test head `34442895318dba52b56be397a4ba618e447ae169`; fixed base `f8b6c6071e48fc052f5c3b63d1d9c1a0e9323d7d`. [Run 37125326856](https://github.com/WhiteKiwi/agentprof/actions/runs/37125326856) completed successfully in all four jobs: Node24.15.0/24.21.0/26.7.0 `pnpm check` and Node22 unsupported-runtime guard.

Directly read Node26.7 job `111209355380`: checkout `0daeef1f357806e1df64fc9157218fced0987590`, GitHub's test merge of this head into the fixed parent, not a real PR merge. Typecheck/build pass; full suite **2,737 PASS / 68 inherited conditional SKIP / 0 FAIL**, 107 files (105 PASS / 2 SKIP). The three new suites all execute without skips: **page14 + CLI14 + installed1 = 29 PASS**. The unchanged artifact verifier passes with82 files, scripts disabled and published:false.

Actual new checks include ordinary synthetic Codex/Claude scan/store/raw-deletion/export with one pinned read; scripts-disabled installed tarball identical/conflicting copy inputs and built/installed HTML parity; unchanged private DB/key bytes; mode0600; no overwrite/private-store/symlink output; preserved default human/JSON results; deliberate postpublication warning; exact calendar/interval arithmetic; CSP hash, escaping, unique resolving local links and deterministic omissions. The new installed scenario runs by default, not as one of the inherited optional skips. No new test failure was observed in this first published run.

Final implementation additionally caps distinct execution-detail sections at64 across the displayed days and reason rows at64. The8-per-day ceiling remains, and links are limited to actually displayed detail sections with exact omissions. The13-series/32-day fixture verifies12/13 series,372/416 days and64/372 distinct execution details without dangling links and below the1MiB refusal boundary. This is not a representative performance benchmark or exhaustive maximum-combination qualification.

The exact comparison lists only eight scoped paths. The inherited history modification is its --output option/duplicate guard/type and export action; existing runHistory, formatter, main, old report/insights/stats, analyzers/parser/store/schema and dependencies/CI are untouched. This final documentation commit records the already executed code-head result; its own hosted status must be checked separately.

Release the active implementation reservation at handoff; #131 remains open for independent review and parent-first current-main integration/merge. The shared static helper may be consumed read-only by a separately claimed patterns export. No browser runtime/visual/keyboard/print or macOS, real-user calibration, package release, independent subagent review or broad P5/P6 completion is claimed.
