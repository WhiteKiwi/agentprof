# Read-only selected-source insights

## Status and boundary

Coordinator-reviewed contract, 2026-10-01. Written before production implementation on merged PR28 main `094e26a085d09a4e1415b09ba10ac06eea7c91b2`, tree `aa90b6f62ed0b8fb4aa7d76bf3f083920d9852b0`. All 165 inherited blobs/modes were verified against its untruncated remote tree. The earlier reviewed integration `bc93c43e473fc820be344815560f42f48ae462f4` is retained in that history; the final external review changed only IMPLEMENTATION and P5-SOURCE-SLOW-TOOL, both preserved verbatim. PR27's final three-document corrections remain intact. The external reviewer closed narrow Project item 259944711 as Done and explicitly released all editing reservations after its verified merge. Existing P5 report paths/display-model reservation remains untouched. The separate [insights Project claim](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259999765) and its Owner/session/Status were saved and read back before production implementation. The coordinator approved these maintained contracts, then separately reviewed the one-read selection/JSON checkpoint and complete human renderer.

The narrow outcome is an accessible CLI for the existing provenance-backed source-local Slow Tool rule. It is not a new rule, a report or a measured optimization. A successful command means a selected stored generation was read and analyzed, not that its evidence was complete. Product-wide six-rule/ten-metric acceptance, global reconciliation, actual HTML and real-user usefulness remain open.

## Observable command contract

`agentprof insights --source <full-source-id>` requires exactly one full source ID. Use existing `agentprof stats --list-sources` or scan JSON to obtain it. Global `--json` and `--data-dir` work before or after the command. Exactly one duplicate source option is already too many, even when the strings match.

Bare insights fails before storage I/O with `INSIGHTS_SELECTION_REQUIRED`, exit 2 and empty stdout. Its fixed message guides the user to `agentprof stats --list-sources` and `agentprof insights --help`. Invalid/truncated/wrong-domain IDs, positional arguments, unknown options, `--list-sources`, `--last`, provider-root flags in either position and invalid directory syntax also fail before storage I/O. Help/version remain storage-free and do not load SQLite. `report` and `open` remain pending.

A valid selection reads only an existing private current-schema DELETE-mode store. No scanning, raw-input lookup, freshness verification, migration, key generation, directory/file creation, chmod, recovery, journaling-mode change or all-source query occurs. A wrong installed identity key yields `INVALID_IDENTITY_KEY`; a correctly keyed but absent source yields `SOURCE_NOT_FOUND`. Fixed safe errors go to stderr with exit 2; arbitrary exception text, raw IDs and paths are never echoed.

Only two existing error-message strings become command-neutral: `DATABASE_SCHEMA_INCOMPATIBLE` and `DATABASE_MODE_UNSUPPORTED` begin with “Read-only source commands require…” instead of “Stats requires…”. Their codes, meanings, envelope and exit remain unchanged. Neighboring scan/stats success outputs are unchanged.

## Result and evidence identity

`runInsights` returns an immutable `{mode: "selected_source", analysis: SourceSlowToolAnalysis}`. JSON is exactly `{schema: "agentprof.cli/v1", ok: true, command: "insights", result}` plus one newline. The existing rule result is embedded unchanged, retaining all denominator event IDs, candidate event IDs and decisive observation IDs. Do not wrap it in a list of rules, invent persistent identifiers/timestamps, rewrite state or add aggregate values.

Inside one existing pinned synchronous `withReadOnlyStore` callback, validate installed key binding, create the source store, call `readSource` exactly once, analyze that generation exactly once, and return it. Lazy-load the read-only store, source store and rule after existing CLI validation. Reuse `validateSourceSelection` from stats and existing path/identity helpers; do not introduce another validator or refactor other commands.

Missing evidence and unavailable sources succeed with suppressed analysis. Partial, no-eligible-events, zero denominator and no-candidate outcomes also exit 0. `candidates=null` is an unavailable assessment with its actual reason; an empty array is an evaluated outcome and does not mean no bottlenecks.

## Human output

Render immutable analysis without recomputing eligibility, sums, shares, quantiles or confidence. Keep rule-provided partition and candidate order. Show every bounded partition and candidate; there is no global ranking, top-N or truncation. Bucket candidates by partition once, then visit partitions/cards once.

