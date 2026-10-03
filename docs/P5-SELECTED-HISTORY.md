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

Plan recorded before implementation. Implementation, supported-runtime qualification and publication are pending; no PASS claim yet.
