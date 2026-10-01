# AgentProf: bounded read-only selected-source stats

Planning record, 2026-10-01 13:48 UTC. Separate developer: /root/implement_agentprof_readonly_stats; coordinator: /root. At that handoff, implementation/verification were pending and PR24 was unmerged at its approved exact head. The repository-owner review below records the subsequent merged dependency and completed macOS verification. Supported concurrency is existing-product DELETE transactions; unrelated external mode changes are explicitly outside this contract.

## Recommendation and outcome

Ship `agentprof stats --list-sources` and `agentprof stats --source <full-source-id>` as one user-facing slice. Reuse PR24's source summary to answer which measured calls/patterns are expensive in one stored log prefix. Do not build a general query/reconciliation layer first. This is useful before global reconciliation because the user explicitly chooses one stored source, its revision/prefix and limitations are visible, and no cross-source addition is performed.

Return source inventory, measured same-stream/category/pattern/scope/evidence duration cohorts, and observed eligible final-response usage with the existing exclusions, suppression and null/zero behavior. Retain `scope: source_prefix`, `crossSourceReconciled: false`, `aggregationReady: false`, `parserResumeReady: false`. No global/session/history totals, intervals, shares, inferred elapsed/idle time, retry/waste rules, cost or savings. No raw inputs are opened.

## Verified dependencies and claim boundaries at planning

- GitHub main read through the connector at 13:38 UTC: `62e4a7b27fac212292a952403d464ab63d653a6e` (PR23 merged).
- PR24 exact dependency: `9cb0b19675cb8f695ceee3b6860780e5ccdab932`, tree `1220d05a34eb6045e6e2f7aa278ede6c49548754`. At the planning read it is draft/unmerged, nine successful checks, seven remote files verified. Summary Project item 259630371 visibly records all four bounded Verify entries satisfied and all source-summary reservations released. Status remains In Progress for repository-owner review/merge.
- Root explicitly permits a reviewed stacked implementation based exactly on that PR24 head if still unmerged. Do not silently substitute a later head. Recheck main and PR24 before development; after PR24 merge, reconcile/rebase and rerun relevant/full checks. Never auto-merge, merge, deploy or publish npm under this plan.
- Current P5 item 258833093 read in the dot cloud browser at 13:40 UTC: active claim is explicitly only synthetic HTML presentation/visualization; exclusions explicitly include metrics/diagnostics engine, CLI and its tests, scanner, parsers, normalizer and DB. `report/**` and `docs/REPORT-PREVIEW.md` remain reserved. Display-model changes require coordination even if placed elsewhere. Broad P5 title does not establish a conflicting CLI implementation claim.
- Current P4 item 258833059 read in the dot cloud browser at 13:43 UTC: bounded scan CLI claim explicitly says PR23 merged and all CLI editing/publication/review reservations released; final review at 13:00 UTC reiterates release and no next ticket. Older active/pending statements are historical.
- No conflicting active external CLI claim was visible in those current authoritative items. Re-read them and the board immediately before the root creates a new narrow claim; if a new owner/claim appears, pause and coordinate instead of overwriting it.

Sources:
- https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059
- https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093
- https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259630371
- https://github.com/WhiteKiwi/agentprof/pull/24
- Existing source contract: [P5-SOURCE-SUMMARY](P5-SOURCE-SUMMARY.md), with the exact dependency above.

## Exact proposed paths

New product files:
- `src/cli/stats.ts`: stats-specific validation, one operation over an existing DB, selected-source/list result types and text/JSON formatting. No generic service/repository abstraction.
- `src/db/read-only.ts`: narrow existing-private-store read-only opener, key read/binding and schema/mode verification. Keep all source payload semantics in the existing store. This file is not a new general persistence API.