Front matter contains source ID, provider, revision, scope, availability, persisted scope, completed/observed byte bounds, observation window, parser/normalization/key versions, rule ID/version, minimum five timed calls / 0.2 share and p95 low-sample cutoff. Display assessment and both suppression/candidate-assessment reasons, support/coverage and known partial/excluded status. The observation window is source bytes, not a date range. No freshness, other-source conflict, complete-session/history or collection-time claim is made.

Inventory preserves event statuses/outcomes, events/turns/usage/observations/diagnostics counts, tentative/admitted timed calls, all nonzero disjoint event exclusions with unlisted=0, unresolved events and provenance-failure counts. Show observation inventory separately: wrapper IDs, linked execution observations, orphan event references and unlinked observations are not additional call counts or event exclusions. Null is `unknown`; zero is `0`.

Each partition includes its stable result-local ID, full session ID, duration scope, timing evidence, status, tentative count, admitted denominator n/sum in ms, event-reference count and unresolved count. Identity-unresolved and numeric-overflow partitions remain visible with unknown values. A zero denominator is an observed 0 ms sum and unavailable share, not absent input.

Each candidate includes stable result-local ID and partition reference, severity, safe kind/category/tool/pattern, grouping (including coarse tool family), measurement basis, n, sum/mean/max/p50/p95 ms and low-sample flag. Preserve exact fraction with `String(observedEligibleNativeToolDurationShare)` labelled “fraction of admitted compatible native-call recorded duration; 1=100%.” Preserve denominator n/sum; the denominator includes every admitted compatible native call in that source/provider/revision/session/scope/evidence partition, including other categories and groups below five calls.

Keep all confidence fields, full limitations and the exact necessary-work counterexample, investigative action, matched experiment and quality guardrail. Do not weaken required validation. MCP/browser candidates retain the prerequisite of identifying the particular invocation locally; endpoint/target/backend/network diagnosis is unavailable. Report evidence event/observation counts and the empty included-event count, with complete arrays available in JSON.

Display cohorts do not establish same-task/operation identity. Recorded sums may overlap and are not elapsed/busy time, occupancy, waste, savings or population coverage. Necessary work can have 100% admitted share. Do not emit a global Detected Waste=0, token saving or full usage/time total. Partial empty results retain suppressed/excluded partitions rather than claiming absence of bottlenecks.

Use labelled ASCII rows and exact `String(number)` values with ms units, never truthiness or locale formatting. Wrap prose at existing spaces around 100 columns; never clip a validated label or identity or equate JavaScript length with terminal-cell width. No ANSI, TTY/terminal-size dependency, collection date/timezone or fabricated timestamp. Footer repeats false cross-source reconciliation, aggregation/parser-resume readiness and freshness, complete evidence via JSON, and unestablished causal/avoidable-work/effect confidence. Output is intentionally verbose and bounded, not universally compact.

## Resource and privacy boundaries

Inherit existing readSource bounds: 4,096 events, 4,096 turns/usage, 8,192 observations/diagnostics and 32 MiB combined serialized contributions. Rule bounds remain 4,096 partitions/cohorts, 819 disjoint five-call candidates, 4,096 denominator and candidate event references each and 8,192 decisive observation references. Do not add raised limits, catalogue scans, source rereads, arbitrary output cutoff or truncation.

Formatter extra work is O(partitions + candidates + rendered bytes); use one bucket pass and line/chunk assembly. Do not filter the full candidates array per partition, spread bounded-but-large arrays into calls, or repeatedly rebuild all prior output. Account honestly for repeated guidance bytes. Synthetic max-shape output byte/line measurements and structural access counts verify shape; they are not timing, token/RSS savings or real-log benchmarks.

Logs stay inert. Synthetic fixtures only. Raw commands, tool output, paths, endpoint/server names, keys, proof/boundary fingerprints and arbitrary error text stay out of output/artifact. Existing keyed evidence IDs are permitted. The command makes no telemetry, network, browser or report output.

## Ordered verification

