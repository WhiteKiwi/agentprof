# Bounded source-local metric summary

Reviewed contract and implementation evidence, 2026-10-01. Planning base: `489cd20637e692b27ed6e590af41b04f0858c27f`. Verification base refreshed to main `62e4a7b27fac212292a952403d464ab63d653a6e` after PR23 merged, preserving its CLI and planning-document changes. This independently planned slice was reviewed by the coordinator before a separate development handoff. [The Project-only draft](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259630371) owns execution status and claims; this document owns the algorithm and verification evidence. The existing P5 report reservation is unchanged.

## Boundary

`src/analysis/source-summary.ts` exports the internal `summarizeSource(source: StoredSource): SourceSummary` primitive. Its input must be a validated, non-null result of `createSourceStore(...).readSource`. A missing source stays the caller's null read result, not a zero summary. TypeScript typing and numerical/cardinality guards do **not** validate arbitrary JSON, hostile objects or getters. Such an entry point needs a separate reviewed contract.

The function performs no I/O, clock access, source discovery, storage mutation or SQLite runtime import. It describes one completed source byte prefix and revision, not a complete session, history, project or time window. Output has `schema: agentprof.source-summary/v1`, source/provider/revision, completedOffset/observedSize, persistedScope, availability, copied capabilities, inventory, explicit eligibility and metric cohorts. `scope=source_prefix`, `crossSourceReconciled=false`, `aggregationReady=false`, `parserResumeReady=false` are fixed. No collection timestamp, source path, raw observation or payload is invented or emitted. Output inherits safe labels/identities from the existing validated input, with no widened label contract.

Cross-source reconciliation cannot be inferred from source order, latest revision, longest file or component maxima. Persisted schema 3 omits metadata segments, wrapper relationships, message graphs and adapter recovery state. Two variants remain separate results even when canonical event IDs match. There is no combining API. CLI `stats`, `insights`, `report` and `open`, percentages, active/busy time, interval unions, task elapsed, cost, cache savings, tool/phase token attribution and provider support promotion remain outside this slice.

## Inventory and suppression

Inventory counts retained records: events, turns, usage, observations and diagnostics, plus separate event statuses/outcomes and usage selection/finality counts. Evidence-absent counts are null, not zero. `rg` no_match remains an outcome of completed execution rather than being reclassified as failure.

Metrics are conservatively suppressed for the whole source, using this precedence:

1. unavailable → `source_unavailable`
2. absent historical metric evidence → `evidence_absent`
3. stateLimited or diagnosticsDropped > 0 → `state_limited`
4. ambiguousRecords > 0 or any retained ambiguous-origin observation → `ambiguous_origin`

Suppression preserves inventory/capabilities and records source-suppressed exclusions; duration/usage metric sections are null. Partial shape coverage or unsupported records alone do not erase sound observations. Every summary carries `source_local_only`, `observed_eligible_subset`, `no_usage_population_denominator` and `no_interval_aggregation`; partial coverage adds its warning. Underlying capabilities still expose other limits when more than one suppression condition applies.

## Duration algorithm

Group by `(sessionId, category, toolName, commandPattern, durationScope, timingEvidence)`. Include only completed/failed events with finite nonnegative duration ≤ MAX_SAFE_INTEGER, known scope, and source_reported or paired_timestamps evidence. Never mix scopes or estimated/measured evidence.

Exclusion precedence partitions each record once: source suppression, cancelled, pending, unknown status, missing duration, invalid duration, unknown scope, estimated timing, unknown timing. `terminalCandidates` counts completed/failed records before timing filters. `included + sum(exclusions) = inventory.events`. Each emitted cohort has real sample `n`, checked sum and mean, maximum, nearest-rank p50/p95 (`sorted[ceil(q*n)-1]`), `lowSampleP95 = n < 20`, and bounded contributing IDs. IDs sort lexicographically without locale; cohort ordering is also deterministic. Empty metric sections are null.

Duration sum is an invocation-duration sum, never occupancy. Two overlapping 10-second calls still sum to 20 seconds; no 15-second busy value is inferred. Floating durations use ordinary IEEE-754 arithmetic, verified approximately rather than claiming exact real-number arithmetic.

## Usage algorithm

1. Partition cumulative, unverified and non-response snapshots first. A snapshot can reference the same response ID without being duplicate response usage.
2. Group response candidates by `(provider, sessionId, responseId)` before eligibility or finality/mapping cohorts. Include provisional, invalid and conflicted response candidates in this reconciliation. Compare every semantic usage field, excluding only row ID/sourceRef; limitation order is immaterial. Identical rows select the lexicographically smallest representative. Contradictions exclude **every** row in that response group and report `duplicate_response_conflict`, excluded group count and excluded row count. Never retain an eligible first row, choose maxima or hide contradictions in separate finality buckets. Null response IDs cannot establish a duplicate identity.
3. Require selection eligible, finality source_terminal or trusted_final, a response ID, provider-validated mapping, countStatus complete and known safe integer input/output/total. Other rows have explicit exclusions. The stricter complete-component rule intentionally excludes some partially known Codex usage.
4. Group selected unique responses by `(sessionId, provider, mapping, finality)`. Source-terminal observations and trusted-final fixtures remain separate.

Accounting: `selectedRows` and `observedResponses` count selected unique responses; `deduplicatedRows` counts discarded identical response rows, including ineligible candidates; `excludedRows` counts remaining exclusions, including every row of contradictory groups. Thus `selectedRows + deduplicatedRows + excludedRows = inventory.usage`, and exclusion-reason counts sum to excludedRows. Ineligible identical groups exclude their representative once; conflicting groups are never also counted as deduplicated. Counts describe observed retained usage, not all responses: no persisted missing-usage denominator exists.

