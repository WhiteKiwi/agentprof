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

## Execution record — implementation qualified

[Issue #135](https://github.com/WhiteKiwi/agentprof/issues/135) and [Draft PR #137](https://github.com/WhiteKiwi/agentprof/pull/137) track this slice. The plan was recorded before code, and the issue claim was read back before implementation. Scope is one shared production workflow, registration-only additions in history.ts/patterns.ts, four new test/helper files and this document. The eight-file PR inventory and both inherited-file patches were inspected: no existing run/validate/format function was changed. Parent #134 and other feature branches remain untouched.

**Qualified source/test head: `3eafe8d77ca43499f0ae72b8007f8c202fc8fbec`.** [CI run37127571993](https://github.com/WhiteKiwi/agentprof/actions/runs/37127571993) completed successfully in all four jobs. GitHub tested synthetic merge `e7dec31e961fbb20091becce5cd9bb6e0c51c7d6` against fixed parent `1508ec210110aeb6d1c4042b5396862019d2f752`; this is not a merge-to-main claim.

| Verification | Observed result |
| --- | --- |
| Node24.15.0 / Node24.21.0 / Node26.7.0 | All `pnpm check` jobs completed/success |
| Unsupported runtime early guard | completed/success |
| Full suite, directly inspected Node26.7 job111215912712 | **2,835 PASS / 68 inherited optional SKIP / 0 FAIL**, 113 files:111 PASS / 2 SKIP |
| New fresh-analysis suites | **64 PASS / no new skips**: workflow52 + CLI9 + real-write-races3 |
| Production typecheck/build | PASS; strict compiler options unchanged |
| Actual ordinary Codex and Claude | Both commands: commit1, unchanged-byte reuse1, append revision2 and exact stored/fresh HTML parity PASS |
| Selection/read guards | One source read, one selected analyzer and native admission; source revision/provider mismatch and failed/stale/truncated scan guards PASS |
| Actual intervening writes | A second real collection commits revision2 before receipt1 is returned; both commands refuse export rather than switch generation. This is a deterministic sequential real-write test, not an independent-process concurrency test |
| Publication/abort | Existing output after preflight remains unchanged; internal AbortSignal boundary tests retain committed scan and any completed publication; own listener cleanup PASS |
| Dedicated installed package test | Actual `npm pack`/global install with scripts disabled, outside-repository execution of both commands on ordinary partial Codex input; installed/built JSON receipts, HTML, exit status and private bytes match |
| Existing artifact verifier | **85 artifact files**, scripts-disabled npm-exec/global-install and existing read-only stats/insights/failures checks PASS; `published:false` |

The dedicated fresh installed case covers Codex partial input and both commands. Both provider workflows are separately exercised by real built CLI and source/store integration. These tests do not establish native browser/macOS rendering, hostile-path concurrency, private-user-log usefulness or all-PR/latest-main composition. No local production qualification was run; Node22/container capabilities are not presented as supported-runtime qualification. The 68 skipped tests are inherited optional historical/installed-environment cases, not newly skipped fresh tests.

### Observed failures and corrections

- Initial source `47e8412b0b5a773b4b6a37d03fac9c7fc83639cb`, run37127227695: production typecheck failed at two existing-validator calls because explicit undefined optional properties violate `exactOptionalPropertyTypes`. No tests ran. `70fe899b161182eefcb2fdb02479283c931ec6fe` conditionally omits absent properties rather than relaxing compiler or validator contracts.
- Source `70fe899`, run37127340956: typecheck/build and 63 of the 64 fresh tests passed. One assertion incorrectly expected INTERNAL_ERROR instead of the existing pinned read wrapper's DATABASE_ACCESS_FAILED for an unexpected callback exception. The read-only implementation was inspected; it passes SafeError but safely maps other exceptions. `3eafe8d` corrects that new assertion, retains private-text redaction and committed-receipt checks, and adds no-output verification. Shared DB/error behavior and production code were not changed to satisfy the test.
- The qualified source above reruns every fresh test and the full suite successfully. Failure history is also retained in the PR conversation. This documentation-only receipt commit follows source qualification; its exact CI status belongs in PR/issue handoff after observing it, not an assumed PASS here.

## Handoff and remaining development

Implementation reservation is released at handoff; issue #135 remains open for independent review and parent-first latest-main integration/authorized merge. Preserve the separate source-display coordination issue #136 and original #5/#7/#50 owners. Do not close #6/#7 or automatically merge/release this branch.

Full ordinary provider error/content/change/validation-scope/usage-timestamp capture and parser/checkpoint compatibility, daily tokens, deletion/move/latest source lifecycle and unified all-metric reporting remain separate development. Existing HTML `sourceFreshnessChecked:false` and unknown evidence are preserved. This explicit fresh workflow guarantees only the scan-receipt generation at read time, not continuing input freshness or complete history. Independent review, native browser/macOS/empirical and release acceptance remain unexecuted. No real user logs or secrets were uploaded.