1. Freeze base/claim and write contracts before code. Verify: current main, PR28, board/P4/P5/current reviewer; untruncated all-blob/mode comparison, preserved PR27 corrections; Project-only narrow claim with actual identities and explicit ownership release; coordinator contract review.
2. Implement selection/one-read JSON. Verify: both option positions, exact/wrong-key/missing/duplicate/invalid IDs, unsupported flags before I/O, fixed missing/unsafe/corrupt/schema/WAL/sidecar failures, no SQLite help/version, exact rule JSON and unchanged engine/opener/parser/store hashes. Coordinator checkpoint.
3. Implement human output. Verify: independent Codex direct and Claude paired positives, 5/20% and 4-call/19% controls, complete denominator, scope/evidence/session separation, null/zero/partial/suppression/overflow/unresolved cases, low-N 5/19/20, exact fractions, coarse-family guardrails, necessary-only 100%, full IDs in JSON, frozen/permuted input.
4. Verify real synthetic lifecycle/bounds. Verify: both adapters -> scan -> store -> close -> process insights after deleting raw roots, unchanged DB/key bytes/modes/directory entries on success/failure, no missing-path creation, supported concurrent DELETE generation consistency, cleanup/reopen, existing adversarial read-only suite, max partitions/cards/refs, long label, no O(P*C)/clipping, no sentinels.
5. Verify neighboring commands and artifact. Verify: ten existing provider fixtures have identical scan/stats human/JSON output against exact dependency except two fixed error strings; report/open pending; isolated packed installed help/version/insights JSON/human positive/suppressed parity and unchanged store with scripts disabled; no fixtures in package. Run focused/full check, local links/anchors and whitespace on final bytes; log actual environment/counts/errors/retries.
6. Freeze exact eleven-path deliverable. Verify: source base and final mode/blob/SHA256 manifest, unchanged excluded paths and no worker overlap; independent root all-file review; root-only authorized draft publication and exact remote/tree/parent/CI. Keep Project In Progress until merged. No merge/deploy/npm release.

## Evidence status

At contract creation, all new implementation, tests and artifact verification were NOT RUN. Merged dependency tree is untruncated with 165 blobs; each mode/content was copied and checked independently in an isolated local snapshot. Existing rule/opener tests and prior parent checks remain historical evidence, not a pass for this CLI. No real-user logs, macOS execution, user pilot, benchmark, publication or optimization effect is claimed.


## Executed verification — 2026-10-01

The coordinator reviewed the standalone contract before implementation; the external parent review was allowed to finish before its released shared paths were edited. The final merged base, all 165 mode/blob entries and both new external evidence documents were verified before creating the separate narrow Project draft. SPEC received only the current command-capability correction and additive supplement; IMPLEMENTATION/FINDINGS retain the full inherited content as a prefix. P4-UNCHANGED-SCAN and P5-SOURCE-SLOW-TOOL remain byte-identical to merged main. No stale parent evidence was transplanted.

