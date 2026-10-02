# Completed native search recurrence — contract and evidence, 2026-10-02

Current status: the original PR36-based candidate passed local qualification; a fresh-main rebase now awaits qualification. Publication and merge remain parent-owned and are not claimed. The pre-production plan below is preserved as historical review lineage; the final qualification section supersedes its pending statements.

Status: PROPOSED, production NOT STARTED. This package does not claim an executed pass. The root must select the dependency/stack and approve a scoped Project child before production work. Planning owner `/root/plan_prof_search_recurrence`; development must be a separate contributor. Work remains inside the existing dot cloud task; no Work/Codex task is launched.

## Baseline and dependency

Contract baseline is PR36 head `c8d470e38cd397f8f8c28a670aecb5e737efa48c`, tree `1b6a57e90a04b3b6104b6f25566a7f8753a054ca`, incorporating ordinary Claude parserVersion 2 exact opaque lookup identity. The local `agentprof-claude-search-evidence` tree and 214-path `agentprof-search-recovery-evidence/final-manifest.json` are the inherited evidence. Main `063ee04b37e97616065254c9534f430bdc33e3c3` alone is not sufficient: it lacks this evidence. Root must either select a reviewed PR36-based stack or wait for its merge and recreate the base. Never silently add parser changes to this slice. Reverify the selected source tree against publication/manifest before tests.

## Observable contract

`stats --source ID --search-recurrence` is opt-in, read-only, and mutually exclusive with `--list-sources`, `--failures`, `--read-revisits`, `--invocation-overlap` and any other selected-source metric added in the chosen dependency stack. Duplicate occurrences reject. Validation precedes data-directory access. Existing commands retain exact bytes except explicitly reviewed stats-help additions.

Analyze exactly one validated, transaction-pinned `readSource` generation. Scope is a stored source byte prefix with session-local partitions. Include source/revision/parser/key/normalization metadata, prefix/observed size, persisted scope, availability, window `[0,completedOffset)`, queryPeriod=null, freshness=false, cross-source=false, aggregationReady=false, parserResumeReady=false. Do not scan, open original raw files, migrate, reparse, refresh or write.

Call unchanged `analyzeSourceFailures` once. Its suppression and ordinary native terminal provenance decisions are authoritative. In particular, one unresolved other native terminal event can suppress the entire session. This metric cannot weaken the gate by examining only search observations. Metric provider contract requires Claude parserVersion 2 and matching capabilities; historical Claude parserVersion 1 is readable but `unsupported_metric_contract`, not malformed storage and not an inferred all-zero result. Unsupported providers remain explicit. Source-level inherited suppression takes precedence over provider/metric support, followed by partition provenance, then no eligible searches, then missing lookup identity.

Candidate is exactly `kind=search`, `category=search`, `toolName=Grep|Glob`, `status=completed`, provider Claude, and event ID admitted by the inherited completed-event set. Shell/Bash/rg, MCP, custom tools, similarly named tools and inconsistent tuples do not count. Failed, cancelled, pending and unknown searches are inventory only. Untimed completed searches may count. N counts unique admitted normalized event IDs, never observations/replays. ReadSource already validates ID uniqueness; replay tests must verify distinct source representations collapse without collapsing separate invocation IDs.

Within a nonempty fully keyed partition: N=unique admitted search event IDs, U=distinct opaque lookup keys, repeatN=N-U, repeatRatio=(N-U)/N. A,A,B,A => 4,2,2,0.5. Any admitted null lookup makes all four evaluated metric fields null for the whole session; preserve candidateN and missingLookupN separately. No eligible searches also means null metrics, not zero. A nonempty all-distinct partition has repeatN=0 and ratio=0. No cross-session/source aggregate or compatible-subset fallback.