Existing product files, tightly scoped:
- `src/cli/main.ts`: activate only the two explicit stats modes, truthful help, preserve all scan and remaining pending commands.
- `src/db/source-store.ts`: add bounded header-only `listSources()` to the existing store; reuse its private snapshot ownership pattern and existing validators. Do not alter write/CAS/replacement semantics.
- `src/privacy/paths.ts`: add `resolveDataDirectory` and `validateExistingPrivateDirectory` only if needed to avoid invoking the mutating directory helper or resolving unrelated provider roots. Preserve current scan behavior. Reuse the same default data-directory convention through this narrow helper rather than maintaining a divergent copy.
- `src/normalize/identity.ts`: extract/reuse the existing key-payload parsing validation only if necessary; add a read-existing-only key validation helper if this avoids duplicate format rules. No change to generation, fingerprint semantics or load-or-create behavior. The helper need return only validated key ID for stats; the secret must never be returned in a stats result.
- `src/privacy/diagnostics.ts`: narrowly add fixed safe errors for missing store/source, incompatible existing schema and unsupported DB mode, if existing codes cannot express the actual failure. No raw exception messages.

New tests:
- `tests/read-only-database.test.ts`
- `tests/source-catalogue.test.ts`
- `tests/cli-stats.test.ts`

Existing test/script edits:
- `tests/cli.test.ts`: replace stats-pending expectations with explicit selection/help/error expectations; retain insights/report/open pending behavior.
- `scripts/verify-artifact.mjs`: only add packed synthetic scan -> list -> selected stats and unchanged-store assertions; no package/lock/workflow changes.

Documents:
- New `docs/P5-READONLY-STATS.md`: reviewed implementation contract and actual verification evidence, written before implementation and updated truthfully.
- Narrow root-coordinated additions to `docs/SPEC.md`, `docs/IMPLEMENTATION.md`, `docs/FINDINGS.md`.

No changes to `src/analysis/source-summary.ts`, parsers, schemas/migration behavior, scanner collection, `report/**`, `docs/REPORT-PREVIEW.md`, design/assets/README, package/lockfiles or workflows without a separately reviewed amendment. If a proposed optional helper is not needed, omit its path from the actual reservation/manifest.

## Existing reuse points

- `src/db/source-validation.ts`: `keyId`, `identity`, `integer`, `validateHeader`, existing event count/byte constants. Validate requested source ID with the same full HMAC-domain/key contract, not a prefix, filename or scan alias. `validateHeader` receives an explicitly assembled allowed header object, not the SQL row with extra descriptor columns.
- `src/db/source-metric-validation.ts`: `METRIC_LIMITS`, `MAX_SOURCE_METRIC_BYTES` and contract-version semantics for catalogue descriptor checks. Catalogue never loads metric JSON or invents capabilities from a descriptor.
- `src/db/source-store.ts`: `readSource`, private `readGeneration` and `readPinned` transaction ownership/validation. Selected results must come from that existing bounded trusted reader, not a new ad hoc JSON decoder.
- `src/analysis/source-summary.ts`: `summarizeSource`, `SourceSummary`. Do not pass untrusted JSON or construct a partially validated StoredSource.
- `src/privacy/paths.ts`: `assertNoSymlink`, `openPrivateFile`, `fileCode`, and existing XDG/home data-directory convention. `openPrivateFile` validates regular file/0600/ownership with O_NOFOLLOW. Add explicit existing-directory validation; do not call `ensurePrivateDirectory`.
- `src/normalize/identity.ts`: key file size/format/version/hex/key-ID validation currently inside `loadOrCreateIdentityContext`; share/extract validation rather than copying a second evolving key contract. Never call the creation helper from stats.
- `src/db/database.ts`: reuse `DATABASE_SCHEMA_VERSION` as a constant if useful, but never call `openDatabase`, `migrate` or the immediate write `transaction` helper from stats. Read settings and schema migration markers in a read transaction.
- `src/privacy/diagnostics.ts`: `SafeError`, `safeErrorEnvelope`, fixed vocabulary.
- `src/cli/scan.ts`: existing path syntax validation may be reused without calling collection/bootstrap. Preserve global --json envelope conventions and validation-before-I/O behavior.

## CLI and result contract

Exactly one of `--list-sources` or `--source <id>` is required. Reject duplicate/ambiguous mode use, invalid full identity syntax, `--last`, and Codex/Claude input-root flags for stats before opening files. Support --data-dir and --json before/after command as existing CLI conventions allow. Bare stats gives fixed safe selection guidance, never picks a source or aggregates. A successful bounded result exits 0; fatal/invalid/missing-source failures exit 2. Catalogue truncation is an explicit successful bounded-list result, not a silent complete-list claim. Suppressed metrics are a successful inspected-source result, not an invented zero or fatal process error.

