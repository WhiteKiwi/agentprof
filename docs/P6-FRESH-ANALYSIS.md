# Fresh history and patterns exports

## Specification addendum — 2026-10-03

Continue the first-user-flow development in SPEC and parent #6/#7. The existing stored-source `history` and `patterns` commands gain an explicit single-input mode:

```sh
agentprof history --provider codex --input session.jsonl --from 2026-10-01T00:00:00Z --to 2026-10-04T00:00:00Z --offset +09:00 --output history.html
agentprof patterns --provider claude --input session.jsonl --output patterns.html --json
```

Both provider and input, plus a new .html/.htm output, are required in fresh mode. A stored `--source` or either root option cannot be combined with fresh input. The existing stored-source commands, analyzers, default formatting and their read-only behavior remain unchanged. Multiple stored sources are still available through the existing history path, not silently discovered by the new mode. This slice does not implement default-root scanning, all-source aggregation, daily tokens, new provider evidence, automatic browser opening, or a unified all-metric page.

All argument, time-window and stable-path preflight checks precede collection. Input is exactly one explicit regular uncompressed .jsonl file with no symlink ancestor. Output must be absent, outside the private data directory, and have an existing ordinary parent directory. Stable trusted pathname ancestors are required; pathname APIs do not promise hostile-rename race resistance. The existing atomic no-overwrite mode0600 output writer rechecks output safety at publication.

Fresh mode scans that one input using the existing bounded collector, then selects only the generation proven by this invocation's scan receipt. Incomplete discovery, rejection, stale CAS, failed or aborted scan never falls back to an earlier stored generation. A deliberate evidence-warning partial scan can still publish its exact committed/reused generation; the workflow retains the warning and exits1, not success0. No raw input paths, commands, content, or exception text enter the receipt; the explicitly requested publication output follows the existing writer contract.

Read the selected source once inside a pinned read-only transaction. Check its ID, provider and exact scan-receipt revision before running either analyzer. A peer revision change fails with SOURCE_REVISION_CHANGED; never switch to a newer or older generation. History retains explicit UTC/fixed-offset/session semantics and patterns retains optional contribution-window semantics. Unknown error/content/change/scope/timestamps remain unknown. This validates a generation at collection time, not ongoing source freshness or complete history.

SIGINT is cooperative. An abort before publication skips output; an abort after the writer has started may leave a successfully published file, and the receipt must preserve that publication while returning130. Collection already committed before an abort is not rolled back. Attach/remove only the workflow's own listener; do not replace unrelated listeners. An internal AbortSignal permits deterministic tests and embedding without exposing a new CLI switch.

## Findings before implementation

Pinned parent PR134 `1508ec210110aeb6d1c4042b5396862019d2f752` contains the history/pattern analyzers and static export renderers. `report-fresh.ts` already defines `selectFreshReportGeneration` and uses `collectScan` for single-file collection; reuse that receipt selector instead of introducing a second admission policy. `report.ts` demonstrates SOURCE_REVISION_CHANGED inside a pinned read. `write-output.ts` preserves post-link warnings as publication receipts. Existing history/pattern exports consume stored generations only and reject roots. Therefore the remaining work here is workflow composition, not another stats display or new diagnostic engine.

## Implementation and concrete Verify

1. Add one shared fresh-analysis preparation, collection, pinned-read and publication module. **Verify:** all selection/type/path/calendar errors before bootstrap; missing/compressed/directory/symlink input; existing/private/symlink output; exact receipt admission; stale generation and provider mismatch; only one source read and chosen analyzer; partial/null/unknown retained.
2. Route `--provider`/`--input` in existing history/pattern command registration before stored-source dispatch. **Verify:** options before/after command, duplicate/conflicting/extra/unknown flags, required output, ordinary stored human/JSON and HTML parity; no changes to existing validators/analyzers/store/parser.
3. Exercise real synthetic Codex/Claude scan-to-HTML flows. **Verify:** first commit, byte-identical rescan reuse, append revision, partial warnings, exact stored/export HTML parity, independent source roots untouched, revision-race refusal, failed selection and cooperative abort without stale output, post-publication warning/abort receipts, no private content.
4. Qualify a script-disabled installed tarball and publish a Draft. **Verify:** actual installed/built invocation parity, source-head typecheck/build/full tests/artifact via supported runtime CI, explicit skips and observed failures. Review/merge only after parent-first current-main integration. No parent issue completed closure.

## Ownership

Current ChatGPT continuation owns this one scoped ticket and branch. No actual runtime session UUID or separate development/review subagent is exposed; none is invented. Independent maintainer review is required. Reserve only this plan, new fresh-analysis modules/tests and the additive option/action dispatch hunks in history.ts and patterns.ts. Preserve #5/#7 broad ownership, #50 exploration, old stats-PR reviews and parent feature branches. No parser/store/schema/normalizer/report-fresh/writer/style/main/CI/dependency changes. The existing authoring environment can publish through the GitHub plugin and validate through GitHub Actions; local Node22 checks are supplementary, not supported-runtime qualification. Use synthetic records only.

## Execution record

Plan recorded before implementation. No implementation or test PASS is claimed yet. Full provider evidence capture, daily tokens, deletion/move lifecycle, unified all-metric report, independent review, browser/macOS/empirical and release acceptance remain separate work.
