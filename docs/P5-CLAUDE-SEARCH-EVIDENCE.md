# Ordinary Claude search lookup evidence

## Authority, recovery and verification status

Reviewed implementation slice, 2026-10-02 UTC. Initial base was merged main `08d87e1a979aba53dd15d091af4fff0dd6f967b2`. The coordinator approved the reviewed contract at 11:04 UTC, and the Project development contributor claim was saved/read back at 11:08 UTC before implementation. Work uses the existing dot cloud workspace; no Work/Codex task, publication, merge, deployment or real-user-log access is authorized by this slice.

The [narrow Project draft](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=260505037) owns current status, execution checklists and exact path claims. Broad [P5](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093) is not claimed or complete. Scanner/database/schema resume and report/CLI development have separate owners.

At 11:33 UTC the execution workspace disappeared during the full aggregate gate. Resuming its process failed with an executor-key-change error. That gate has **no completion receipt** and is **not a PASS**. At 11:35 UTC the coordinator authorized reconstruction of the same scope on pinned merged main `063ee04b37e97616065254c9534f430bdc33e3c3`, tree `ce44659dfa117c2009e9541c07af6fb9a6796fd3`. All 209 base Git blobs and modes were independently revalidated before creating a separate candidate.

This document is a reconstructed contract, not a claim that the lost approved document was recovered byte-for-byte. The historical approved-document SHA-256 was `d1b98efd85cb4d3252a0d3eb4c10f0728056e2d5b82241d424958490b530135c`. The recovered contract preserves the reviewed boundaries below and requires a new freeze and independent review. The three new test files, including the original 32-test prefix, **were recovered exactly**, verified against their pre-loss hashes. Earlier successful test receipts remain historical until rerun on recovered bytes. No full, artifact, remote-CI or empirical effectiveness pass is inferred from reconstruction.

## Observable outcome and exclusions

Ordinary directly recorded native Claude `Grep` and `Glob` requests can receive an opaque non-null `lookupKey` for the exact supported query, project/root, tool, recorded provider version and options. The actual adapter snapshot and validated source-store readback preserve it. The extractor is connected to ingestion rather than being an unused helper.

This adds no repeated-search ratio, new diagnostic, Detected Waste, equal-result assertion, unchanged-content assertion, complete-result claim or measured token/time saving. Existing operation identity, content/change/validation state, lookup range, status, provenance and timing keep their meanings. Repeating a request may be necessary after an edit or external file change. Request identity establishes neither unnecessary work nor causation. Ordinary result completeness remains unknown; this slice never supplies trusted fixture context to promote it.

Only raw tool names exactly `Grep` and `Glob` qualify. Bash/PowerShell `rg`, `grep`, `find`, `bfs`, `ugrep`, shell command text, MCP/custom tools and web search are excluded. Current official documentation says native macOS/Linux/WSL default search uses Bash; directly recorded native tools remain available in documented circumstances. Synthetic coverage of the direct tools does not imply broad current-log or empirical provider-version support.

## Source evidence and limitations