- PASS, Linux x64 Node 24.19.0: `VITEST_MAX_WORKERS=1 npm run check` with an existing writable npm cache. Typecheck/build, **769 tests / 30 files**, and **38-file packed artifact**. The 60 new tests cover selection, one-read JSON, complete human semantics and bounded rendering. Existing read-only adversarial and engine/storage suites remain green. No production gate was relaxed.
- PASS, checkpoint before renderer: **94 tests / 4 files** covering insights/CLI/stats/read-only opener. Both provider adapters are scanned into SQLite, closed, and read in a separate CLI process after raw input roots are removed. JSON exactly equals independent `analyzeSourceSlowTool(readSource(id))`. A spy confirms one selected-source read and one analysis inside the pinned transaction. Both global option positions, duplicate/full/invalid/wrong-key/missing identities and unsupported arguments behave as contracted before I/O.
- PASS, privacy/no-write lifecycle: key/database bytes, modes and directory entries are unchanged on successful and safe failed reads; missing paths remain absent. Schema 0/3/5, WAL and all sidecars, unsafe file permissions, symlink directories, malformed DB headers and corrupt event/metric payloads retain fixed errors without repair or private-text leakage. An unexpected callback error closes safely and permits a later successful read. A pending ordinary DELETE writer cannot make the selected result mix generations; after a supported replacement, the next request observes the new revision. Arbitrary external file/mode/schema races remain outside the inherited concurrency contract.
- PASS, complete presentation: direct Codex runtime and paired Claude invocation latency; exact 5/20% boundary and four-call/19% negatives; compatible denominator including another category/small group; necessary-only 100%; null versus observed zero; unavailable, partial, overflow and identity-unresolved states; low-sample p95 at 5/19 versus 20; exact fractional strings; all confidence/limitation/counterexample/action/experiment/quality text; coarse MCP/browser invocation prerequisite; deterministic frozen/permuted analysis and all JSON evidence IDs. The renderer performs no rule calculations or source rereads.
- PASS, structural bounds: 4,096 distinct partitions, 819 natural five-call candidate cards, all 8,192 decisive observation IDs in complete JSON, and a long store-validated safe pattern with 2,048 flags remain complete. Candidate-array element access is bounded by four visits per card in the maximum-card fixture, ruling out a partition-by-candidate scan. Prose wraps at spaces without clipping identities/labels. The maximum-card human output below honestly includes repeated full guidance.
- PASS, unchanged neighboring commands: all **10 existing synthetic provider JSONL fixtures**, **80 exact process comparisons** against the built merged-base snapshot. Initial/repeated scan and stats catalogue/selected-source human/JSON outputs retain identical status, stdout and stderr. Only the two explicitly documented schema/mode error messages become command-neutral; each new full text is asserted. Report/open pending cases and storage-free help/version remain verified.
- PASS, installed artifact: tarball npm execution and isolated global installation run with lifecycle scripts disabled. Installed positive and ambiguous-origin-suppressed insights have exact JSON/human parity with the local build and unchanged database/key snapshots after raw roots are removed. Installed missing-selection/help do not create storage. Raw fixtures are absent from the 38-file package. No package metadata, dependency, lockfile, workflow, public SDK entry point or publication guard changed.
- PASS, four changed documents: **93 local links / 14 anchors** and whitespace checks. All **158 inherited paths outside the seven planned existing paths** remain exact, including engine/opener/stats/parser/storage/report files and external parent evidence. There are exactly eleven feature-diff paths, with four new files.

The first final focused run passed 58 tests; two additional corrupt-payload integration cases then brought the full result to 769. There were no new implementation test failures in these recorded runs. Initial preparation required an unexecuted command retry because its requested working directory did not exist yet; the isolated merged-base build then succeeded. A final-check reinvocation was stopped before npm because it addressed an unwritable parent log path; it was rerun from the correct repository directory. A temporary human stub existed only for the coordinator's selection/JSON checkpoint and was replaced before presentation/artifact/full verification; it is not the final behavior.

### Synthetic output shape receipts

These are generated formatting byte/line counts on Node 24.19.0, not execution timing, peak RSS, token savings, real-log usability or optimization-effect measurements. Every human result ends in one newline; line counts exclude the trailing empty split field. The fixtures are independent, not a claim that all maximum dimensions can occur simultaneously.

| Synthetic case | Events | Partitions | Candidates | Human UTF-8 bytes | Human lines | JSON UTF-8 bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| codex-direct | 6 | 1 | 1 | 5477 | 85 | 6918 |
| claude-paired | 6 | 1 | 1 | 5485 | 85 | 7471 |
| coarse-mcp | 5 | 1 | 1 | 5599 | 86 | 6927 |
| partial-zero-unresolved | 6 | 2 | 0 | 3941 | 64 | 3720 |
| evidence-absent | 5 | 0 | unavailable | 2751 | 43 | 2071 |
| max-partitions | 4096 | 4096 | 0 | 1492746 | 28717 | 1873015 |
| max-cards | 4096 | 820 | 819 | 2248499 | 33630 | 3755858 |
| max-observation-refs | 4096 | 1 | 1 | 5514 | 85 | 1791058 |
| long-validated-pattern | 5 | 1 | 1 | 30049 | 341 | 31381 |


### Remaining limits

New-feature macOS/other-Node execution, exact-new-head hosted CI, user-log pilot, empirical precision/usefulness, a performance campaign and causal optimization effects are **NOT RUN** in this developer session. Prerequisite PR28's macOS/Linux receipts are preserved as prerequisite evidence only. Independent root review, authorized draft publication/remote readback and exact-head CI are separate next gates. No merge, deployment, npm publication, real-user logs, full P5 six-rule/ten-metric completion, report activation or display-model change is claimed.