Reuse `agentprof.cli/v1` envelope with command stats and explicit result mode. Catalogue has its own fixed schema discriminator; selected result embeds the existing SourceSummary unchanged. Do not add collection time: storage has none. Source unavailable/available describes the stored generation only, not current filesystem existence. State explicitly that source freshness and other-source conflicts were not checked.

Text output shows source ID, revision/prefix, capabilities/suppression, inventory, cohort sample counts and metric values; labels retain units and timing scope/evidence. No invented grand-total row or merged quantile. Null is unknown/unavailable, never 0; eligible observed zero remains 0. All IDs/labels are existing validated normalized values; errors never echo arbitrary input.

## Read-only database safety gate

The product currently creates schema-3 stores in DELETE journal mode. This slice supports only that mode. Do not claim general SQLite file compatibility.

Required behavior: no database/key/directory creation, schema migration, journal/WAL/SHM/temp-file creation, recovery, chmod or permission change on success or failure. Do not use `immutable=1` for a live writable database: it bypasses the locking/change-detection properties needed here. Do not copy a live database as an unverified snapshot workaround.

Proposed sequence, subject to developer validation before activating stats:
1. Validate existing private directory and parents, DB and identity regular-file ownership/modes/symlink rules, without repairing them.
2. Read key payload with a hard 1,024-byte ceiling (bounded read with one-byte overflow detection; do not rely on a preceding stat to bound a subsequent unlimited read). Validate existing representation; retain only key ID for store access.
3. Before SQLite open, inspect a bounded DB header through the verified file descriptor, requiring a valid SQLite header and rollback-format read/write version bytes. Reject WAL-marked input. Conservatively reject existing `-wal`, `-shm` or `-journal` sidecars, including non-regular/symlink sidecars; do not remove/recover them.
4. Open with Node SQLite `readOnly:true`, extensions disabled and bounded busy timeout. Set connection-local trusted_schema=OFF, query_only=ON and temp_store=MEMORY before application queries; never set persistent journal_mode. Read and verify journal_mode=delete, schema version, migration markers, settings and DB key binding inside the pinned read snapshot. Recheck owned path/descriptor observations and cleanup; do not return partial results if verification fails.
5. One read transaction encompasses snapshot identity verification and the catalogue or selected read; commit/rollback only the transaction this operation owns. Selected `readSource` recognizes and reuses this transaction. Close database/handles in every path.

An empty schema-3 store may have no installed DB identity only when there is no source header; a populated store without valid identity rejects. Installed DB key ID must equal validated existing key ID; requested/returned identities must match it. This proves consistency with the current key-ID contract, not authentication of arbitrary same-key-ID secret replacement.

Important unverified race boundary: `readOnly:true` alone does not guarantee no WAL/SHM creation for a WAL DB. Header/sidecar checks followed by a mode query cannot prove prevention against an unrelated process racing DELETE -> WAL between checks/open. Supported concurrent writes are the existing product's DELETE-mode source transactions, not arbitrary outside mode/schema/identity changes. Document this scope honestly. The developer must verify the no-write invariant for supported cases on supported Node versions and report if stock Node SQLite cannot enforce it; do not silently weaken the gate or present post-operation absence as universal prevention. An unresolved external-mode-switch guarantee requires root review before implementation proceeds past the opener.

## Bounded consistent catalogue

Add `listSources()` to the existing store with fixed 64-header output, no caller-raised limit. Query source headers ordered by primary-key source_id binary ordering, with LIMIT 65 to observe one overflow sentinel. No count-all query, unbounded all(), payload query, session scan, cross-source reconciliation or aggregate. The index order avoids sorting unbounded payloads.

Validate each selected header/version/key/revision/availability and joined metric descriptor. Header/descriptor data are inventory metadata, not independently revalidated payload metrics; label accordingly. Expose only sourceId/provider/revision/completedOffset/observedSize/availability/persistedScope and validated stored counts if useful, not paths, arbitrary aliases, boundary fingerprints or secret material. No missing descriptor becomes an empty metric history.