Sum input/output/total once. Codex cached input and reasoning output are subsets; do not add them again. Claude input is already uncached + cache-read + cache-create; do not re-add those. Emit input/output/total/cachedInput/cacheWriteInput/reasoningOutput/uncachedInput; nonapplicable components remain null. Each optional aggregate is null unless every selected row knows that component; no partial-known-subset sum or missing-to-zero coercion. Claude reasoningOutput and Codex uncachedInput stay null. A selected all-zero response remains observed zero, with any `zero_or_source_default` limitation retained.

Current schema-3 validation requires all optional Codex components to be non-null when countStatus is complete. The all-row optional-null safeguard is additionally tested at the typed calculation boundary; current persisted incomplete rows are excluded by the strict completeness rule. Store/parser validation is unchanged, and this defensive test is not evidence of a newly accepted persisted shape.

## Bounds, arithmetic and immutability

Hard caps match existing readSource ceilings: 4,096 events/turns/usage, 8,192 observations/diagnostics. A violated cap throws fixed `source_summary_limit_exceeded` before iterating payloads; no caller options raise limits. Grouping/ordering is O(n log n) maximum with O(n) retained data and total contributing IDs. No per-group full-source scan or Cartesian join occurs.

Checked nonnegative finite sums cannot exceed MAX_SAFE_INTEGER. Overflow nulls the affected sum (and duration mean) and adds `numeric_overflow`; independent sample counts, maxima, quantiles and nonoverflowing token components remain valid. No Infinity, saturation, BigInt JSON or partial total is emitted. Empty selected sets are null, never zero totals. Output is deeply frozen with independent capability/label arrays; input objects are neither mutated nor frozen by the summary.

## Verification plan and actual evidence

The pre-implementation Project plan recorded four steps and concrete Verify entries. The following table records the local implementation handoff; final review/publication evidence is recorded separately below:

| Step / concrete Verify | Actual result |
| --- | --- |
| Internal contract: absent/unavailable/ambiguous/state-limited/diagnostics-dropped suppression, empty versus zero, inventory partitions, prefix/revision, copied frozen output, no input mutation/runtime imports | PASS in unit and persisted integration tests |
| Duration: 0/1/19/20 nearest-rank, overlapping sum only, scope/evidence/stream/label separation, no_match completed, disjoint exclusions, deterministic equal-duration ordering, fractional arithmetic, overflow | PASS; overflow preserves n/p95 and nulls sum/mean |
| Usage: provider cache semantics, finality separation, zero, strict eligibility, snapshot separation, parser partial6→final10 selection, all-row optional null, identical/ineligible duplicate accounting, whole-group conflicts across finality/mapping/selection/count/limitations/turn, overflow | PASS; production-shaped Claude remains provisional/null, trusted harness fixtures remain separately labeled |
| Persisted integration: both adapters → store → close/reopen → read → summary; rescan replacement; two separate source variants; source/DB bytes/revision unchanged by summary; raw sentinels absent; store rejects incomplete complete-component rows | PASS across seven integration tests |
| Bounds: every over-limit collection rejects; exact 4,096 event/usage ceiling accepts and total contributing ID counts remain 4,096 each | PASS; bounded synthetic evidence, not full-history performance |
| Full `npm run check` | PASS: 20 test files / 427 tests, including 36 new unit and seven integration cases; typecheck, build, tarball npm-exec help/version and isolated global-install help/version |
| Independent reviewer and exact published-head supported-runtime CI | NOT RUN at implementation handoff; coordinator-owned gate |

Local verification: Node 24.19.0, Linux x64, 2026-10-01 13:27 UTC. Command: `npm_config_cache=<workspace-cache> npm run check`. Initial artifact verification failed because the default home npm cache directory was unavailable; using the permitted workspace cache resolved it, and the complete check was rerun successfully. No dependency changes, install scripts, package publication, merge or deployment were performed. The internal module does not change the existing distribution manifest.

No new actual-user-log execution, full-history throughput/coverage, global aggregation, CLI/report integration, all ten metrics/six diagnostics, full P5/P6 completion or provider-version support is claimed. Follow-on consistent enumeration and cross-source canonical reconciliation require a separate reviewed plan before any global stats/report connection.

## Repository-owner integration review (2026-10-01)

All seven changed files were reviewed at implementation head
`9cb0b19675cb8f695ceee3b6860780e5ccdab932`: one production file selected by
OCR delegate and six manually reviewed documentation/test files. No additional
actionable findings were identified. Review confirms the validated-input-only
boundary, conservative suppression, disjoint eligibility accounting, measured
cohort separation, whole-response conflict exclusion and source-local scope.

- PASS: macOS arm64, Node 24.15.0, 24.21.0 and 26.7.0; each full
  `npm run check` passes typecheck, build, 427 tests across 20 files and the
  33-file artifact check, including synthetic adapter/store/reopen integration
  and script-disabled packed-install verification.
- PASS: Node 22.16.0 returns `UNSUPPORTED_RUNTIME`, exit 2 and no stdout.
- PASS: 33 documentation files, 231 local links, 23 Markdown anchors and
  `git diff --check`. This review follow-up changes only this document; the
  other six reviewed files retain their verified content hashes.

Final publication-head hashes, exact-head Linux CI and merge evidence are
recorded in [PR #24](https://github.com/WhiteKiwi/agentprof/pull/24) and the
[source-summary Project item](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259630371)
after verification. Full P5, global reconciliation, report integration and
full-history resource acceptance remain open. No npm release is part of this
review.
