# Source-local observed invocation interval union

## Status and authority

Planned narrow opt-in view on merged main `38871590fb00efba2b1efd64f1b7639572365fce`, tree `e189f4a259de4f1a95e538c24a89845e8200b053`. The [Project draft](https://github.com/users/WhiteKiwi/projects/2/views/1?pane=issue&itemId=260255296) owns live status and the twelve-path reservation. Documentation and the independent ordinary-input oracle precede production implementation. All execution evidence below is NOT RUN until an explicit receipt is appended.

## Observable contract

`stats --source FULL_ID --invocation-overlap` reads one pinned existing source generation without writes, migration, raw scans or freshness checks. It is mutually exclusive with failures, read-revisits and listing. Duplicate flags, roots, periods and positional arguments fail before I/O. Existing command output remains unchanged except the declared new help option and explanation, including necessary Commander alignment padding. Source-summary's `no_interval_aggregation` limitation remains unchanged.

This separate view initially supports only ordinary Claude native terminal invocations admitted by the unchanged source-failures provenance gate. Completed and failed terminal IDs are eligible; pending, cancelled, unknown, model and unsupported call classes are not. The unchanged gate runs exactly once and preserves whole-source and whole-session conservative suppression. Codex is unsupported.

Each session-local compatible evidence partition uses only `intervalScope=invocation_latency`, `intervalTimingEvidence=paired_timestamps`, valid positioned start/end boundaries and exact ordinary result/end linkage. Claude call observations do not retain call timestamps: the already validated adapter start boundary is relied upon only after independent raw adapter-to-store proof. Durations are independent; `durationMs` never positions an interval. One-sided, reversed, unknown-scope, conflicted or unsupported-evidence intervals are excluded with disjoint counts. Mixed timed/untimed terminal populations may expose their explicitly positioned subset with partial coverage.

For the admitted positioned subset expose `intervalLengthSumMs`, `intervalUnionMs`, and `excessMs = intervalLengthSumMs - intervalUnionMs`. Merge touching endpoints without adding length. Do not union across sessions or incompatible scopes/evidence. Different invocation IDs count independently even with identical operations and intervals; normalized replay counts once. No valid intervals gives null, while a genuine zero-length interval establishes zero. Validate integer endpoints, each difference, accumulated sum, union and excess; an unsafe calculation yields a specific arithmetic-unavailable reason and null values, never rounded output.

This is observed interval geometry, not runtime, active time, task elapsed time, waste, avoidability, causality, concurrency duration or savings. Three distinct identical ten-second intervals yield sum 30 seconds, union 10 seconds, excess 20 seconds; the excess is not twenty seconds of concurrent wall time. Preserve generation metadata, source-byte window, null query period and false reconciliation, aggregation, parser-resume and freshness flags.

## Implementation and verification order

1. Freeze ordinary synthetic fixtures and independently framed HMAC IDs/raw offsets. Verify ordinary assistant tool_use/user tool_result records through adapter, actual ingestion/store, close and reopen. Explicit sessions, unique invocation IDs, isSidechain false, canonical timestamps and explicit is_error are required. No trusted fixture context or production analyzer supplies the oracle. Stop if the existing adapter contract fails; do not repair inherited paths.
2. Implement the pure immutable analyzer using the inherited admission once and one observation index. Verify disjoint exclusions, subset coverage, safe arithmetic, deterministic ordering and bounded references. Pause for independent analyzer review before CLI wiring.
3. Add the isolated opt-in CLI and bounded human renderer. Verify one pinned read/analysis, argument rejection before I/O, private bytes/modes/entries unchanged and no raw source dependence. Human output shows at most six sessions, complete omission accounting and proof counts; JSON retains complete bounded evidence.
4. Verify focused and full suites, typecheck/build, optional baseline and installed parity with their variables enabled, script-disabled artifact after raw-root removal, complete dist-tree parity and unchanged artifact verifier. Freeze all changed bytes for independent review. Parent owns publication and exact-head CI; no merge, deployment, release, pilot or report integration is established here.

Limits remain 4096 events/turns/usage and 8192 observations/diagnostics. Observation indexing and retained references are linear; sorting is bounded. Human output is at most 160 lines / 32768 bytes, ordinary output at most 35 lines / 4096 bytes, complete JSON at most 8388608 bytes. Use existing Node and dependencies, 512 MiB heap, one worker, focused 120-second caps. Full 600-second campaign requires coordinator scheduling approval. No package, workflow, artifact-script, inherited fixture, parser, normalization, storage, shared analyzer or report changes.

## Frozen independent oracle

Relative canonical UTC seconds, half-open intervals:

| Input | Length sum / union / excess in milliseconds |
| --- | --- |
| [0,10), [5,15) | 20000 / 15000 / 5000 |
| [0,10), [20,30) | 20000 / 20000 / 0 |
| [0,10), [10,20) | 20000 / 20000 / 0 |
| [0,10), [2,8) | 16000 / 10000 / 6000 |
| Three distinct [0,10) | 30000 / 10000 / 20000 |
| [5,5) | 0 / 0 / 0 |

Session separation is tested with independently constructed validated-store synthetic partitions; this does not establish ordinary adapter multi-root support. A raw source that changes its declared root session is expected to remain ambiguous-origin and suppressed.

Also verify replay versus new ID, untimed and one-sided terminal records, reversed timestamps, contradictory result becoming unknown, completed plus failed terminal records, pending/background/unknown/classes, missing or contradictory decisive proof suppressing its session, session separation, missing origin/state limitations, and validated-store scope/evidence mismatch, independent duration, unsafe endpoint differences, sum overflow and maximum bounds. Tests freeze these expectations before production implementation.

## Executed evidence

NOT RUN: ordinary-input gate, analyzer checks/review, CLI checks, aggregate campaign, artifact/parity gates and independent final review. Local synthetic success does not establish real-user timing validity or provider-version support beyond recognized shapes.

### First ordinary-input gate correction

The first focused run passed nine tests and failed one incorrectly proposed positive multi-root fixture. Source inspection shows the Claude adapter binds a source to its initial root session and marks a different declared root as ambiguous. The expected result was corrected to source suppression, with the original failing receipt and original freeze preserved outside the repository. No production, parser or storage behavior changed. Cross-session geometry will be verified through a separately labeled validated-store synthetic case. The six ordinary geometry cases all passed in the original run.

### Local staged evidence (2026-10-02)

Existing Node v24.19.0, `NODE_OPTIONS=--max-old-space-size=512`, one Vitest worker and no file parallelism; each command bounded by `timeout 120s`.

- Original ordinary-input gate: 9 passed / 1 failed. The incorrect raw multi-root positive was corrected as described above; original receipt and oracle hashes retained.
- Corrected ordinary-input gate: 10 passed / 0 failed. This gate proves boundaries/identities and persistence, not union computation.
- Pure analyzer typecheck: PASS with `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`.
- Initial analyzer/integration run: 49 passed / 1 failed because a synthetic store fixture combined unknown interval evidence with a known interval scope, which the existing validator correctly rejects. Correct the fixture to unknown scope plus unknown evidence, preserving separate source-reported unsupported-evidence coverage; no storage or analyzer relaxation.
- Corrected analyzer/integration run: 50 passed / 0 failed across `tests/source-invocation-overlap.test.ts` and `tests/source-invocation-overlap-integration.test.ts`. Actual analyzer assertions now consume all six hand-calculated geometry constants, replay/new-ID and partial coverage. Validated-store synthetic cases cover session separation, independent durations, endpoint-difference overflow and sum overflow. Maximum 4096-event / 8192-observation references remain bounded; immutable deterministic output and exactly one inherited admission call are checked.

The single currently supported compatible scope/evidence pair produces one partition per inherited session. Per-partition coverage reports admitted terminals, positioned events, disjoint exclusions and unsafe endpoint differences. Contributing event IDs and selected ordinary call/result proof IDs remain complete, with at most two retained proof references per positioned event; arithmetic-unavailable partitions retain candidate evidence references and null measurements. These references do not assert a successful aggregate when arithmetic is unavailable. Later CLI/full/artifact/publication checks remain NOT RUN.

### Narrow inherited-help verification amendment

The Project reservation was extended to thirteen paths before editing `tests/cli-read-revisits.test.ts`. The new longer flag adds exactly five spaces to existing option alignment versus main `38871590`, and six versus the intended inherited pre-read-revisits baseline `b8ea155829e6ee095fb0eafbf4774bc264a94eaa`. Commander wraps only the existing read-revisits option description onto the exact 24-space `--source` continuation. The new option description is kept on one line.

The inherited optional test still compares against its original baseline through `AGENTPROF_BASELINE_BINARY`: it removes only the exact new overlap and read-revisits option/support text, asserts each occurs once, and converts four enumerated padding widths. New parity uses `AGENTPROF_INVOCATION_BASELINE_BINARY` against merged main, removes only the exact overlap text, explicitly rejoins the known read-revisits continuation and converts five enumerated padding widths. All retained help content and all status/stdout/stderr for other commands remain byte-exact. No broad whitespace normalization, skipped gate, verifier change or baseline replacement is allowed.

The optional installed variables are `AGENTPROF_INSTALLED_BINARY` for inherited tests and `AGENTPROF_INVOCATION_INSTALLED_BINARY` for the new suite. Artifact setup uses a local tarball and script-disabled offline installation with existing dependency versions/cache; missing cache is a stop, not permission for a network retry.

### CLI-focused evidence before aggregate review

- Production typecheck/build: PASS. CLI keeps one pinned stored generation and lazily invokes the new analysis only when requested.
- First CLI-focused run: 78 passed / 22 failed / 13 optional skipped. Twenty-one failures were a pluralized analyzer name in the new test helper; one was an all-missing synthetic fixture that retained a positioned scope. Both test-construction errors were corrected, with the original receipt retained. No production validator was weakened.
- Four new suites with main-baseline parity enabled: 111 passed / 2 installed optional skipped. The subsequent script-disabled offline local-tarball installation succeeded without a network retry; all 43 installed dist files match current bytes and modes.
- Four new suites with both main-baseline and installed options enabled: 113 passed / 0 skipped. Subsequent additions were a background-acknowledgement regression in the new integration test and optional renderer receipt capture only.
- Inherited read-revisits suite against its original baseline, plus the new integration suite including background acknowledgement: 76 passed / 0 skipped. The thirteenth path changes only the exact help assertion.
- Final renderer receipt run: 5 passed. Ordinary output is 23 lines / 3042 bytes; the 4096-session synthetic maximum is 53 lines / 5841 bytes, complete JSON 3901307 bytes. One-session 4096-event output has complete JSON 1351241 bytes. Every tested shape is within the declared limits.

The full aggregate campaign, unchanged artifact verifier and final independent all-path review remain NOT RUN at this checkpoint. Focused results do not imply full acceptance.

### Final local aggregate verification

The coordinator-approved single campaign completed with exit 0 inside the actual 600-second outer deadline. Existing Node v24.19.0 / Linux x64, 512 MiB heap, one Vitest worker and no file parallelism were retained. The chain rebuilt the hash-verified merged-main baseline, then ran the unchanged required stages: typecheck, build, `npm test -- --maxWorkers=1 --no-file-parallelism`, and `npm run verify:artifact`.

- All 44 test files / 1216 tests passed, zero skips; Vitest duration 215.26 seconds. Both intended baseline variables and both installed variables were enabled. This includes all ten inherited fixture command sets, initial/reused scan, source list, selected stats, insights, failures and read-revisits with exact status/stdout/stderr parity, plus declared help adjustments only.
- Unchanged artifact verifier: PASS, 45 packaged files; tarball npm-exec and isolated global-prefix help/version, read-only stats/insights/failures parity and private-store preservation, install scripts disabled. This verifier's existing feature-specific checks are not relabeled as overlap coverage: the separate new installed overlap suite supplies ordinary, unsupported and suppressed human/JSON parity after raw-root removal.
- Complete current/installed dist parity: all 43 runtime files have equal bytes and modes. The isolated installation used an offline local tarball and existing cache; the unchanged verifier retained its approved normal pinned-dependency setup.
- Source and command behavior remain within the thirteen-path reservation. The extra inherited test edit is only the exact help assertion. No production parser, normalization, store, shared analyzer, package, workflow, artifact-script, inherited fixture or report path was edited.

Independent ordinary-oracle, analyzer and CLI/help review stages approved their frozen contents. Earlier failures and corrections above remain part of the verification record. Exact published-head CI, other supported Node/OS execution, real-user logs/pilot, paid benchmarks, release, merge and report integration are not established by this local campaign. Publication belongs to the coordinator; this change is prepared as a draft PR.