Return fixed limit=64, returnedCount, truncated, selection=source_id_order, snapshot-consistent flag limited to this request, and immutable items. No catalogue total or sum across sources. A corrupt returned row or descriptor fails safely, rather than being skipped and silently changing coverage. No persistent alias, cursor, complete-history flag or catalogue cache. Beyond-first-page access remains possible through a full ID from scan JSON; document first-64 limitation plainly.

A later selected command may observe a different revision; display its actual revision. Do not claim continuity across separate CLI calls or historic revision retrieval. An expected-revision guard can be a later small contract if needed for report parity, rather than expanding this first CLI surface.

## Duplicate/conflict boundary and alternative rejected

Source IDs derive from provider + resolved path, so archive/live copies remain separate. Source revision is local CAS sequence, not cross-file authority. Same session ID or equal tail fingerprint is not whole-source equivalence. The current fingerprint covers at most the final 4,096 bytes ending at the completed LF and offset, not the whole file.

Selected stats never combines sources and never labels its source canonical. A and B may report equal/contradictory observations separately; cross-source conflicts are explicitly unchecked. PR24 within-source usage logic remains unchanged: semantically identical response payloads deduplicate, contradictory groups exclude every member before cohort partitioning. No duration summary/p95 pooling across sources.

A future bounded reconciliation plan must operate on validated rows, compare semantics by provider/key/stream/canonical identity, preserve contributing source/revision provenance, deduplicate exact retained observations and exclude entire contradictory groups before aggregation. Matching normalized rows prove matching retained observations only. Missing metadata/wrapper/message/recovery relationships prevent a generic full-history canonical claim, so latest-wins/maxima/prefix guessing are not substitutes. That larger feature is not required to ship honest explicit-source stats.

## Report handoff remains separate

Existing renderReport accepts only kind=synthetic, requires unsupported period/collection/session/union fields and falls back to detailFixture when details are omitted. Never remove its guard, fill missing values with zero or let a real-data path use that fallback. After stats, coordinate the existing report owner on a source-prefix display mode using the exact summary, with unsupported panels omitted and no synthetic fallback. CLI/HTML parity must use the same captured summary/revision, not independent reads labeled as identical. No report paths or display-model interface are changed by this slice.

## Planned Verify matrix (initially NOT RUN; actual evidence below)

1. Write maintained contract/claim with explicit PR24 dependency; recheck main/claims. Validate CLI arguments with no I/O on failures.
   Verify: modes, full IDs, roots/--last rejection, flags before/after command, help/version/remaining pending commands storage-free.
2. Implement read-only existing-store opener and catalogue as narrowly scoped above.
   Verify: valid/empty stores; absent key/DB/directory; malformed/oversized key; key-ID mismatch; old/future/corrupt schema/settings/markers; unsafe files/parents; WAL/SHM/journal cases rejected before side effects; supported DELETE writer/read contention safely succeeds or returns fixed busy/access error. No key creation, migration, recovery or chmod. Test handles/transaction cleanup. Verify DB/key bytes, revisions, permissions, directory entries and no temp/sidecar creation; distinguish transient create/delete from end-state absence with deterministic instrumentation or suitable observation.
3. Connect existing readSource -> summarizeSource -> text/JSON.
   Verify: source absent distinct from empty; unavailable/event-only/ambiguous/state-limited suppression; null versus zero; provisional Claude usage stays null; duplicate/conflicting response semantics unchanged; input-root files never read; no runtime path/secret/raw sentinel disclosure. Source replacement cannot mix header/payload generation and identity is checked within the same snapshot.
4. Verify catalogue bounds and end-to-end artifact.
   Verify: 0/1/64/65 sources, binary ordering, one sentinel, returned/header byte bounds, no unbounded payload reads, validated corruption fails; independent archive/live sources never summed/latest-selected. Synthetic two-provider scan -> close -> readonly list -> select -> stats; repeated replacement keeps metric values with actual revision change. Text/JSON exact data parity and explicit limitations. Packed CLI, npm run check, doc links/diff, independent review, exact remote manifest/head CI on supported Node versions. Keep macOS or actual user-log/full-history performance NOT RUN unless actually performed through authorized routes.

