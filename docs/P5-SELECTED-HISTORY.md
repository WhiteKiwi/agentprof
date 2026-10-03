# Selected-source native-call history

## Specification addendum — 2026-10-03

Continue the remaining cross-source/query/trend development in parent #6. This is not another summary-only stats flag. Add `history --source FULL_ID [--source FULL_ID ...] --from UTC --to UTC [--offset +09:00] [--session FULL_ID] [--json]`.

The command reads a bounded explicit selection in one existing read-only transaction. It reconciles exact canonical native-execution identities across selected stored prefixes, retains source revision manifests, and calculates fixed-offset daily call counts, compatible interval sums/unions, concurrent time and exclusive category time. No automatic source discovery, writes, scan, migration, latest-file selection, network request or browser action. Existing commands are unchanged except the additive top-level command row.

Baseline is PR #128 head `9b162601535fb68f5ce546c486151abbf50511b9`; publish a stacked draft against `feat/source-pattern-engine`. Reuse that PR's native-admission/position proof boundary, not unverified event timestamps. Preserve the oldest-first stats review coordinator, #5/#7 broad ownership and #50's exploration scope.

## Reconciliation and measurement contract

- Source IDs are explicit and unique, at most 16. Same installation key/normalization contract only. Read each requested generation once in one transaction; never mix pre/post-writer revisions.
- Canonical identity is provider + execution ID. Compare all semantic normalized-event fields, excluding only physical sourceRef, and compare parser/normalization/key versions. Different sourceRef locations do not by themselves mean different executions.
- Repeated identical admitted copies count once. Any semantic/contract disagreement excludes that canonical execution as a conflict; no newest-source, largest-prefix or convenient-success winner. An unadmitted/suppressed copy cannot be silently ignored to rescue another copy. Every copy keeps source ID, revision, admission/position state and proof IDs; raw paths/commands/output/fingerprints are not emitted.
- An event absent from another selected source is not an explicit conflicting observation. The algorithm is a union of stored observations, not a latest-session reconstruction. Different canonical IDs are not heuristically merged. Same-looking commands are not execution identity.
- Complete source suppression and unresolved provenance stay visible. Reconciled unpositioned terminals remain in the inventory but never receive a fabricated day or zero duration. Unknown/pending/unsupported actions are excluded observations, not confirmed failures.
- Query period is explicit UTC `[from,to)`, nonempty and at most 366 days. Offset is fixed, default `+00:00`, within -14:00..+14:00. It is not an IANA/DST timezone. Daily windows intersect the query; no zero-filled missing-history days.
- Completion counts use verified end timestamps in `[from,to)`. Intervals are clipped to the query and split at offset-local midnights. Calls crossing midnight contribute elapsed interval portions to both days, but a completion counts only once. Calls that overlap the query and complete outside it can contribute time with zero in-period completions. Zero-length calls can count as completions while contributing measured zero time.
- Partition every daily value by provider, session, intervalScope and intervalTimingEvidence. Never add incompatible partitions into a global busy/active time. Interval sums may overlap; busy union and simultaneous-call/category time stay distinct. Session identities are exact filters, not inferred task/person identities.
- Counts of missing/unpositioned/conflicting observations describe the selected source prefixes, not an invented dated population. Partial input yields an explicitly partial observed subset, not a complete account/session/history total or a performance verdict.

## Findings before implementation

PR #128 exposes `buildPatternContext` after one unchanged `analyzeSourceFailures` pass. It validates ordinary paired or structured boundary evidence and preserves proof IDs without exposing keyed identities. `measurePatternIntervals` already separates sum, union, concurrent calls/categories and exclusive category time with safe arithmetic and immutable output. Reuse these contracts.

Stored usage rows currently have no general verified response timestamp. Assigning token usage to file mtime, source revision time, nearby tool calls or inferred turns would fabricate daily token attribution. This slice therefore does not expose daily tokens. Provider timestamp/error/content/change/scope capture and full historical source lifecycle are separate remaining development, not QA. Existing source-local token results remain unchanged.

## Implementation and concrete Verify