Key equality means only exact supported recorded request identity under the adapter's versioned contract. Preserve query/tool/provider-version/project/root/options/omission distinctions already inside opaque keys. Do not decode, regenerate or normalize keys in analysis, infer why a key is null, infer equal results/content, or diagnose wasted/avoidable work, saved time/tokens, Context Churn, retries or navigation quality. Necessary recurrence example: check again after edits or external changes. Suggested investigation stays bounded and retains quality/regression/security checks.

## Public result proposal

Schema `agentprof.source-search-recurrence/v1`, metric `completed_native_search_recurrence`, mode `selected_source_search_recurrence`. Partition exposes snapshot-local alias, sessionId, status/reason, rawSearchStatuses, candidateSearchN, missingLookupN, candidateEventIds, missingLookupEventIds, validSearchN, uniqueLookupN, repeatN, repeatRatio, cohorts|null. Cohorts expose only snapshot-local `search-1` aliases, invocationN, repeatN, eventIds, evidenceObservationIds. Never output lookupKey, operationKey, raw query/root/options/provider strings, key-derived alias hashes, or arbitrary sourceRef payloads. Evidence IDs and session/source/event IDs are existing safe typed identities. Alias assignment: sort partitions by session ID; sort cohort member event IDs and assign cohort aliases by minimum member event ID (not lookup-key ordering). Aliases are local to this snapshot, not stable search names.

Deep-owned immutable result, no source mutation. Candidate/proof inventories use explicit units. Preserve raw search statuses and inconsistent-class/non-search counts, completed admission buckets, inherited provenance reasons separately. No zero fabrication from unavailable/suppressed metrics. Classification sums must reconcile to event inventory.

## Bounds

Reuse existing 4096 events/turns/usage and 8192 observations/diagnostics input limits. One inherited gate, one observation index, no per-event full observation rescans. New analyzer must throw a safe bounded error on over-limit direct input. Human formatter: at most six sessions, ten cohorts each, explicit omitted counts, <=160 lines and <=32 KiB. JSON preserves complete bounded result with <=8 MiB at maximum admitted input. Reject an output design that cannot meet both complete JSON and declared cap; do not silently truncate references. Unique proof sets prevent replay-observation duplication. Arrays/reference counts require worst-case measurement.

## Reservations and sequence

Proposed 14-path reservation: new `docs/P5-SOURCE-SEARCH-RECURRENCE.md`; unique appended sections in `docs/SPEC.md`, `docs/IMPLEMENTATION.md`, `docs/METRICS.md`, `docs/ACCEPTANCE.md`; new `src/analysis/source-search-recurrence.ts`, `src/cli/search-recurrence.ts`; `src/cli/stats.ts`; stats-only hunk of `src/cli/main.ts`; new `tests/source-search-recurrence.test.ts`, `tests/source-search-recurrence-integration.test.ts`, `tests/source-search-recurrence-render.test.ts`, `tests/cli-search-recurrence.test.ts`, `tests/source-search-recurrence-oracle.test.ts`. If exact help assertions in inherited files require changes, root must amend reservation first; never weaken them wholesale. Root integrates append-only shared docs with unique headers. Safe-open owns the `open` command hunk in main.ts; neither worker edits shared main.ts until root resolves integration order. No parser, normalizer, storage/schema, scanner, package, report or insights changes.

1. Root freezes selected base, scoped Project child claim and documentation append patch; separate reviewer approves contract. Verify: exact dependency head/tree, no claimed overlap, selected stats metric options enumerated, no production changed.
2. Freeze ordinary raw fixtures, independently framed HMAC expectations, byte offsets and count oracle, then run gate against unchanged selected base. Verify: A,A,B,A and replay/variant/missing metadata controls using real adapter, ingestion, close/reopen; no trustedFixtureContext; inherited ordinary proofs; raw-deleted read path; baseline store unchanged. If adapter gate fails, stop and resolve upstream before analyzer implementation.
3. Separate developer writes new analyzer/tests. Verify: exact null/zero math, provenance contagion, legacy unsupported, all statuses/classes, separate sessions, input immutability, deterministic aliases/privacy, bounds, one inherited gate. Independent review before CLI integration.
4. Add formatter, stats and approved main hunk. Verify: invalid arguments before I/O; one pinned read; no raw reopening; human/JSON bounds and truthful omissions; all old-command bytes/statuses unchanged except frozen help delta; snapshot metadata exact.
5. Root schedules one-worker 512 MiB focused/full/typecheck/build/artifact runs and independent frozen-path review. Verify: final source hashes, installed/script-disabled parity, optional skip/NOT RUN distinctions, inherited old-version output hashes, no DB/key/dir bytes or modes mutated. Publish only on root authority; exact remote head and CI must be verified. Project stays In Progress until merged; no broad P5 completion.