## Handoff and stopping conditions

Root creates one narrow Project draft/claim only after current no-overlap recheck and plan review; a separate developer implements it. No Work/Codex task may be launched without the user's required approval. Developer reports opener safety blockers before widening the design, preserves exact dependency and reservations, and returns frozen files plus verification evidence. Root owns review/publication and later main reconciliation. Completion means a usable bounded list/select stats path with proved supported-case no-write behavior and truthful coverage, not full P5/P6 completion.

## Implementation clarification before code (13:54 UTC)

Root approved a new read-only-only O_NONBLOCK | O_NOFOLLOW descriptor opener with immediate regular-kind, 0600/owner and descriptor/path identity checks. Pre-lstat alone does not prevent FIFO replacement. Existing scan helper semantics stay unchanged. The supported store is a trusted product-managed directory with concurrent normal DELETE-mode database transactions; arbitrary external replacement of paths/modes/schema is not a supported concurrency model. Deterministic pre-open swaps will be tested; do not claim a universal hostile filesystem-race guarantee. Catalogue SQL uses bounded field projections before JavaScript materialization, rejecting overlong fields rather than returning unbounded header values.

Project claim was rendered and read back at 13:54 UTC: https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259694583. All four Verify entries are unchecked; owner and actual task identity are present; no code tests yet.

## Initial opener gate evidence (2026-10-01 13:59 UTC)

Linux x64 Node 24.19.0: 28 focused opener tests PASS, covering empty/populated stores, no mutation, callback/write rejection, missing storage, malformed/oversize key, old/future schema, settings/markers, key binding, DELETE sidecar/WAL rejection, modes, pre-open FIFO/symlink/directory substitution and real peer DELETE writer contention with pinned generation. Typecheck PASS. Linux inotify directory observation was installed synchronously before a separate synthetic reader process, drained after its exit, and found no mutation events; a transient create/delete positive control was detected. Overflow is failure, never success. Ptrace/syscall tracing was unavailable due to kernel restrictions; no security setting changed. This is observer evidence plus SQLite readOnly semantics, not a universal arbitrary external-mode/path race guarantee. Other Node/runtime combinations, further corruption/descriptor tests and CLI/full artifact gates remain pending.

### Read-bound correction before implementation

Independent opener review identified that one FileHandle.read can return short data without EOF. Key input must loop positioned reads only until EOF or the fixed 1,025-byte buffer fills, rejecting the overflow byte. This preserves the 1,024-byte contract even for legal short reads; no unbounded readFile call is used by stats. Catalogue verification will explicitly inspect the query plan for index order without temporary B-tree, caller-owned transaction preservation, and oversized field rejection.

### Human null labeling correction before implementation

Coordinator review found that null cohorts mean either suppression or no eligible observations. Human output must consult suppressionReason, name an actual suppression reason when present, and otherwise label absent eligible measured/final-response observations with unknown totals. A healthy empty source and provisional-only Claude are not suppressed. Verify both and genuine zero values against JSON without changing SourceSummary.

### Catalogue index hardening before implementation

Root approved explicit INDEXED BY on both known product-schema primary-key autoindexes after review: sqlite_autoindex_source_event_headers_1 and sqlite_autoindex_source_metric_headers_1, verified from a synthetic schema-3 store. Missing canonical indexes fail safely rather than allowing an automatic index or temporary sort. This is not an authentication of arbitrary malicious recreated index columns/collation, and does not widen the supported product-schema contract. Tests recreate each table without its index and expect fixed failure.

## Implementation handoff verification — 2026-10-01 14:11 UTC