1. Implement pure selected-source reconciliation, explicit manifests and privacy-safe copy receipts. **Verify:** identical archive/live copies count once; semantic/contract conflict and unadmitted-copy cases cannot pick a winner; different IDs/sessions/providers are not accidentally pooled; ordering invariance; no mutation or raw identity disclosure; source/key/version/input limits.
2. Implement explicit UTC/fixed-offset windows, optional exact session selection and daily interval projections. **Verify:** half-open endpoints, invalid/calendar/offset dates, cross-midnight clipping, leap-day and +09:00/-03:30 boundaries, zero intervals, out-of-period completions, gap days, sum20/union15, category concurrency, separate scope/evidence and 366-day/resource caps. Compare randomized small cases to an independent time-grid oracle.
3. Add read-only `history` command and bounded human/complete JSON output. **Verify:** repeated explicit source collection, duplicate/conflicting/root/extra/unknown options rejected before I/O; one pinned transaction/read per source, source/key absence/corruption safe failures; raw-deleted actual stored Codex/Claude fixtures; unchanged DB/key bytes; original command compatibility; no hidden scan/list.
4. Publish a draft and qualify supported-runtime tests. **Verify:** production typecheck/build, targeted and full suite, existing artifact verifier, exact-head cloud CI; new command-specific installed artifact probes when available. Record actual failures/skips/unexecuted checks without treating draft publication as merge/completion.

## Resource boundaries

At most 16 selected sources, 16,384 event copies and 32,768 observation copies; at most 4,096 canonical executions and 32,768 daily event memberships. Refuse an oversized query rather than silently truncate calculation. Human output shows bounded source/exclusion/day sections and exact omission counts. Complete JSON has an 8 MiB refusal boundary, never silently drops evidence. UTC years 0001–9999 only, including offset-shifted period boundaries. A valid bounded query that exceeds a resource limit is rejected with the documented safe INVALID_ARGUMENT error.

## Ownership

Owner/coordinator: this ChatGPT continuation; a runtime UUID or independent development/review subagent is not available and is not invented. Scope: new history query/reconciliation/projection/CLI modules, new synthetic tests, this maintained plan, and only additive command import/registration in src/cli/main.ts. No mutation of parser/store/schema/normalizer/old stats/report/insights/CI/dependencies or other feature branches. Independent maintainer review and authorized merge remain required. Use synthetic fixtures only; never upload user logs or secrets.

## Execution record

### Published stack and qualified revisions

