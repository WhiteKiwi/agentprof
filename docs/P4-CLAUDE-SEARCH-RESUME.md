# Claude native search and durable resume integration

## Observable contract

A genuine schema-6/parser-v1 generation emitted by PR #40 remains authenticated when the ordinary Claude interpreter becomes parser v2. An explicit scan of unchanged raw bytes replays exactly once under the original revision and predecessor, atomically storing parser-v2 native-search evidence and a parser-v2 checkpoint. Reopening unchanged bytes performs no ingestion or revision increment. Two later appended search records each ingest only their suffix and preserve independently framed identities, safe lookup evidence and paired four-second intervals. Public aggregationReady and parserResumeReady remain false. Codex retains its existing full-replay behavior.

Corrupt old generation seals fail before compatibility fallback. A real concurrent writer winning the original revision cannot be overwritten. No old token is relabeled, re-signed or interpreted as current state.

Schema compatibility is separate from parser compatibility. Current read-only commands reject schema 5 without writes. Test qualification may explicitly write-open a separate copy to migrate it to schema 6 while retaining parser-v1 rows and absent optional checkpoints; current read-only output from that copy must then match the original historical binary exactly and leave copied bytes and modes unchanged. The original historical store remains untouched. Production read-only commands never migrate.

## Inputs and composition

- Existing durable head: 646f58e0f81acb39d503000e604bee0140d138af, tree 55a4d7be76d03b3e077e538d98adbf0f6bb554dc
- Merged native-search main: ffd87e1dc1bcbc21d925d7466ae19b944c1a8735, tree 8549d3dd18de9292917fe5928ba2bd9cd12b3b14
- Common base: 063ee04b37e97616065254c9534f430bdc33e3c3
- All 216 fresh-main files and all published durable changed-file hashes were independently verified before preparation
- Portable oracle freeze: SHA256 537f411c3c01f584d2590bf9402e48aad277e905080ec05a63c7cb78a6077a56; all 13 listed entries verified

Production composition preserves each branch's exact production bytes. Three shared documents retain the entire fresh-main prefix followed by the exact durable EOF suffix. Four shared test files retain both the merged native-search changes and durable-schema/writer changes. The native-search parity helper and its strict version-location checks remain unchanged. A later feature-branch merge commit may have the old durable head and pinned fresh main as parents; publication is separately coordinated and does not authorize merging the feature into main.

## Portable genuine-v1 evidence

The integration test and two platform JSON fixtures are adopted byte-for-byte from the independently reviewed portable freeze. Linux fixture SHA256 is 79b514678401595e667bea26729d7e9ac0575d0abd46cbfb4050910a21dc3f36; Darwin fixture SHA256 is 5a9281172ff9cf7d554ca15eb132c6f6c2539dee76a1964657996a177c00bfa3. Fixtures contain exact PR40-emitted SQL strings for a synthetic two-record, 661-byte native Grep interaction. The test verifies fixture/raw hashes, exact tables/columns, generation authentication, independently framed IDs and literal lookup identity.

The fixed synthetic source directory is acquired exclusively and is removed only by its owner. Concurrent copies of this one test file must serialize or fail visibly. No historical executable, network, vendored parser, new dependency or actual user data is required by this portable test. Linux and Darwin have distinct physical temporary-path identities. Darwin fixture generation does not establish macOS runtime filesystem qualification.

The inherited search-storage observer changes only from replaceSourceSnapshot to replaceSourceSnapshotWithCheckpoint and expectedRevision argument 1 to argument 3. Existing output/no-write/CAS assertions remain intact.

## Historical schema-read amendment

The three inherited historical CLI parity groups retain the unmodified old store and baseline outputs. Before testing historical current-reader compatibility they assert safe schema-5 rejection with unchanged bytes/modes. An explicitly named test helper then migrates a separately copied store via openDatabase. The copy must preserve all original public rows, parser version 1 and source revision, contain schema marker 6 and no optional checkpoint rows, and support exact historical output without further writes. No helper silently migrates as part of a read.

A dedicated independent oracle is frozen before implementing the helper. It requires an explicitly provided, provenance-verified parser-v1/schema-5 binary; without that binary the case is NOT RUN. The retained common-base build can qualify schema migration and old-command output, but cannot substitute for the two older pre-feature help binaries. Their historical-help assertions remain unchanged.

## Implementation order and verification