- PASS: Linux x64, Node 24.19.0, `npm run check` with an explicit writable npm cache: typecheck, build, 488 tests across 23 files, and 35-file artifact. The initial run's default home-cache ENOENT was an environment failure; the explicit-cache final run passed all stages.
- PASS: 32 new opener cases, 14 catalogue cases, 16 stats CLI cases. One obsolete stats-pending test was replaced. Existing PR24 summary, parser, scanner, store and privacy suites remain unchanged and pass.
- PASS: bounded 17-byte short reads detect the 1,025th key byte; deterministic just-before-open FIFO/symlink/directory swaps reject without blocking; callback/write failures close the owned transaction/connection. Real DELETE peer writes cannot mix selected generations. Missing/private-mode/key/version/settings/marker/sidecar failures never repair or bootstrap storage.
- PASS: 0/1/64/65 catalogue bounds and byte projections; binary primary-key order; no payload queries or count-all; EXPLAIN uses indexes without temporary B-tree; missing event/metric canonical indexes reject; caller transactions remain owned by the caller on success and corruption. Catalogue descriptors are explicitly metadata-only.
- PASS: two synthetic providers scan, close, have input roots removed, then list/select through actual installed/built CLI. Source summary values equal direct validated readSource → summarizeSource. Codex observed final usage total is 92 for this fixture; provisional Claude usage remains null. Archive/live copies each remain independent, never summed or selected as latest; repeated scans preserve metrics with actual revision 1→2.
- PASS: human/JSON agree on healthy empty sources, provisional-only usage, suppressed sources, genuine duration/token zero, revision/prefix and eligibility fields. The coordinator-found null-cohort presentation bug is corrected without changing the summary dependency.
- PASS: installed packed tarball synthetic scan/list/select and unchanged DB/key bytes, modes and directory entries; script-disabled npm-exec/global-install help/version. No npm publication occurred.
- PASS: Linux inotify installed before each separate reader subprocess, drained after exit with overflow treated as failure: empty, populated, old schema, oversized key, WAL, journal-sidecar and callback-failure scenarios produce zero mutation events. Each scenario first proves a transient CREATE/DELETE positive control. DB/key bytes/modes/entries remain unchanged. This observes transient directory/file mutations, not merely end-state sidecar absence. Ptrace remained unavailable; no kernel/security settings changed.
- PASS: 80 local linked paths in changed documents and diff whitespace. No `report/**`, REPORT-PREVIEW, source-summary, parser, scanner, schema, package, lockfile or workflow edits.
- Dependency rechecked 14:08 UTC: PR24 remains draft/open/unmerged at exact head `9cb0b19675cb8f695ceee3b6860780e5ccdab932`. Publication is stacked on `feat/source-local-summary` unless it merges first; coordinator must recheck and reconcile the base before publication. The seven dependency files are not new changes in this slice.
- Pending: final frozen-manifest independent review, remote content and exact-head supported-runtime CI; macOS and actual user-log/full-history resource checks NOT RUN. Product runtime policy remains unchanged. No general external mode/path/schema race guarantee, complete-history freshness/reconciliation, report parity, merge or deployment is claimed.

### Final metadata projection correction before implementation

Root final read found that a recreated non-STRICT settings table could return oversized TEXT/BLOB in value before validation. Schema marker version, settings value and installed singleton metadata will all use integer-only CASE projections before JavaScript materialization, matching catalogue protections. Add recreated settings fixtures for large text/blob and verify SQL projection, fixed rejection and unchanged bytes. This narrow corruption hardening does not assert universal malicious-schema compatibility.

Final metadata correction full check attempt at 14:14 UTC was interrupted: Vitest read-only worker received SIGKILL, with 22 files/473 tests completed and artifact not reached. This is not a final pass. Oversized corruption fixtures are reduced to 64 KiB (still far above scalar contract) to keep test memory bounded, then all gates are rerun.

Final metadata correction gate at 2026-10-01 14:16 UTC: Linux Node24.19 full check PASS 490 tests / 23 files / 35-file artifact. Both oversized settings fixtures reject with integer-only SQL projection and unchanged bytes. The earlier SIGKILL attempt is superseded by the successful full rerun; it is not attributed to a proven root cause. Opener suite is now 34 tests. Seven inotify scenarios rerun against the final product build PASS.

## Repository-owner macOS verification correction plan (2026-10-01)

PR #24 is now merged at main
`b96bda476042b41a3b60507376b781c677e6997d`. PR #25 was retargeted to main;
local integration head `456b3d24b8d98c4e8d24be187353ef2b0be076cd` preserves
all 16 original slice files and the unchanged source-summary implementation.
Only PR #24's reviewed verification document is added by that integration.