Implementation and synthetic qualification are complete in [Draft PR #130](https://github.com/WhiteKiwi/agentprof/pull/130), tracked by [#129](https://github.com/WhiteKiwi/agentprof/issues/129). This does not merge the change or complete parent #6.

- Source/test head: `8092fd394975d2091e6bae5d06fc6b6a9bad26bf`.
- Fixed parent: PR #128 head `9b162601535fb68f5ce546c486151abbf50511b9`.
- Tested pull-request merge: `a7fbbdca5392abab8c36bce3f24ef3bf5386e6ef`.
- [Run 37123626499](https://github.com/WhiteKiwi/agentprof/actions/runs/37123626499): all four jobs observed completed/success. Node 24.15.0, 24.21.0 and 26.7.0 execute `pnpm check`; the unsupported-runtime job verifies the Node22 early guard.
- The Node26.7 job [111204506840](https://github.com/WhiteKiwi/agentprof/actions/runs/37123626499/job/111204506840) log was read directly. On Linux x64 / Ubuntu 24.04 it reports **2,708 passed / 68 inherited optional skipped / zero failures**, across 104 files (102 passed / two skipped). Typecheck, build and artifact verification pass.
- This receipt is a documentation-only follow-up to that qualified code. Its resulting exact commit and final CI status are recorded in PR #130 and issue #129 after readback, rather than predicting a self-referential commit SHA here.

### New history qualification: 75 tests, no skips

| Suite | Executed result |
| --- | --- |
| `history-query.test.ts` | 27 PASS: canonical UTC, calendar/leap/range bounds and fixed offsets |
| `source-history.test.ts` | 20 PASS: copy/conflict/admission gates, deterministic privacy-safe reconciliation, daily clipping and compatible time arithmetic |
| `history-cli.test.ts` | 23 PASS: actual Codex/Claude scan/store/raw-deleted inputs, three-file duplicate copies, exact session selection, one pinned read/native pass per source and actual built CLI guards |
| `history-installed.test.ts` | 1 PASS: isolated scripts-disabled tarball installation, real identical/conflicting copy logs, raw deletion, installed/built human and JSON parity, unchanged private bytes |
| `history-defensive.test.ts` | 4 PASS: sparse-array rejection, -03:30 midnight and oversized complete JSON refusal |

The source-history suite contains one test comparing **200 deterministic interval populations** to an independent millisecond-grid oracle. These are 200 populations inside one test, not 200 additional Vitest tests. Literal overlapping 10-second calls produce sum20/union15; midnight splitting retains one completion while allocating interval portions to each day. Unknown boundaries have no invented day.

The defensive output case builds 1,000 admitted synthetic executions across 20 days, retains **20,000 actual daily partitions**, and verifies that the complete JSON exceeds 8 MiB and is refused with `INVALID_ARGUMENT`, rather than clipped. Bounded human output still reports the exact omission count. This is an output/resource guard, not a representative performance benchmark or exhaustive cross-product limit qualification.

### Installation and integrity

The dedicated history test uses `npm pack --ignore-scripts` and isolated `npm install --global --ignore-scripts` with a private cache/prefix, then invokes the installed CLI outside the repository. It checks that compiled history code is in the artifact and source/tests/JSONL/SQLite inputs are absent. Actual synthetic live/archive copies count once; a status-conflicting copy excludes only the conflicting canonical execution. Both JSON and human output match the built executable after source files are removed, and private store/key bytes are unchanged. No registry publication occurs.

The unchanged general artifact verifier also passes with **79 artifact files**, tarball npm-exec/global-install help/version, and existing read-only stats/insights/failures probes. Its result explicitly says `published:false`; the new history-specific installation claim comes from the dedicated test above, not from those older probes.

All ten new production/test file blob IDs matched local reviewed copies through readback or write acknowledgement. The actual `main.ts` pull-request patch contains only the additive history import and registration. Local Node22/TypeScript5.8 syntax transpilation is supplemental; it is not the supported-runtime typecheck, build, SQLite or installation qualification. No user logs, source commands, outputs or secrets were collected or published.

### Failures preserved and corrected

1. `54ce4f3` / run37122807764 passed production typecheck/build and query/calculation tests, but two CLI tests failed in their shared fixture setup because `runScan` requires an explicit `claudeRoot: []`. Commit `063c9fb` fixes that test setup. No production scan API change, assertion removal or skip was used.
2. `416abc7` / run37123146927 passed all 70 query/calculation/CLI tests. The newly added installed test wrongly expected scan exit0. Ordinary failed calls without error identity correctly produce `INSUFFICIENT_ERROR_EVIDENCE` and partial/exit1 while committing both sources. Commit `0336865` asserts that exact partial state, committed2/failed0/rejected0, and diagnostic counts two for identical failed copies and one for the conflicting variant. It does not suppress warnings or force a healthy scan result.
3. Review found that sparse programmatic source arrays could bypass `Array.some`. Commit `2d456d2` materializes their slots for validation before storage access; regression tests cover that boundary. `8092fd3` finalizes the independently exercised large-output case. The final run above passes all 75 new tests without skips.

### Handoff and remaining development

PR #130 remains Draft/open/unmerged. Release the active implementation reservation at handoff; independent maintainer review, parent #128 qualification/merge and composition with current main are still required. Re-run the full suite after retargeting/integration. This fixed-stack PASS is not a receipt for every other open feature PR or for the latest evolving main.

General ordinary-provider error/content/change/validation-scope capture and verified usage timestamps, associated parser/checkpoint compatibility, daily token attribution, source deletion/move/latest-history reconciliation and broader report/diagnostic/history integration remain development work. Existing owners of #5/#7/#50 and the oldest-first stats review are not superseded. macOS/native browser checks, real-user usefulness, representative resource/false-positive evaluation and release approval are not performed here. Do not classify all remaining work as QA-only or close broad product tickets on this narrow qualification.