1. Save and reload the exact Project amendment, then materialize an isolated composition from verified inputs. Verify all production paths are exact branch inputs, shared EOF history and both test deltas are preserved, and no unrelated paths change.
2. Adopt the frozen portable test/fixtures and bounded storage observer. Add the reviewed historical-copy oracle before its fixture helper and three caller amendments. Verify genuine upgrade once, two suffix cycles, corruption/no-write, original-CAS races, schema-5 rejection, explicit copy migration and historical exact output; distinguish harness failures from production defects.
3. Freeze for independent review before resource-controlled tests. Verify focused and inherited cases first, then typecheck/build/full/artifact and authentic-baseline/installed supplements only in the coordinator's resource slot. Record actual terminal outcomes and skips separately.
4. Publish only the independently reviewed candidate and observe actual checkout/tree CI to terminal. Verify pinned parents and tree, fresh Project readback and remaining runtime/integration limitations. No release, feature-to-main merge, empirical coverage or savings claim is implied.

## Evidence at amendment preparation

The earlier isolated portable composition passed 56 focused cases; forced legitimate full replay failed the expected one-suffix-ingestion oracle with three ingestions. Independent read-only source review found no production defect. Those receipts concern the earlier composition, not this fresh-main union. No fresh integrated test, full suite, artifact or hosted check has run at preparation. macOS execution remains NOT RUN.

## Authentic baseline seed expectation correction — 2026-10-02

The first fresh-main focused run passed the 56 portable/search/storage/resume cases and failed the newly authored historical-schema oracle before migration. Its authentic unchanged 063ee04b baseline committed one parser-v1 source at revision 1, with exit status 1 and partial coverage solely because the synthetic Read lacks direct provider-version lookup evidence. Failed, rejected and stale counts were zero; the sole warning was INSUFFICIENT_LOOKUP_EVIDENCE. The baseline output was independently captured and reviewed before correction.

The oracle now requires that exact partial status, committed revision, parser version, zero failure counts and diagnostic instead of incorrectly expecting complete status 0. Its raw fixture, schema5 rejection, source rows, explicit copied migration, optional-checkpoint absence and exact historical-output/no-write expectations remain unchanged. This corrects a baseline harness assumption and does not change production behavior or relax accepted statuses. The initial 56-pass/1-fail receipt is retained; subsequent results are recorded separately.

The next focused attempt passed seed and schema5 rejection assertions, then exposed a test-helper comparison error before copying: Node SQLite rows have null prototypes, unlike the plain object literals passed to node:assert.deepStrictEqual. Four scalar-only schema-version assertions now compare user_version scalars and exact migration-version arrays. Exact marker values/cardinality and complete historical SQLite-row equality remain required. This second failed receipt is retained separately; no production behavior changed.

A third focused attempt reached copy verification and correctly rejected cpSync's default 0755 destination-root mode against the original private 0700 mode. The helper now exclusively creates its absent copied root with the original permission bits before copying. Full directory/file bytes and modes comparisons remain unchanged. An independent built-in-fs synthetic control confirmed 0700/0600 preservation with the same copy options. The failed attempt is retained. Qualification stays pinned to ffd87e1d; later main changes require separate integration.

## Pinned integrated focused receipts — 2026-10-02

On Linux x64 Node24.19.0, with pinned Vitest5.0.2/TypeScript7.0.2, one worker, a 512 MiB heap and 600-second outer bounds, the prerequisite build passed. The unchanged portable native-search resume/storage and ordinary resume suites passed 56 cases. After the three separately recorded fixture corrections, the authentic schema5-copy oracle passed its single case in 8.57 seconds using the retained 063ee04b parser-v1/schema-5 build. All 209 baseline source files/modes were independently rechecked. There is no combined 57-case rerun claim.

The successful independent oracle establishes exact seed partial/diagnostic evidence, rejection of schema5 without mutation, exclusive private copy creation, explicit schema6 migration preserving all historical rows and parser1 with no checkpoint rows, and exact baseline/current historical read parity with original and copied bytes/modes unchanged. The fixed portable test and two genuine-v1 fixtures remain byte-identical to the reviewed freeze. No production repair was needed. Fresh integrated full-suite, installed supplements, artifact, hosted CI, macOS and later-main integration remain NOT RUN.

## Integrated toolchain and complete local qualification — 2026-10-02T15:31Z

The final integration base is merged main106d6c1329499fdb57e63c7aad3f8aac78987249/treeb6ff2d34aa5f734edd8550f7413e487618c87c43. All218 baseline files were independently verified. Composition preserves the complete main toolchain changes and all84 dependency versions/integrities, including pnpm10.33.0, the unchanged scripts and lockfile, and all previous search/compatibility work. The three shared documents retain the full new-main prefix followed by the exact reviewed durable/integration EOF suffixes. Every production and test byte matches the reviewed focused candidate after the three documented fixture corrections. The tested230-file composition tree is f5e54b08a8eefdec5cb34a3fe2b4206198fe9689; its manifest SHA256 is0afa22f0c3919613594e4d073c667fd931ecc63931dc9f8880ea8765e0a83752. Later final-documentation additions contain receipts only.