The first macOS arm64 Node 24.15.0 full check passed typecheck/build, but
34 opener tests failed before their test bodies: the new fixture uses the
logical `/var/...` temporary path, which existing private-path validation
correctly rejects as a symbolic-link parent. The other 22 files/456 tests
passed; artifact verification was not reached. This is not a complete pass.

Before changing tests, the correction plan is to canonicalize only the newly
created synthetic fixture directory, using the existing test-helper convention
or an explicit realpath. Preserve intentional symlink/FIFO/directory swap
fixtures, strict production path validation, all safety assertions and cleanup.
No production helper, schema or summary change is authorized by this correction.

Verify the original 34 failures against the corrected focused opener suite,
then rerun full checks on macOS Node 24.15.0/24.21.0/26.7.0, the Node 22 guard,
documentation and exact final-head Linux CI. Preserve the failed-run receipt.
Existing Linux inotify evidence remains scoped to its recorded environment;
no macOS transient-mutation observer or syscall trace is claimed by snapshots.

Focused correction gate at 2026-10-01 14:58 UTC: macOS arm64 Node 24.15.0,
`node node_modules/vitest/vitest.mjs run tests/read-only-database.test.ts`, with
the pinned runtime and an isolated writable npm cache, PASS: 34 tests / 1 file,
exit 0. Only the newly created synthetic fixture directory is resolved with
`realpath`; all existing safety assertions, intentional FIFO/symlink/directory
swaps and cleanup remain unchanged. No newly exposed failure was observed.
At the focused-check handoff, full integration checks were pending; that
focused pass does not replace the preserved failed full-check receipt or claim
a macOS transient-mutation trace. Completed integration results follow.


## Repository-owner review and integrated verification (2026-10-01)

- Reviewed all 16 files beyond merged main, with no omitted files: eight
  product/script files selected with OCR delegate rules and eight document/test
  files inspected manually. The only new actionable finding was the macOS
  synthetic fixture path failure described above; it is corrected. All product
  code is unchanged from original PR25 head
  `7a5570bf88446b1e3580b6d8039458d960f57df9`.
- PR24 is merged at main `b96bda476042b41a3b60507376b781c677e6997d`.
  Integration commit `456b3d24b8d98c4e8d24be187353ef2b0be076cd` preserves
  the exact summary implementation and all original slice files. PR25 now
  targets main; no summary dependency file is counted as a new slice change.
- Independent correction commit
  `c699a4545365abc7798e706a2bec1beb7bdacc55` changes only the newly created
  test fixture's realpath/import and this correction evidence. The other 14
  original slice files, every production path rule, intentional swap fixture,
  safety assertion and cleanup are unchanged. No test is skipped.
- PASS at that correction commit: macOS arm64 Node 24.15.0, 24.21.0 and 26.7.0,
  each running full `npm run check`: typecheck/build, 490 tests across 23 files,
  and 35-file artifact verification. The 34 opener tests now pass as part of
  each complete suite. Packed synthetic scan/list/select, npm-exec/global
  installation and unchanged stored DB/key snapshots are included.
- PASS: Node 22.16.0 exits 2 with fixed `UNSUPPORTED_RUNTIME` and no stdout.
  Documentation check: 34 documents, 234 local links and 23 anchors; no broken
  references. Diff whitespace passes. The final evidence follow-up edits only
  this document; all other 15 verified file hashes are retained and document
  links are checked again before publication.
- Existing Linux inotify evidence above remains scoped to the original
  unchanged product implementation and its recorded Linux environment. Mac
  checks do not claim a transient-mutation observer or syscall trace. Actual
  user logs/full-history resource checks remain unperformed; only synthetic
  fixtures are used.
- Exact final-head/base Linux CI, remote 16-file byte verification and merge
  receipts are final publication gates recorded on
  [PR25](https://github.com/WhiteKiwi/agentprof/pull/25) and its
  [Project ticket](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259694583).
  Full P5/P6, global/history aggregation, insights, report/open and report
  presentation remain outside this completed implementation slice.