- Repository inspection established that `src/parsers/claude/tools.ts` classifies exact `Grep`/`Glob` as search, while baseline ingestion passed no search fields to the existing normalizer. None of the three committed Claude JSONL fixtures contains a direct native search invocation.
- Existing [CLAUDE-EVIDENCE](CLAUDE-EVIDENCE.md) records direct `record.version` on all 960 UUID-bearing rows of its previously authorized corpus; another 219 rows were metadata-only. This is maintained aggregate evidence, not new raw-log access. Existing synthetic tool-use-bearing assistant rows also carry direct version, 2/2, 4/4 and 5/5 across the three Claude fixtures.
- The [official hook input reference](https://code.claude.com/docs/en/hooks#pretooluse-input), checked during planning on 2026-10-02, documents Glob pattern/path and Grep pattern/path/glob/output_mode/-i/multiline. The [tool reference](https://code.claude.com/docs/en/tools-reference#glob-tool-behavior) describes platform-dependent native availability, result caps and file-state/ignore effects. These sources justify only the finite shape below, not every historical transcript schema.
- The broader TypeScript SDK documentation exceeded the web reader content limit. No exhaustive option-schema inference was made. Pagination, context and type options outside the reviewed subset remain unsupported for lookup evidence.
- No local `.agents/skills` or accessible owner ObsDog runtime was available in this cloud checkout. No memory capture, real-user log scan or raw-log upload occurred.

## Finite input boundary

The new extractor accepts only a bounded plain own-data object with prototype `Object.prototype` or null. It rejects proxies before reflection, unsupported prototypes, accessors, symbols, non-enumerable schema fields and inherited-field attempts. It invokes no getters, conversion hooks, `toJSON`, regex execution, filesystem resolution, subprocess or network operation. This guarantee is scoped to the new extractor. Inherited adapter canonicalization can encounter proxy traps before extraction; this work does not claim whole-adapter proxy hardening.

Supported keys:

| Tool | Required | Optional values |
| --- | --- | --- |
| Glob | pattern: nonempty string | path: nonempty string |
| Grep | pattern: nonempty string | path/glob: nonempty string; output_mode: exactly content/files_with_matches/count; -i/multiline: boolean |

Every extra key makes lookup evidence unavailable rather than being ignored. Explicit null/undefined, wrong primitives, empty required/optional strings, NUL-containing pattern/path, malformed direct version and over-budget data also yield null. Unsupported lookup evidence does not drop an invocation representable by the inherited parser or alter its operation/status accounting. Existing raw-free `INSUFFICIENT_LOOKUP_EVIDENCE` behavior remains; diagnostics never contain input fragments.

At most six own keys are accepted for Grep and two for Glob. Strings and the total canonical input are bounded at 1 MiB UTF-8. Direct provider version uses the existing nonempty text bound of 4,096 UTF-16 code units; it is only transient. Preserve exact whitespace, Unicode normalization, case, slash spelling, relative/absolute representation and literal `.`/`..` segments. Do not open paths or execute query text.

Before normalizing candidate fields, preflight the complete JSON frame `[1,1,"lookup","search","claude",P,Q,R,O]` against the unchanged 2 MiB identity-input UTF-8 budget. Nested JSON escaping can exceed that budget even when ordinary canonical input fits. On overflow omit only the new lookup fields, never the otherwise representable invocation. Do not enlarge shared limits.

A non-null lookup requires the existing authoritative per-call project derived from direct record cwd and a valid direct record.version. Neither may be guessed from later records, a filename, process cwd or a session default. Missing version remains null, not an unqualified unknown-version key. Different known versions are distinct without claiming empirical support for them.

## Exact identity and replay contract

Use unchanged `normalizeEvent` and its existing lookup domain. Let `H(domain, ...parts)` use installation-keyed framing `[normalizationVersion,keyVersion,domain,...parts]` with unchanged normalization/key versions.

- P = H(file, "claude_project", directCwd), preserving existing per-call/source-order authority
- Q = exact pattern string
- R = JSON of ["explicit_path", path] if present, otherwise ["record_cwd"]; omitted root is qualified by P and never equated with explicit cwd or `.`
- C = canonical JSON of present supported options excluding pattern/path, sorted by key; omitted booleans/default modes remain omitted, Glob C is {}
- O = ordered string array ["claude_native_search/v1", toolName, directProviderVersion, C]
- lookupKey = H(lookup, "search", "claude", P, Q, R, O)

Different invocation IDs preserve distinct event IDs while equal components share a lookup key. Tool/version/project/root/query/options or omission changes distinguish keys; object property order does not. Semantically equivalent spelling may remain distinct to avoid false equivalence. No operationKey formula changes and no raw component is retained.

For native-search call replay, first calculate the unchanged base call-input HMAC. Then compose a new native-search policy tag with that opaque base digest, the bounded direct-version fingerprint (or explicit absent/invalid marker) and extraction eligibility (eligible/rejected). Never append raw version or re-escaped input into a near-budget raw frame. Non-search call digests remain byte-identical.

Extraction eligibility depends only on the finite raw input, direct version and fixed-width frame budget, independently of project availability. Lookup creation alone uses the selected authoritative project. Missing cwd in the authoritative representation cannot gain a key from a later-source-position replay; an earlier-source-position representation may replace that project under the inherited authority rule. Completed status and 4,000 ms paired timing remain intact. An absent-to-known version change conflicts conservatively. Rejected property shapes whose undefined/accessor/symbol/non-enumerable values disappear during inherited canonicalization cannot silently retain a previously eligible lookup key. Input/version/eligibility replay conflicts clear the key and preserve the inherited unknown-status/conflict handling. Earlier source order within one file remains authoritative; no wall-clock-minimum or later-context enrichment is introduced.

A result's cwd/version never rewrites call identity. Result or retained call-message conflict clears lookup evidence. A conflicting assistant UUID can omit the original tool block entirely: on the first transition of an existing message link to conflicted, make one bounded walk of the existing event map and refresh native-search executions whose retained callMessageId matches it. No new index/cache or retained field is added; unrelated/non-search executions are unchanged. The retained affected event becomes unknown-status with no trusted timing. Repeated identical conflict records remain idempotent.

## Parser-version and storage compatibility

Current Claude output is parserVersion **2**. Persisted capability typing and validation accept historical Claude 1 and current Claude 2 with exact source-header/provider/version agreement. Codex remains exactly 1. Unsupported future versions and mismatches reject metric-bearing snapshots, and the closed analyzer gates suppress them rather than accepting arbitrary positive versions.

Only the supported-contract predicates in `source-failures` and `source-slow-tool` change. Metrics, thresholds, provenance, suppression semantics and output schemas remain unchanged; read-revisit and overlap analyzers inherit the same gate. Summary needs no production edit. Preserve capability property insertion order so historical JSON output remains byte-identical.

The historical events-only storage API retains its generic positive-integer parser header; do not widen this promise into future-version rejection for events-only rows or change source-validation ownership. Historical v1 rows stay read-only-compatible without migration, rewriting, invented lookup keys or raw-file reads.

Existing scanner cache checks the actual current adapter version and incorporates it into file proofs/candidates. An explicit scan of an old Claude 1 source misses reuse, reparses from byte zero and atomically replaces under the original CAS revision; the next identical parser 2 scan can reuse it. This one-time cost applies even without native search because source-level versioning cannot selectively prove unchanged interpretation. Codex reuse is unchanged. No measured speed-up is claimed.

An actual v1 adapter token cannot restore in current v2. Rejection must not mutate the token, existing adapter or old stored evidence. Fresh v2 export/restore remains supported. The separate durable-resume owner distinguishes valid old semantic-version tokens (full replay) from corrupt current state (hard failure), and owns scanner/store/schema implementation. This slice does not claim durable resume or change readiness flags.

## Checkpoint safety

Checkpoint serialization stays `agentprof.claude-checkpoint/v1`; semantic parserVersion 2 binds the interpretation change. No new retained field is needed. Replace the old blanket lookup-null guard only with this narrow admission:

A keyed event must have exact `(kind=search, category=search, toolName=Grep|Glob)`, retained callKind=tool, a non-null valid callProjectId, no execution conflict, no background request, null commandPattern/fileFingerprint/lookupRange and all inherited ordinary checkpoint invariants. Other event/tool kinds require null lookup. The existing key-format/domain/keyId guards still apply.

A keyed state also requires any retained result to be unconflicted and a referenced retained call-message link, when present, to be unconflicted. Validate bounded cross-references after map construction; flipping only execution.conflicted false in a re-signed adversarial token must not bypass those linked-conflict invariants. Preserve all completeness, change/validation scope, turn/parent, error fingerprint and trusted-context restrictions.

Authentication proves safe retained state, not provider truth. Synthetic re-signed malformed fields, budgets, references or impossible tuples must reject. Preserve the inherited fabricated-Bash-lookup guard and all negative cases; change only its now-current unsupported-parser mutation from 2 to 3.

## Frozen independent tests and verification scope

All inputs are synthetic ordinary records without trustedFixtureContext. Original independent literals use separately framed Node HMAC, never the new helper or production identity implementation as the oracle. No expected literal/classification was weakened.

1. Identity: exact literal Grep A/reordered A, query B, Glob, omitted root, explicit options and known-version differences; distinct invocation IDs; project/root spelling, relative/absolute, Unicode/case/whitespace and every option/omission distinction
2. Unknown/adversarial: missing/invalid version or cwd; malformed/empty/wrong/null/undefined data; extra options; accessor/proxy/symbol/prototype/hidden attempts; key/string/canonical/frame limits; inert regex/command-like strings; null-only evidence fallback without dropping representable invocations
3. Lifecycle: success/failure/pending/missing-result/result-before-call; replay, version/input/rejected-shape conflicts; omitted-tool assistant conflict; initial context absence; earlier source-order authority; non-authoritative result metadata; no duplicate invocation accounting
4. Storage/version/cache: actual reader → adapter → private SQLite → close/reopen/readSource; historical literal Claude 1 rows with null lookup; exact historical read-only output hashes and mode/byte preservation; metric-bearing Claude 3/Codex 2/mismatch rejection; unchanged events-only API; old 1 full replay once then v2 reuse; old generation survives rejection/stale replacement
5. Checkpoints: uninterrupted versus every split, pending/deferred/replay/conflict and second cycle, exact snapshots/upsert batches/retained safe state; v2 keyed success; actual old 1 token rejection; future semantic versions; keyed native tuple and linked-conflict tampering; inherited Bash rejection
6. Neighbor/package gates: unchanged provider fixtures/keys/non-search behavior apart from current Claude capability version and source proof/generation; no CLI/metric surface; full focused/typecheck/build/aggregate/packed SDK and installed artifact checks; privacy/docs/diff checks; independent all-path review; root-owned publication and exact-head CI later

The direct-SDK/API-only frame counterexample uses pattern `x`, a path of 524,088 double-quote characters and version length 4,096. Canonical args are 1,048,201 bytes and complete lookup frame 2,100,662 bytes. Inherited canonical message/base digest remain valid, but the physical JSONL line exceeds the reader limit. This demonstrates API preservation only and does not enlarge reader coverage.

The developer's separately frozen raw two-record source is 699 UTF-8 bytes, starts 0/355, completed boundary 699, SHA-256 `73f1f8dcbc5b041093965e233ad439b1f2bc39541db8fff1079cebb561523091`. It is not the reviewer's earlier 750-byte fixture. Its actual baseline-v1 safe snapshot JSON SHA-256 is `1a58560bc16523e52942d5a60e79e8f8e381a98d11890eeb174d8a01af4b8f37`. Historical null lookup and old token were captured before production, not fabricated by relabeling candidate semantics.

## Exact change surface (20 paths after the reviewed amendment)

Production (7): `src/parsers/claude/search.ts` (new), `src/parsers/claude/index.ts`, `src/parsers/claude/types.ts`, `src/parsers/claude/checkpoint.ts`, `src/db/source-metric-validation.ts`, `src/analysis/source-failures.ts`, `src/analysis/source-slow-tool.ts`. Last two are version-admission only.

Tests (8): new `tests/claude-search-evidence.test.ts`, `tests/claude-search-checkpoint.test.ts`, `tests/claude-search-storage.test.ts`; `tests/claude-checkpoint-validation.test.ts` unsupported-version mutation only; `tests/source-metric-store.test.ts`, `tests/source-summary-integration.test.ts`, `tests/source-slow-tool-integration.test.ts` actual-adapter-version header construction only. The reviewed 20th path, `tests/source-relationship-store.test.ts`, permits that same header-only actual-version correction.

Documents (5): this file and only named EOF `Ordinary Claude search lookup evidence (2026-10-02)` sections in SPEC/FINDINGS/IMPLEMENTATION/CLAUDE-PARSER, preserving all earlier current-main bytes. Any additional path/dependency/scope change requires prior coordinator plan/Project amendment. Live status remains in the Project.

## Historical pre-loss receipts

The final approved original 32-test prefix SHA-256 is `8a10ad470ac5c1b0402724b1e51886aa312d928c54e609bfbf75679656259e19`; on unchanged production it produced 23 PASS /9 expected FAIL. Earlier 29-test and 31-test freezes, one wrong-cwd setup attempt and their RED receipts were retained before loss; they are historical, not additional candidate passes.

The developer added three helper/budget/source-order tests and new checkpoint/storage fixtures before its first production edit. The corrected 81-test freeze produced 63 PASS /18 expected FAIL. The first harness attempt had an immutable-store spy error; the corrected test-only forwarding wrapper removed that harness error without changing the count of feature failures. New helper import failures were expected before the file existed.

Candidate attempt one passed 80/81. A historical stats JSON hash caught capability field-order drift; production construction order was corrected without changing the oracle. The seven changed test files then passed 230/230; eight provider/ingestion files passed 227/227; typecheck passed. Complete retained-state comparison over all ten inherited synthetic fixtures passed, with only Claude capability 1 → 2 and no Codex change. These receipts preceded environment loss.

An aggregate was frozen on current main with 214 candidate files and exactly 19 changed paths; its manifest SHA-256 was `36f60e3b0cd31a63772fc5fa9624ffbecef3d4407064f6c548fad1ed314fa9ce`. It started with outer 600 seconds, 512 MiB heap and one worker. Typecheck/build completed and Vitest started before the workspace/process became unavailable. No aggregate test completion, packed artifact, installed SDK, independent final review or published-head CI result exists for that interrupted run.

## Recovered verification receipts

All 209 inherited pinned-main files and modes were checked against the freshly fetched Git tree. Three assets matched verified surviving local bytes; two were retrieved with the connector's supported base64 file route after the generic text-only endpoint rejected binary format. No access denial was bypassed.

The original 32-test prefix and all three final test files were recreated from visible authored/read tool payloads and checked against their pre-loss SHA-256 values:

- Evidence: `87cdd4e9c8c0eaece5bde8fbb15a525ad9c848d8d47cc087cfae9f9c61db2a4d`
- Checkpoint: `88ac3d9ffbb833453e0d799634b38f8c386cc893841eb62f5e14b497699af840`
- Storage: `bdfb5a92459502a6b79d8e4769274d071fa62f192a45922c5058cd34fa4deb5f`

The 699-byte source, baseline-v1 safe-output hash and all seven historical formatter/analyzer hashes regenerated identically from pinned baseline before reconstructed production edits. The recovered three-file baseline again produced **63 PASS /18 expected FAIL (81 total), exit 1**, one worker/512 MiB, at 11:55 UTC. That is a successful reproduction of the RED boundary, not a candidate pass.

Dependency restoration used the exact unchanged committed lock (SHA-256 `9cdd1c17d2f90f4405d5ace14d2aae7d17ceaba06ea7d1c12e77face8956dc8a`); all 84 resolved URLs are official registry.npmjs.org. Offline ci failed ENOTCACHED; the default-cache retry failed because `/home/agent/.npm` was absent. The same authorized `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund` with a writable `/tmp` cache succeeded. Installed Vitest 5.0.2, TypeScript 7.0.2, Commander 15.0.0 and @types/node 24.19.0 were verified. No package/lock change, extra package, global install or dependency script occurred.

Recovered production/focused/full/artifact checks and independent all-path review remain **NOT RUN** until later receipts below. The interrupted aggregate is never reused as a pass. Exact source/test/doc snapshots and manifests are retained explicitly in tool storage as well as filesystem evidence after each meaningful freeze.

## Recovered candidate focused verification — 2026-10-02 12:03 UTC

Reconstructed production passes typecheck and **230/230 tests across the seven changed test files**, with one worker and a 512 MiB heap. The exact three-file pre-production hashes and all independent literal/legacy assertions remain unchanged. This is fresh recovered-candidate evidence, separate from the historical pre-loss result. No source edit occurred between this check and its subsequent 12:05 UTC freeze. The reconstructed contract and four additive EOF sections require independent review; their new bytes are not presented as exact recovery of the lost documents. Full aggregate, packed SDK/artifact, final independent review and exact-head CI remain NOT RUN pending their new receipts.

## Reviewed source-order correction and 20th path — 2026-10-02 12:14 UTC

The recovered frozen aggregate exited 1: typecheck and build passed; 54 test files yielded 1,433 PASS /3 FAIL /40 SKIPPED (1,476 total) in 151.91 seconds. All 214 frozen candidate-file hashes remained unchanged. The failures were an inherited `tests/source-relationship-store.test.ts` helper pairing current Claude capabilities with a hardcoded version1 header; artifact verification did not run after the failed test stage. Skips are not promoted to passes.

Before editing that file, the coordinator approved and the Project saved/reloaded an exact 20-path amendment. Add only `tests/source-relationship-store.test.ts` to the test scope, changing its actual-adapter input header to `s.capabilities.parserVersion`; preserve every other byte, historical fixture and negative assertion. The original 7 production/7 tests/5 documents otherwise keep their scope.

Independent frozen review found a real earlier-source-order regression: when a later ordinal was first observed with missing cwd and an earlier authoritative replay supplied cwd, project-dependent extractor eligibility changed the replay digest and conflicted before the inherited earlier-authority branch. The reverse presence change also falsely conflicted. New directional regressions must preserve the original 35-test file as an exact prefix, and establish completed 4,000 ms plus REORDERED_RECORD and no INCONSISTENT_REPLAY, with stable subsequent replay. Earlier known context gets the literal key; earlier missing context stays null.

The reviewed bounded correction separates raw shape/version eligibility from key availability. Full lookup-frame preflight uses a fixed 105-ASCII-byte length-only stand-in matching the guaranteed normalized file-key width for all eligibility checks. It is never returned, hashed or retained as an identity. The real authoritative project goes only to the unchanged normalizer, which still requires a non-null project to produce any lookupKey. This avoids both context-dependent eligibility and near-budget presence-dependent framing changes, without adding retained fields, caches, hashing or a new identity policy. Unsupported raw-property shapes and version changes continue to conflict conservatively.

The current aggregate failure and review finding are retained. Both direction oracles and the corrected 20-path candidate require fresh focused/full/packed receipts and independent final review; no source change occurred mid-gate.

## Source-order correction verification — 2026-10-02 12:19 UTC

The two new direction tests were appended after the exact recovered 35-test prefix and frozen before the correction (new evidence-file SHA-256 `7c327911b686b77afde4cff9601033a336e6fff671bac8f0c6943adaa6fec12a`). Both failed against the unfixed candidate with fabricated unknown/conflicted events. A separate unchanged-parser-1 semantic oracle passed both directions: earlier authority, completed 4,000 ms, correct project-dependent operation availability, REORDERED_RECORD, no INCONSISTENT_REPLAY and stable subsequent replay. Its lookup remained null, as expected for historical parser 1.

The bounded eligibility correction and sole header replacement now pass fresh typecheck and **303/303 tests across eight changed test files**, including both directions and all old negatives/literals. An initial patch typo left one extra closing parenthesis; typecheck and all eight test-file transforms failed with no tests executed. The typo was corrected before the successful rerun; that failed attempt is retained separately. No expected assertion was weakened. The unchanged relationship test file differs by exactly its one header expression.

The first full run's 40 optional tests require explicit baseline/installed-binary environment inputs; they were skipped, not passed. The next full aggregate and script-disabled packed checks are separate pending gates.

## Final local verification — 2026-10-02 12:28 UTC

The corrected 20-path candidate was frozen before execution under manifest SHA-256 `137f21bae2540c8e369a556d6e3b3828b62fb4625a533c97fa8db9c5055a3e55`. On Node 24.19.0/Linux x64 with the pinned dependencies, the outer 600-second command `NODE_OPTIONS=--max-old-space-size=512 VITEST_MAX_WORKERS=1 npm_config_cache=/tmp/agentprof-recovery-npm-cache npm run check` exited **0**. Typecheck/build passed; all 54 test files passed with **1,438 PASS /40 explicitly SKIPPED (1,478 total)**, test duration 155.71 seconds. The optional skips still require external baseline/installed-binary test inputs and are not counted as verified cases.

The script-disabled artifact verifier passed a 52-file tarball, npm-exec and isolated global-install help/version, ordinary synthetic scan/list/select, read-only stats and positive/suppressed insights/failure output parity, selection/help guards and unchanged stored bytes. A separate script-disabled extracted packed-SDK smoke passed the independent native lookup literal, Claude 2/Codex 1 versions, current-v2 checkpoint equivalence, actual-old-v1 rejection, real reader/store/reopen and raw privacy. Its tarball SHA-256 is `b023d3491f150594ecd81f558eb27a66538c1dc880478af1db0ed416278494db`. This smoke exercises the extracted package; the inherited artifact gate separately covers the actual npm installation paths.

All 214 candidate-file hashes matched the pre-gate freeze after completion. The ten inherited synthetic fixtures again preserved complete retained state, with only Claude capability parserVersion 1 → 2 and no Codex change. All 20 changed paths passed whitespace/local-document-link checks. Independent review cleared the corrective source/test delta and exact-path/hash/prefix checks. Only current-tense documentation corrections and this executed receipt were applied after the gate; production/test/package bytes remain frozen. The final documentation-only hash/diff review is a separate parent gate.

No remote CI, publication, merge, release, deployment, provider pilot, performance benchmark or savings result is claimed. The interrupted pre-loss aggregate, initial recovered header failures, earlier-source regression RED and patch-typo failures remain separate historical receipts rather than being relabeled as passes.

## PR 36 review amendment — 2026-10-02 13:26 UTC

The review starts from source head `c8d470e38cd397f8f8c28a670aecb5e737efa48c` on main `063ee04b37e97616065254c9534f430bdc33e3c3`. Its 20-path surface and all seven production paths stay frozen. The first macOS Node 24.15.0 check with all 40 optional cases enabled failed: 23 FAIL /1,455 PASS, 1,478 total. Fourteen failures were reviewer-runner setup errors: the two requested receipt directories did not exist. Nine failures were fresh-source CLI parity assertions against authentic Claude parser-1 binaries: three Claude fixtures across three suites now expose parser 2. These are failed receipts, not candidate passes or evidence of a production defect.

The permitted amendment is five test paths: baseline-comparison sections and one helper import in `tests/cli-read-revisits.test.ts`, `tests/cli-invocation-overlap.test.ts` and `tests/source-relationship-integration.test.ts`; new `tests/claude-parser-version-parity.ts` and `tests/claude-parser-version-parity.test.ts`. Parent review documentation is confined to this append. The durable-resume draft's numeric rejected-schema matrices in the two CLI files are disjoint and remain untouched; the relationship integration's other sections also remain unchanged. No parser, store, analyzer, CLI, fixture, package or workflow change is admitted. The final PR surface becomes 25 paths and 216 tracked files if this exact amendment is used.

The version exception applies only to fresh-source historical expected output. First require historical JSON to be exactly `JSON.stringify(parsed) + "\n"`, then promote only explicitly selected Claude parser-version fields from exactly 1 to 2: scan's sole source capability, selected stats' summary capability, and selected insights/failures/read-revisits' analysis and capability versions. Validate the command, provider, schema and selected-result mode. Compare the complete candidate process result, including status and stderr, to the resulting historical expectation byte-for-byte. Never parse or normalize candidate output, recursively replace version keys, replace arbitrary numbers, omit fields, change the baseline or relax Codex parity.

Human exceptions replace each exact, command-specific existing parser-version line once, preserving every other byte and normalization/key version 1. Insights exposes two separately required lines: `Versions: parser=1; normalization=1; key=1` and the existing capability-support line ending in `capability parser version=1`; both become 2. Selected stats, failures and read-revisits each expose one required line. Catalogue and human scan remain exact. Unknown versions, extra version-bearing fields, missing or duplicated lines, different modes/providers, noncanonical historical JSON and changed candidate formatting must fail. Counts, durations, usage, diagnostics, readiness, status, stderr and unrelated text remain exact. Every non-scan baseline command additionally reads the same historical v1 store with the current CLI and requires exact process parity, with the inherited bytes/modes no-write checks preserved. Installed-candidate comparisons, help normalization, environment gates, fixture counts and all existing non-parity assertions remain unchanged.

Implementation is assigned to `/root/pr36_version_parity_fix`; coordinator session `01a0f182-0d47-7d50-acfe-c003c004822e` owns independent review and publication. The developer waits for the exact claim to be saved and read back in Project draft 260505037 before editing. Authentic baselines remain `b8ea155829e6ee095fb0eafbf4774bc264a94eaa` and `38871590fb00efba2b1efd64f1b7639572365fce`; current-main semantic comparison remains `063ee04b37e97616065254c9534f430bdc33e3c3`.

1. Freeze command-specific positive and negative controls before changing inherited assertions. Verify: exact Codex parity and every permitted Claude path/line, plus rejection of unrelated payload/process changes, unknown versions, noncanonical historical JSON and candidate formatting changes.
2. Implement the helper and modify only the three reserved baseline sections. Verify: controls pass; same historical v1 store remains byte-identical across old/current CLI reads; all inherited fixtures and other assertions are preserved.
3. Correct private runner setup and independently review the complete 25-path surface. Verify: all seven production paths and the other 210 source-head files remain byte/mode-identical; old test prefixes and opaque baseline fixtures retain independent provenance; exact allowed test delta and local documentation links pass.
4. Run macOS, installed-package and remote CI gates, then publish and close only the narrow draft after merge. Verify: three supported Node runtimes, all 40 optional cases enabled without skips, script-disabled 52-file artifact and 50-file installed runtime equality, actual logs at the final head and merged main, read-only legacy-store parity, and fresh Project readback. The original failed receipts remain retained separately.

These checks are pending at this planning checkpoint. No additional provider coverage, durable resume, repeated-search metric, benchmark or savings claim is introduced.

## Executed PR 36 review verification — 2026-10-02 13:48 UTC

The separate developer froze the helper and 66 independently authored positive/negative controls before altering inherited assertions. All 66 passed. The three modified baseline suites then passed all 32 selected cases on Node 24.15.0; 117 other discovered cases were excluded by the focused name filter, not counted as passes. Exact reverse substitutions restore each of the three inherited files byte-for-byte. The final helper/control hashes are `2afbdd54a4ffaf4d740b978986565674765dfba4342b2fb86ad8fc534fe882ae` and `10be28c736a1293bb9fdc516dfc56ee2b460ea43a8cd0464375462de84e5e13c`. Every non-scan comparison also read the same authentic v1 store with the candidate CLI and preserved exact process output and stored bytes/modes.

The reviewer independently examined all 25 final source/test/document paths, including the complete helper and controls. All seven production paths and all eight original search implementation test files remain unchanged from submitted head `c8d470e38cd397f8f8c28a670aecb5e737efa48c`. The six-path review amendment preserves the other 210 source-head paths. Against main `063ee04b37e97616065254c9534f430bdc33e3c3`, the candidate has 216 files, seven additions, eighteen modifications and 191 untouched inherited paths. The complete original 170-line evidence prefix is preserved. Local document targets and whitespace checks passed.

On macOS arm64, pinned Node **24.15.0, 24.21.0 and 26.7.0** each passed `npm run check`: typecheck/build, **55 test files /1,544 tests passed /zero skipped**, and the script-disabled **52-file artifact** gate. All 40 optional baseline/installed tests were enabled in every run. Vitest durations were 123.59, 110.40 and 128.77 seconds, respectively. One worker and a 512 MiB heap were used. All 216 pre-gate candidate file hashes and Git modes matched afterward; this receipt is a later documentation-only append. All 50 installed runtime files match the build bytes/modes. No package was published.

Independent installed-SDK probes passed on all three runtimes. The actual frozen parser-1 token was regenerated byte-for-byte from unchanged main and restored there; candidate parser 2 rejected it. The entire 9,481-byte historical snapshot was likewise regenerated exactly, including an independently framed boundary HMAC. Its frozen 699-byte source and 0/355/699 boundaries were preserved. An independently computed native-search lookup matched the literal, paired duration remained 4,000 ms, and every split of that two-record source plus a second capture/restore cycle matched full replay. Complete retained state across all ten inherited JSONL fixtures matched unchanged main, with only Claude capability parserVersion 1 → 2; Codex was unchanged.

The initially failed 23-case macOS receipt remains retained. Private offline setup initially missed dependency and install metadata, so an isolated cache was filled without changing dependency pins or running install scripts. A final reviewer closeout assertion mistakenly requested human `--version` output while expecting the machine error code; the CLI correctly exited 2 with empty stdout and its required-runtime message. Correcting the private probe to `--json` confirmed `UNSUPPORTED_RUNTIME` on Node 22.16.0. Already-completed supported gates were reused from their successful exact-file receipts; they were not rerun or relabeled. None of these reviewer setup corrections changed product code.

Submitted-head push and pull-request CI logs were independently checked: eight Foundation jobs, the pull-request synthetic merge's exact parents/tree, 54 files /1,438 passed /40 explicit optional skips on each Linux supported job, and 52-file artifact passes. Those source-head results are separate from the final-amendment publication gates. Final-head and merged-main hosted logs, merge identity and the narrow Project completion are checked and recorded in the Project after publication. Real-provider pilots, benchmarks and savings remain unverified; no broader feature or milestone completion is claimed.