## Test matrix frozen before production

- Raw ordinary A,A,B,A: 4 unique event IDs, 2 independently keyed requests, repeat2/ratio0.5; untimed calls count.
- Replay of identical complete raw sequence preserves N4; separate fifth invocation with same request gives N5/U2/repeat3/0.6.
- Query, Grep vs Glob, explicit-vs-omitted path, spelling, project, direct version, omitted-vs-false option and changed option all stay distinct; option member reordering stays equal.
- Missing cwd/version and unsupported finite-input shape keep completed invocation but null key; known+null in same session => unknown whole metric, not keyed subset. Do not derive specific null cause in result.
- Failed/pending/cancelled/unknown native searches and shell/MCP/custom/inconsistent names do not enter N. Unknown status never becomes completed by lookup presence.
- Ordinary call and matching decisive result are required; missing/contradictory provenance and unrelated unresolved native terminal event suppress partition; sidechain/ambiguous/state-limited/source-unavailable/evidence-absent/wrapper relationships inherit suppression unchanged.
- Zero eligible => null; one keyed=>1/1/0/0; two independent sessions stay separate; historical parser1=>unsupported metric with readable storage; Codex=>unsupported.
- Adapter/store/reopen results equal adapter snapshot; independently verify expected event/lookup/observation IDs and byte offsets, raw deletion followed by runStats must succeed without parser/file access.
- Return object recursively frozen and detached from input; shuffled source arrays yield same JSON; aliases local and ordered by member IDs; no raw sentinels or lookup/operation-key strings anywhere in human/JSON.
- Direct option validation, duplicate flags, no selection, list conflict, metric conflicts, invalid identities/roots all safe and before I/O; old commands exact parity, top-level/stats help only reviewed deltas.
- Closed/read-only DB byte hashes and modes, identity-key bytes, directory inventory and revision unchanged, including error paths. Maximum input measures JSON/human bytes and omissions; no optimistic cap assumption.
- Built direct CLI, npm-packed script-disabled install and optional/native storage parity; artifact verification at final frozen code.

## Open decisions for root

Choose dependency stack/merge order and coordinate command-breakdown if its stats flag is present. Confirm the public field names before tests import the new analyzer. Scoped Project child creation/claim is pending root serialization: supplied parent P5 item 258833093 is broad/unowned; do not take ownership of all P5 or reuse released PR13 claim. Project write not performed. Local ObsDog skill at the owner-specific macOS path is unavailable here; no fabricated memory evidence.

## Root dependency decision recorded before tests

Root chose planning against exact PR36 `c8d470e38cd397f8f8c28a670aecb5e737efa48c`, with a possible explicitly authorized stacked branch/PR base `feat/claude-search-evidence` after independent freeze review. No merge authorization. External draft PR37 toolchain changes at `d5e09cbf` are excluded; no adoption or package/toolchain edits.

## Full downstream freeze v3

The seven upstream gate tests were independently confirmed 7/7 by `/root/review_prof_recurrence_oracle` against exact v2 archive bytes. This is evidence availability, not feature implementation acceptance. V3 adds executable future-feature tests for analyzer, formatter, real runStats integration and actual CLI/old-command/installed parity. These tests are frozen before production and are expected to fail missing-feature imports/options until implementation; they are NOT RUN in this planning package.