The existing pnpm11.19.0 was unsuitable for the pinned script contract. A separately authorized workspace-local pnpm10.33.0 was obtained from the official npm registry with lifecycle scripts disabled; its tarball SHA512 matched registry metadata and an independent hash. No global tool installation or repository dependency/script rewrite occurred. Verification reused the previously pinned read-only project dependencies. This is not a fresh pnpm frozen-lockfile installation claim. Runtime was Linux x64 Node24.19.0, within the supported engine range; TypeScript7.0.2 and Vitest5.0.2. All stages used a600-second outer bound; Vitest used its supported VITEST_MAX_WORKERS=1 setting and a512MiB runner/worker heap. Inherited installed-report CLI children replace NODE_OPTIONS for warning control, so that heap limit is not asserted for every child. No timeout/OOM occurred.

Actual terminal results:

- Unchanged pnpm check PASS: typecheck, build, all60 test files with1,625 PASS and40 explicitly optional skips (1,665 collected;196.34s test duration), followed by unchanged artifact verification. The authentic063ee04b schema5 oracle was enabled and passed in this full run, along with genuine-v1/v2 durable search continuation and all five actual SIGKILL placements.
- Unchanged artifact verifier PASS with53 allowlisted files; script-disabled tarball npm-exec/global installation, installed stats/insights/failures parity and unchanged synthetic stores; published:false.
- Retained script-disabled pack and isolated-prefix installation PASS; commander15.0.0, tarball SHA1cc2e23f0e37026009f38c46f15aee9282a74d924. Existing installed and authentic063ee04b historical parity supplements passed38 selected cases across4 files in225.23s. The115 name-filtered cases comprise113 already covered default cases and the2 older historical-help comparisons; those2 remain NOT RUN against their required pre-feature binaries. No all40-optional-pass or single combined all-tests run is claimed.
- A separately built, verified218-file actual106d6c baseline matched candidate and retained installed CLI output exactly on all10 inherited synthetic provider fixtures. There were147 three-way status/stdout/stderr comparisons over441 bounded subprocess calls: initial and unchanged scans, existing list/stats/insights/failures/read-revisits commands and all7 help/version variants. Stored bytes/modes remained unchanged after reuse for all three binaries; help created no storage. This same-version fresh-main check does not replace the two historical-help qualifications.

All230 source/test/document hashes remained unchanged through execution. Source tests and fixtures are unchanged for the final receipt-only documentation handoff. Current-candidate hosted CI and macOS execution remain NOT RUN at this local handoff, as do real-log, empirical coverage, performance/savings and independent Codex durable-resume qualification. The standalone earlier-head hosted receipt remains historical. Root coordinates the non-forced feature-branch composition publication with old PR40 head and the verified main base as parents; no feature-to-main merge, deployment, npm release or broad P4 completion is implied.

Independent parent integration review (2026-10-03) follows [the current parent plan](P4-CLAUDE-RESUME.md#independent-parent-review-plan-2026-10-03). Verify genuine persisted schema6/parser1 upgrade, one replay under current parser2, unchanged reopen/two native-search suffixes, fail-closed corruption/original-CAS and portable Linux/macOS fixture identities while composing current mainb0198c4. Preserve strict parser-version-only expected-output adaptation and explicit schema5-read-only/separate-copy migration controls. Parent owns review/integration/qualification/publication; separate research owns FINDINGS and any code correction requires a separately claimed developer. Earlier source/Linux/installed receipts are historical; current parent macOS/all-controls/hosted/main gates remain NOT RUN at this draft.


## Independent parent current-main and installed qualification (2026-10-03)

Parent candidate `a26d9b6982519803f2488a8882449862bebcc8dd` preserved every feature code/test byte and complete search/durable/main histories. Actual macOS Node24.21.0/pnpm10.34.6 qualification passed 64 files / 1,870 tests / 0 skipped, all 42 authentic historical/current-installed optional cases, schema5 explicit separate-copy migration, genuine v1-to2/two suffixes, original-CAS/corruption and five actual crash placements. Both previously unrun historical-help cases passed with their required old binaries. All 54 installed runtime bytes/modes matched; an actual installed-only Darwin-v1 diagnostic passed verbatim old-row loading, two-record upgrade, zero-record unchanged reopen, two one-record suffixes, literal lookup/4000ms timing, canonical installed CLI reads and corrupt-seal no-parse/no-repair. The [complete parent receipts and limits](P4-CLAUDE-RESUME.md#independent-parent-composed-head-qualification-2026-10-03) retain earlier failures/skips and pending hosted/merge/main gates. Public readiness, real coverage and savings remain separate.