The test DTO fixes `searchClassification`, `completedSearchAdmission` (including unsupportedMetricContract), `identity_unresolved`, `no_eligible_searches`, and historical `unsupported_metric_contract`. Human ordinary output includes `N=4; U=2; repeats=2; ratio=0.5 (2/4)`, session/cohort omission counts and one each of Necessary-recurrence counterexample / Investigative action / Optional matched experiment / Quality guardrail. Ordinary output <=35 lines/4096 bytes; maximum <=160 lines/32768 bytes. Cohort field is `invocationN`, not `searchN`.

Freeze exact added commander option description `show completed Claude native search recurrence`; help line `  --search-recurrence   show completed Claude native search recurrence` and one appended trailer `--search-recurrence requires --source and excludes --failures/--read-revisits/--invocation-overlap; Claude parser2 Grep/Glob only; exact request recurrence, not equal results or waste.` All baseline help bytes remain otherwise unchanged. Other old-command parity covers scan, list, summary, insights, failures, read-revisits, invocation-overlap in human/JSON plus existing help/version. The optional environment-variable baseline/installed suites are required final qualification gates: skipped tests are NOT PASS and must be rerun with exact PR36 binary and script-disabled installed candidate.

Reservation amendment proposed before development: add `tests/search-recurrence-fixture.ts` for shared ordinary raw fixture construction. Total 15 paths. This does not modify upstream source or v2 archive. Root must approve and register this path along with actual developer before source work. No generic helper or existing tests are changed.


## Development activation (2026-10-02)

The immutable plan above is retained as review history. V4 archive SHA-256 `2895492885cea9e09855ecd56c91a2f2d22ebae4b11df6e74b5fec082e068274` passed independent review after the precise CLI table-argument correction. Upstream oracle was independently 7/7; intended-argv CLI baseline controls were 14 passed, 6 expected missing-feature failures, 12 skipped. No feature pass is inferred. The [scoped Project child](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=260627912) saved/reloaded actual separate development contributor and 17-path reservation before root implementation GO. Two additional inherited CLI files receive only exact search-recurrence help-delta guards, preserving existing assertions. Root owns publication; no merge authorization. Final execution evidence is pending.


## Local implementation evidence — focused stage (2026-10-02)

- Runtime: Node 24.19.0, Linux, existing pinned dependencies without installation. Test commands use one worker, no file parallelism/cache, a 512 MiB Node heap and a 600-second command deadline.
- Before production analyzer edits, unchanged PR36 ordinary adapter/store/reopen oracle passed 7/7. Initial analyzer run found a pluralized export-name typo; production was corrected without touching frozen tests. Analyzer plus oracle then passed 39/39, zero skips, and source typecheck passed. Independent analyzer review cleared exact SHA-256 `6566651d1e39debeed6b36efa4d32e8266faa7a524da409466fc6919d6bee27b`.
- Root allowed disjoint CLI integration while independent analyzer review ran; analyzer bytes stayed frozen. Formatter and real read-only runStats integration passed 12/12, including deleted raw input and unchanged private-store bytes/modes. Typecheck and direct build passed.
- Ordinary human rendering measured 25 lines/3,402 bytes. Maximum exercised human rendering measured 108 lines/11,402 bytes. The 4,096-session complete JSON envelope measured 3,913,748 bytes; each maximum fixture retains complete bounded references and stays below the 8 MiB cap. These are synthetic bounds, not a performance benchmark.
- Actual CLI/current PR36 parity passed 31 tests, with one installed-artifact test skipped, against a separately built baseline whose 214 source files match the verified dependency manifest. Full aggregate, packed-installed/artifact and final all-path review remain pending. Historical optional parity is NOT RUN without each suite's true historical baseline; its omission is not a pass.
- All six new fixture/test files preserve immutable v4 bytes. The two inherited optional CLI help guards add only the four reviewed exact remove-once assertions. Parser, normalizer, storage, scanner, report and dependency/toolchain files remain unchanged.


## Final local qualification (2026-10-02)

The exact 17-path candidate passed independent all-path review before aggregate verification. Production analyzer/formatter/CLI and all frozen tests remained unchanged throughout the following gates; only this evidence and linked documentation were updated afterward. The 206 other inherited files remain byte-identical to exact PR36.

| Gate | Actual result |
| --- | --- |
| Source typecheck and direct build | PASS |
| Full one-worker suite | 59 files passed; 1,509 tests passed, 52 optional tests skipped |
| Unchanged artifact verifier | PASS; 54 artifact files; script-disabled npm exec and isolated global install; inherited stats, insights and failure parity/no-write checks |
| Current PR36 parity before retained install | 31 passed; one installed-only test skipped |
| Retained script-disabled artifact plus current PR36 parity, first run | 31 passed; one unchanged codex-legacy parity case timed out at 16.326 seconds against its 15-second test limit; no assertion mismatch |
| Same frozen combined suite in coordinator-serialized quiet slot | 32/32 passed, zero skips; original timeout and source unchanged; 65.43 seconds |

The first timeout remains a failed run, not a pass. Its successor ran after the other heavy worker finished; observed one-minute load was 1.29 and available memory 4,106 MiB. This is execution context, not a benchmark or a proven causal diagnosis. The retained installed recurrence test independently passed in both runs. The successful retry covers the mandatory current-PR36 old-command parity and installed human/JSON recurrence output with deleted raw input and unchanged database/key/directory bytes and modes.

Packed artifact SHA-256: `6b16c4acbab32b7401bc31ca826b6d1d5e7233e4a9777c0ecaffec0c772dacde`. Local package installation had scripts disabled and used isolated temporary cache/prefix paths; no package/toolchain dependency update was made. Runtime remains Node 24.19.0/Linux.

The full-suite optional historical-baseline and unrelated installed gates are not retroactively counted as passed. This slice separately completed its 12 previously skipped optional-environment tests through the exact 32-test configured suite. Historical baseline binaries for the inherited older read-revisit/invocation-overlap suites were not supplied, so those historical gates remain NOT RUN. No real-user log/pilot, paid benchmark, remote CI, merge, deployment or package publication is claimed. Project remains In Progress pending actual PR merge.


## Fresh-main integration amendment (2026-10-02)

The publication guard found that PR36 had been externally amended and merged. The former stack is superseded: the candidate now applies only this feature's 17-path delta to verified main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735`, tree `8549d3dd18de9292917fe5928ba2bd9cd12b3b14`. All 216 fresh-main blobs were verified before integration; the previously qualified candidate remains unchanged as evidence. Publication must use this exact main parent rather than the old PR36 branch.

Fresh main differs from original PR36 in six test/document paths only. It adds the 66-control parser-version parity helper/test, amends historical comparisons in three existing suites, and appends the Claude evidence document. All external changes are retained. Our two help-only patches apply at an offset of five lines, with zero fuzz and no conflicts; removing exactly the four feature help additions reconstructs the external versions byte-for-byte. The new parity helper/test, relationship integration test and external Claude evidence document are unchanged from fresh main. All four feature production files and six frozen new fixture/test files are byte-identical to the original reviewed candidate.

Independent rebase review and fresh-main typecheck/build/full/artifact/installed-current-main parity are pending. Prior qualification receipts above apply to the old candidate; they are not a pass for this rebased tree. The immutable recurrence test still labels its baseline PR36; its optional baseline binary will now be the exact merged fresh-main build, whose production bytes equal the original PR36 production. Historical optional suites still need their proper historical inputs. No behavior redesign, source/test weakening, dependency/toolchain update or publication is included.


## Fresh-main qualification completed (2026-10-02)

Latest status: the rebased candidate on exact main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735` passed independent rebase review and fresh qualification. This section supersedes the amendment's pending state above. All 225 reviewed source-tree hashes remained unchanged through execution; the following three-document evidence append is the only post-review delta.

- Source typecheck and direct build: PASS.
- Full suite: 60 files passed; 1,575 tests passed, 52 optional tests skipped. All 66 externally added parser-version parity controls are retained and passed.
- Unchanged artifact verifier: PASS; 54 artifact files, script-disabled npm exec/global install, and inherited read-only stats/insights/failure checks.
- A separately materialized and hash-verified copy of exact main ffd87 supplied the actual baseline binary. Freshly packed, script-disabled retained installed artifact plus current-main parity passed 32/32 with zero skips in 58.63 seconds, with the original 15-second per-test limit. No new-base retry or timeout was needed.
- Packed SHA-256: `6b16c4acbab32b7401bc31ca826b6d1d5e7233e4a9777c0ecaffec0c772dacde`. Runtime Node 24.19.0/Linux; one worker, 512 MiB heap, 600-second stage limit; pinned dependencies unchanged.

Fresh main's six external test/document amendments are preserved: the two shared CLI tests differ from main only by the four exact reviewed help assertions, and the other four external files are byte-identical. Feature production and the six frozen v4 fixture/test files remain identical to the original reviewed implementation. The 208 unaffected inherited files are unchanged.

The 52 optional full-suite skips are disclosed; the recurrence/current-main installed slice separately completed its 12 optional-environment cases. The older historical-baseline suites remain NOT RUN without authentic historical binaries. Previous-base failures and successful retries stay in the historical evidence above; they are not erased or conflated with this fresh-main pass. Root owns final documentation review, fresh ref guard, publication and exact-head remote CI. No merge, deployment, release or broad P5 completion is claimed.


## Bounded main toolchain integration (2026-10-02)

PR37 was externally merged to main `106d6c1329499fdb57e63c7aad3f8aac78987249`, tree `b6ff2d34aa5f734edd8550f7413e487618c87c43`. This bounded integration preserves that main's complete ten-path mise/pnpm/workflow/document change, including the removal of package-lock.json, without rewriting its workflow or introducing another dependency update. The intended non-force feature merge has parents existing PR41 head `d76245010a1dbbef64a4c0306c6700ad1e8e6649` and main `106d6c1329499fdb57e63c7aad3f8aac78987249`; it does not merge the feature into main.

All 218 incoming main blobs/modes were verified. The npm and pnpm lockfiles independently match all 84 package-name/version/integrity pairs. All 129 production/test/bin/build/artifact-verifier paths in the incoming baseline match prior main byte-for-byte. Feature production and tests remain byte-identical to published PR41, and each shared document retains the entire incoming main prefix followed by the exact feature-owned suffix and this evidence. No raw-data or behavior change is included.

Prior exact-head CI remains historical evidence: PR41 d7624501 passed hosted Node24.15/24.21/26.7 and unsupported-runtime checks; each supported job recorded 60 files/1,575 passes/52 optional skips and 54-file artifact PASS on an actual checkout with the exact published tree. The previously recorded local current-main/installed recurrence32/32 pass remains unchanged.

Root deliberately did not repeat identical full local suites solely for toolchain-only drift. Local mise/pnpm installation and execution for this integration are NOT RUN. The new exact-head hosted pnpm full/typecheck/build/artifact matrix is a required pending qualification gate after parent publication. Existing skips, historical failures and non-causal metric limits remain visible. No merge into main, release, deployment, toolchain tweak or broad P5 completion is authorized.


## Bounded pnpm 10.34.6 main integration (2026-10-02)

PR43 externally advanced main to `6f7a538d1806a1973a647fb16ab6c1fecc74bd49`, tree `b2bbfacf46e56aed51edaf3acee457a5d4beaec7`. This supersedes the previous integration parent while retaining its history. Integrate the exact eight incoming toolchain/document paths into PR41 with a non-force feature merge whose parents are existing head `3da2b09a21388d4ec9c86b049c61267ab684bb5b` and new main `6f7a538d1806a1973a647fb16ab6c1fecc74bd49`. Do not merge the feature into main.

All 218 main blobs and modes are verified. The pnpm lockfile is byte-identical to the previously qualified main, retaining all 84 package version/integrity pairs. No src, tests, bin, build or artifact-verifier script changes are incoming. All feature production/tests remain byte-identical to published PR41; complete incoming shared-document prefixes precede the preserved feature-owned suffixes. The packageManager/mise pins now select pnpm 10.34.6; no workflow tweaks beyond exact incoming main are added.

The prior PR41 head 3da2b09a passed the hosted pnpm 10.33.0 matrix: all four jobs, 60 test files /1,575 passed /52 optional skipped on each supported runtime, and 54-file artifact verification. Those results remain historical and do not qualify the pnpm 10.34.6 integration. Duplicate local full suites and local installation are deliberately NOT RUN for this toolchain-only delta. A new exact-head hosted pnpm 10.34.6 full/typecheck/build/artifact matrix is required and PENDING after parent publication. Existing optional-skip and historical-baseline limitations remain unchanged. No source behavior change, release, deployment, main merge or broad P5 completion is claimed.


## Parent current-main local qualification (2026-10-03)

The parent integrated reviewed main `e1998ccff9f5c86eb52632cfda1ed1e31d2d585a` in non-force candidate `eaf0451601070d823bfddaee453ebc3cf6a2914f`, tree `187c91e328b879451b0c74535b8d36345ace2a2b`, retaining the published source as an ancestor. All230 unowned main blobs/modes are preserved. All four feature production files and six new fixture/test files remain exact published bytes. The two inherited CLI suites retain complete current-main amendments plus exactly four frozen recurrence help-removal lines. The entire main prefixes, source suffixes and new planning/research appendices are preserved in shared documents. Independent original17/17 and parent composition review found no actionable source/test defect; no production implementation correction was required.

Actual macOS arm64 Node24.21.0 / pnpm10.34.6 qualification:

| Gate | Actual result |
| --- | --- |
| Frozen installation | PASS; --frozen-lockfile --ignore-scripts |
| Enabled npm prepack and retained script-disabled isolated consumer | PASS; runtime56 files identical in bytes/modes before/after verification, tool-free help/version/npm exec passed |
| Unchanged pnpm check chain | PASS; typecheck, build,69 test files;1,921 passed /32 optional shared-baseline cases skipped;58-file artifact PASS |
| Genuine b8ea155 legacy read-revisit group |11 selected PASS;47 other tests name-filtered, not executed in this focused invocation |
| Genuine b8ea155 legacy relationship group |10 selected PASS;24 other tests name-filtered |
| Genuine e199 pre-recurrence current-command group |11 selected PASS;21 other tests name-filtered |
| Actual installed Node22.16.0 guard |PASS; exit2, empty stdout, UNSUPPORTED_RUNTIME |

The32 full-check shared-baseline skips were all subsequently executed in the three separately configured groups, giving1,953 unique successful test cases across qualification. This is not one zero-skip full-suite invocation. The full check supplied authentic invocation3887159/schema5063ee04 inputs and all current installed supplements. Before execution, all815 tracked files across the four genuine baseline/source trees and183 runtime module bytes/modes were reverified; the e199 baseline is the tree-equal retained PR40 installed runtime. No fake baseline wrapper, timeout adjustment, test weakening or relabeled old-schema database was used. Prior author RED, optional skips and timeout/quiet-slot receipts remain historical.

Only this qualification receipt and its implementation pointer are appended after the immutable local gates. Exact-head hosted qualification, actual merge/main CI and Project closeout remain parent-owned pending gates at this commit; published-head test-merge trees and actual job logs must be verified. No real-user pilot, savings/performance benchmark, npm release, user-store migration or broad P5/P6 completion is claimed.
