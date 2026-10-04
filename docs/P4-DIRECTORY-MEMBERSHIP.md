# AgentProf directory membership: independent reviewed plan

Pre-code design and source research independently reviewed on 2026-10-04 UTC against main `4f33d2d86c68c941ccb4c5b8f720c7c95de2786e`.

## Decision

**GO for a bounded, authenticated directory-enrollment API that calls the real scanner. NO-GO for directory retirement in this slice.** The bounded strategy was approved before implementation; issue5 tracks the exact scope and verification.

The useful integration is a new internal scanner coordinator accepting exactly one explicit provider directory and invoking existing `scanSources`. It persists an authenticated observation of membership across restart. Membership capture does not retire sources; the existing scanner retains its normal source commits, including restoration. CLI behavior, source identity, parser semantics, history selection, analyzers and reports remain unchanged.

This follows the repository's existing staged P4 API implementation pattern. The module is included by the current all-source build. Tests must invoke the real scanner and durable database, not manufacture successful scan receipts. A bare schema/store with only mocked callers is not the recommended slice.

## Source-backed findings

- [Issue 5](https://github.com/WhiteKiwi/agentprof/issues/5) was open/status:todo and explicitly unowned in its latest body, updated 2026-10-04T00:52:25Z. Its remaining gates include directory deletion/move consistency, restart/races and original broad P4 verification. The five comments are archived history, not active claims.
- [Explicit-file lifecycle](https://github.com/WhiteKiwi/agentprof/blob/4f33d2d86c68c941ccb4c5b8f720c7c95de2786e/docs/P4-EXPLICIT-SOURCE-LIFECYCLE.md) deliberately rejects directory roots: stored HMAC source identities cannot recover historical directory membership. It retains unavailable payloads and uses authenticated original-generation CAS.
- `src/scanner/discovery.ts` emits bounded sources and sanitized diagnostics. It has no persisted root membership or complete-tree proof, and diagnostics do not retain reliable root attribution. Existing `ScanResult.status === partial` conflates parser coverage with discovery failures, so it cannot alone authorize a directory lifecycle decision.
- `src/scanner/scan-run.ts` bounds a run to 16 roots, 64 sources, 256 directories and 4,096 traversal/yielded entries. Source commits are intentionally independent, not an all-run transaction.
- `src/db/source-store.ts` authenticates checkpoint/generation via private `readIngestionPinned`. Public `readSourceForIngestion` rejects a caller-owned transaction. `readSource` can join a transaction but does not authenticate checkpoint bytes. Do not weaken that boundary to support this slice.
- Database schema is 6. `src/db/read-only.ts` hardcodes six migration markers and LIMIT 7. A schema-7 addition must update exact current-version verification and existing synthetic downgrade fixtures, while preserving genuine historical-schema negative tests and no-migration read-only behavior.
- `IdentityContext.fingerprint` already permits explicit versioned parts under fixed HMAC domains. A new identity domain or normalization/key version is unnecessary.

## Product contract and rollout limits

1. Internal API only; explicit caller opts into enrollment. One provider and one existing ordinary directory per call, no default home roots. No new CLI flag and no overloading `--reconcile` with an enrollment-only meaning.
2. Only an independently complete, bounded pre/post census can advance membership. A partial, inaccessible, aborted or changed census does not replace membership. Missing or replaced roots never imply absence of their former members.
3. The initial root's physical identity is bound to its durable record. Later root substitution, including an empty replacement directory, refuses capture and preserves the old record. No automatic reset/adoption operation is added.
4. Retain previously enrolled IDs when a later successful census does not observe them. Mark membership observation `not_observed`, never source availability `unavailable`. Keep each member's last successfully observed source revision. This prevents the enrollment-only rollout from silently forgetting removals needed by a later lifecycle consumer.
5. At most 4,096 cumulative remembered members per root, with a separately enforced 1 MiB canonical manifest byte limit. This allows 64 full turnovers at the inherited 64-source per-run bound. A strict tuple is at most approximately 145 bytes, so the complete 4,096-member manifest stays comfortably below 1 MiB and the existing 2 MiB HMAC input ceiling without new hash-projection machinery. Union or byte overflow refuses the entire membership update without truncation, eviction or implicit retirement. Earlier normal source commits may remain. Optional lower internal test limits must not increase these hard ceilings. A future explicit lifecycle/pruning contract may enlarge or manage this bound.
6. A root containing more than the inherited 64 selected sources cannot produce a complete eligible census in this slice. Report an explicit limit/ineligible result and preserve old membership; never treat a scanned prefix as an authoritative directory snapshot. The cumulative 4,096-member bound does not expand per-run discovery.
7. Different root records are independent observations, not exclusive source ownership. One-root input does not prove that previously enrolled roots cannot overlap. Do not add a UNIQUE(source_id) constraint across roots or claim overlap resolution. Any future retirement consumer needs an explicit persisted overlap/ownership contract.
8. Successful enrollment establishes observed directory membership and captured revision references. It does not authenticate all current source payloads, guarantee future freshness, detect moves, reconcile native copies, or complete P4. Source generation authentication belongs to the existing scanner and future lifecycle consumer.

## Proposed paths and boundaries

New production paths (names may be adjusted before claim):

- `src/db/directory-membership.ts`: strict raw-free model/codec, authenticated reads and original-revision CAS capture
- `src/scanner/directory-census.ts`: complete bounded census with transient local paths and stable directory identities
- `src/scanner/directory-enrollment.ts`: one-root orchestration over actual `scanSources` and membership store

Existing production changes:

- `src/db/database.ts`: atomic schema 6 to 7 migration, tables and bounded marker inspection
- `src/db/read-only.ts`: current schema markers and identity/orphan checks for the added tables

Tests:

- New `tests/directory-membership.test.ts`, `tests/directory-enrollment.test.ts` (split census tests if useful)
- Precisely scoped current-schema expectations and synthetic downgrade cleanup in inherited tests; inventory all affected files before claim

Maintained contract:

- New `docs/P4-DIRECTORY-MEMBERSHIP.md`
- Append scoped specification, findings, implementation and planned acceptance references to the maintained documents before production implementation, coordinating shared-file ownership first

Do not edit `src/cli/main.ts`, analyzer modules, source-store checkpoint authentication, ordinary discovery/scan semantics, dependencies, CI, original fixtures or unrelated documents. Preserve external issue 50 and PR150.

## Schema and authentication invariants

Two STRICT tables are sufficient:

- Root header: root ID, provider, contract version 1, normalization/key version 1, key ID, stable root-identity fingerprint, membership revision, bounded member count, full manifest HMAC seal
- Member rows: root ID, source ID, last observed positive source revision, observation state `observed` or `not_observed`; primary key `(root_id, source_id)`

Use the existing identity singleton and foreign keys. Empty-directory enrollment must establish the same key binding without inserting an invented source. Read-only identity validation must reject orphan membership as well as orphan source rows if the key binding is absent.

Suggested identities, with exact encoding frozen in the maintained contract:

- root ID: HMAC `source` or `lookup` domain with a fixed `directory_root_v1` tag, provider and resolved explicit path
- physical-root fingerprint: HMAC `content` domain with a fixed tag and validated dev/inode/mode/uid tuple
- seal: HMAC `content` domain with a distinct `directory_membership_v1` tag, all header semantics and the full sorted member tuples

No raw or reversible root path, filename, relative path, file contents, diagnostics text, timestamps or parser payload enters these tables. Do not persist raw filesystem identifiers if a keyed root fingerprint is sufficient. Bind provider, root ID, key/version, physical-root fingerprint, revision, counts and every row state/revision into the seal. Canonical order is exact lexicographic source ID; validate uniqueness rather than silently deduplicating caller input.

Use descriptor-only strict input validation before side effects: reject extra fields, accessors, proxies, sparse arrays, wrong prototypes, malformed/wrong-domain/wrong-key IDs, duplicate IDs, unsupported provider/contracts, unsafe integers and bounds. Hostile database reads must bound SQL string lengths, row counts and bytes before materializing attacker-controlled values. Tampering is an error, never an absent/empty record or an opportunity to reseal automatically.

## Orchestration and concurrency

1. Strictly validate one ordinary directory root and scanner options, including capture modes, before filesystem work. Resolve paths only in transient memory. The API can accept an already-open database/context; it must construct/use source and membership stores on the same database.
2. Read and authenticate the prior root record, retaining its original revision (or null). A root-identity mismatch refuses enrollment. The caller does not refresh the CAS expectation after a conflict.
3. Run a dedicated complete census. Traverse only ordinary directories/files with no symlink ancestor/leaf. Count every entry, including ignored extensions, against 4,096; bound directories to 256 and selected `.jsonl` sources to 64. A selected compressed log, symlink, nonregular entry, read/close failure or limit makes census ineligible rather than silently complete. Ordinary unrelated non-JSONL files may be ignored after type/entry validation. Record directory path-to-identity observations transiently and verify directories around enumeration. Keep a stable root handle/identity through the coordinated checks when supported.
4. Invoke actual `scanSources` for this single root with the selected capture options. It retains its existing source-by-source commits. Do not substitute mocked receipt metadata or rewrite source-store transaction semantics.
5. Repeat a complete census and recheck the same root/tree identities. Require exact equality of pre/post selected source IDs and traversed directory identities. Require one committed/unchanged scan receipt for every selected ID, correct provider and a positive resulting revision, with no unexpected source, source rejection/stale/failure, abort, storage stop or discovery limit. Partial parser coverage alone does not disqualify membership: preserve the ordinary scan result/diagnostics as partial, while treating census completeness separately. Membership is not complete content coverage.
6. In one synchronous BEGIN IMMEDIATE transaction, freshly authenticate the original membership generation and compare its original expected revision. Recheck each currently observed member's source header exists with the same provider, key, available state and committed/reused source revision. Any changed/missing member source returns stale or fails closed and writes no membership. These header checks guard enrollment association only; they must not be described as full source/checkpoint authentication.
7. Union authenticated prior members with current observed receipts, marking omitted old members `not_observed` while retaining their last observed source revision. Enforce the cumulative 4,096-member and 1 MiB bounds before writing. Replace header+member rows+seal atomically. Check cancellation before commit. An unchanged semantic snapshot can return unchanged without advancing its revision or rewriting bytes; no wall-clock freshness claim follows.
8. Return the original scan result plus an explicit membership result (committed/unchanged/stale/aborted/ineligible and fixed safe reason/counts). Do not reinterpret membership failure as source rollback. Raw paths, filenames and arbitrary exception text must not appear in the result.

No asynchronous callback or await inside the transaction. Reject nested transactions without committing/rolling back the caller's transaction. Two concurrent writers with the same observed membership revision must not both replace it; one stale result preserves the winner. A source writer advancing any current observed source before capture must also cause a guarded non-write. A successful membership commit must not mutate any source row, availability, cache or checkpoint.

Filesystem and SQLite are distinct resources. Trusted stable ancestors are still required; pre/post census and directory checks cannot guarantee safety under arbitrary hostile concurrent rename/replacement, inode reuse, or changes after the final check. Declare these limits rather than promising an atomic filesystem snapshot.

## Acceptance and verification plan

1. **Schema/store:** new/reopened store; empty-root key binding; real schema6 migration preserving all original source/settings/checkpoint bytes semantically; idempotent migration; authentic older read-only refusal; future schema refusal; conflicting DDL rollback; orphan identity rejection; marker overflow/corruption. Synthetic historical downgrades drop only the added schema7 tables before lowering version; genuine legacy fixtures remain unmodified.
2. **Round trip/privacy:** actual Codex and Claude ingestion followed by enrollment, close/reopen and authenticated equality; absence of synthetic root/filename/content sentinels in DB and public receipts; no raw filesystem tuple leakage; exact 4,096-cap/cap+1 union behavior, repeated small-scan growth across runs and bounded bytes; wrong key/domain/provider/contract, accessors/proxies/sparse arrays, malicious extras and 4,097th cumulative member fail without partial mutation.
3. **Tamper:** header revision/provider/root fingerprint/count/seal edits; source ID/revision/state edits; row injection/deletion; moved root seal; malformed/oversized SQL fields and duplicate/cross-key members. Every case refuses before resealing and preserves corrupted evidence for diagnosis. A missing/tampered member set never reads as a clean empty root.
4. **Real scanner integration:** both providers, nonempty and empty directories, nested ordinary subdirectories, parser-partial-but-successful capture, unchanged rescan, append/revision refresh, add/remove/reappear, and usageTiming/patternEvidence forwarding. Removed members remain durable `not_observed`; source contributions/availability/cache/checkpoints remain unchanged by enrollment. Added files after removals cannot evict old members when the cumulative cap is hit.
5. **Census failures:** missing/unreadable/replaced root, symlink root/ancestor/descendant, missing/replaced subdirectory, selected compression, nonregular entry, changed pre/post source set, changed directory identity, file/dir/entry limits (including a realistic pre-existing root with over 64 ordinary sessions, which must never commit a partial membership), enumeration/close error, cancelled census and cancelled scan. Prior membership is byte-preserved; earlier legitimate source commits can remain.
6. **Race/restart:** deterministic stale original-root CAS and intervening source-revision commit; two independent database connections, and an actual two-process/barrier test if supported; no nested transaction damage. Failure/cancellation during member replacement rolls back header/rows/seal together. Actual process termination before commit leaves the old complete manifest; termination after commit reopens the new complete manifest. If only transaction fault injection is run, explicitly do not claim process-crash verification.
7. **Regression/qualification:** focused new and affected inherited suites; strict typecheck/build; full supported-runtime suite; scripts-disabled installed artifact including shipped new modules and unchanged existing CLI scan/reconcile behavior. Preserve all failures and inherited skips. One parent-scheduled heavy command at a time; no overlap with other qualification jobs. Independent exact frozen-diff review precedes authorized Draft publication and exact-head CI.

## Remaining gates

This slice leaves CLI directory enrollment, retirement/unavailable writes, missing/offline-root handling, cross-root overlap policy, explicit pruning/reset, move/native-copy reconciliation, large directory support, latest-history selection, real user/macOS/performance/security-race acceptance and full P4 completion open. Do not close issue5 because this prerequisite ships.


## Independent review correction plan — 2026-10-04 01:41 UTC

Before correction, independent review found two bounded issues: final root handle
close errors could escape as native exceptions; and the receipt's availability
flag described the entire enrollment call too broadly. Normalize close failures
before membership capture and add a raw-sentinel/no-write regression. Rename the
receipt guarantee to `membershipCaptureChangesSourceAvailability:false`; preserve
normal scanner commits, including restoration of unavailable sources, and test
that actual transition. Neither correction adds retirement or changes scanning.

The first full regression exposed inherited future-schema7 rejection sentinels
and synthetic historical downgrade setups. Update only the five schema rejection
tables to retain old cases, add historical6 and advance the future sentinel to8.
Drop new membership tables only when fabricating old schemas in read-only and
relationship integration tests. These hunks are disjoint from PR151's existing
insights-help comparator changes; no external branch or help behavior changes.
The owning issue records exact paths/readback before edits.

HMAC authentication detects altered header/member contents while the signed
root anchor exists; it does not detect deletion or rollback of an entire valid
signed record/database without an external monotonic inventory anchor. Membership
is observational and never authorizes retirement. A separate-process stale-winner
test is sequential CAS coverage, not overlapping lock-contention evidence.


## Latest-main composition before final qualification

PR150 merged as `9a6427cf93d0a5c1840d25bd214821112c0c0fad`. Its exact nine
source/test/doc blobs are composed unchanged before the final run. They are
disjoint from membership production and inherited-schema corrections. Original
4f33 qualification/failures remain tied to that earlier base. This composition
does not take over exploration PR151 or infer its review/merge state.


### Installed qualification obligation

The new unconditional `directory-enrollment-installed` regression packs with
scripts disabled, installs into an isolated prefix/cache, compares every shipped
compiled byte and existing CLI help/version, then invokes actual installed
enrollment for both providers with pattern evidence. Unchanged built/installed
receipts and private database bytes must agree. This complements the unchanged
artifact verifier; it is not an npm release or a real-user pilot.

## Executed local qualification — 2026-10-04 UTC

Qualified source/test composition: main `9a6427cf93d0a5c1840d25bd214821112c0c0fad`,
tree `7f0a776c01d46d9de20983d790f8060a1c5674be`, plus the reviewed directory
membership delta. The 30-path scope is five production, twenty test and five
document paths. Independent all-path review verified all frozen hashes and all
425 unaffected main blobs. Final evidence below is appended after the unchanged
source/test freeze; no parser, source-store authentication, CLI, dependency or CI
implementation changes are included.

Environment: Linux x64, Node24.19.0, TypeScript7.0.2, Vitest5.0.2, Commander15.0.0.
Local commands use the existing exact-version dependencies, direct package-script
equivalents, one Vitest worker, 512MiB Node heap and a 900-second full-suite bound.
The repository's pinned pnpm10.34.6 and hosted runtime matrix remain unchanged;
no local pinned-pnpm clean-install qualification is claimed.

- Strict `tsc -p tsconfig.json --noEmit` and `node scripts/build.mjs`: PASS
- Complete composed suite: **4,473 PASS /0 FAIL /138 inherited conditional SKIP**,
  150 files (148 PASS/2 SKIP), 402.43 seconds. This includes **50 new tests, no new
  skips**, including the unconditional actual installed-enrollment test. New tests
  and the selected correction runs are included in the full count, not extra passes
- New tests cover 4,096 cumulative members/4,097 refusal, 64 current sources/65
  refusal, traversal boundaries, real both-provider scan/capture modes and partial
  coverage, retained not-observed members, restoration, close-error sanitization,
  source/root CAS, malformed shapes and tamper, unchanged reads and private bytes
- Actual child processes verify a sequential stale winner and SIGKILL before and
  after commit: reopen yields the old or new complete authenticated manifest,
  respectively. This is Linux process-crash recovery evidence, not simultaneous
  overlapping-writer lock contention or filesystem crash durability
- The full run's optional legacy control used a retained older schema5 artifact.
  A provenance check found three Codex-checkpoint source paths differed from the
  workflow's intended seed. The exact `5614a3107b53022f29ea32d44ba83f533fd58b92`
  seed was then materialized and all **54 source/build files** were Git-blob
  verified, rebuilt, and its same `codex-pre-resume` compatibility test separately
  executed: **1 PASS**. This rerun is not added to the full-suite count. Other
  historical/installed optional skips remain unexecuted
- Actual scripts-disabled tarball/global installation invokes the shipped new
  enrollment API for both providers with pattern evidence, compares every compiled
  byte and existing CLI help/version, and verifies equal unchanged built/installed
  receipts and database bytes. The unchanged artifact verifier separately passes
  **137 packed files**, npm-exec/global install and existing read-only stats,
  insights and failures, with `published:false`

The final full log SHA256 is
`7f499e23c7e558398c7b0591eed0150b1ac310ceb6e7d52dee104d55aac44b8d`.
The exact-seed rerun log SHA256 is
`ebac796a152ad7f75d15a99c4ab25e57e7844956e40e5e97c7a5d1df7ad288cb`.

### Preserved failure and correction history

The initial new suite had two wrong fixture assumptions: an empty appended
JSONL line is invalid under the existing reader. Replace that positive fixture
with a valid unknown JSON record and separately assert the empty-line rejection;
no product validation was relaxed. Initial new-suite result was41 PASS/2 FAIL.

A later oversized corrupted-database test exhausted its512MiB worker while the
test framework deep-compared a large Buffer. A byte-exact `Buffer.equals` assertion
retains the original private-byte guarantee without increasing heap or reducing
the malicious input. The interrupted run is not a pass. The corrected focused
suite passed47/47 before the two independent-review regressions were added.

The first inherited selection had196 PASS/1 FAIL/1 SKIP because a test still
called the current schema6. Preserve that historical6 case with its real
synthetic downgrade and add the new current7 case. The first complete frozen
4f33 run had **4,386 PASS /11 FAIL /138 SKIP**: eight inherited future-schema or
synthetic-downgrade setup mismatches and three package tests using the unwritable
default npm cache. Narrowly advance only future7 sentinels to8, add old6 refusal,
and drop only new tables in synthetic old-schema setup. Existing assertions and
genuine historical inputs remain intact. Rerun package checks with an explicit
writable cache; no registry mirror or product/package change was needed.

Independent review required safe final-close errors and a membership-only
availability receipt. Both fixes preceded their regression tests and final full
run. The close-failure harness first failed because native ESM exports cannot be
spied on directly; a test-local module wrapper enables the same real-handle fault
injection. The corrected review suite passed18/18. A selected seven-file
schema/correction suite passed251 tests with39 inherited skips before the final
aggregate; these counts are not added to4,473.

### Publication and remaining acceptance

Local implementation, independent review and installed qualification are complete.
Draft publication and the exact published head's hosted checks remain separate
until their actual receipts are recorded in issue5/PR. No main merge, package
release, actual user logs or profile-data access occurred in this qualification.
The original scope exclusions remain: no directory retirement, automatic reset,
pruning, exclusive cross-root ownership, move inference, CLI enrollment, large
complete directories above the existing64-source scan ceiling, empirical provider
usefulness, macOS qualification or broad P4 completion. A signed record is not an
external monotonic inventory anchor, and observed membership is not freshness.


### Final publication scope

The final publication has29 paths: five production, twenty test and four document
paths. The planned append to `docs/FINDINGS.md` is omitted; that file retains its
existing main9a blob unchanged. Source findings remain in this scoped contract.
The original30-path independent review and complete tests remain applicable to
identical source/test bytes; the publication narrowing changes documentation only.
No private workspace or runtime identifiers are added to this public contract.

## Main151 composition plan — 2026-10-04 UTC

Draft PR153 was published at `d14cce6647ebb8456af6f768405ad5d211e37074` after
local qualification. During publication, exploration PR151 merged as
`d1b84f166eb33f11d5b7a22ca407dbf14226fd24`; the shared append-only planning
documents now conflict, so Foundation cannot run on the initial head.

Preserve every new-main source/doc/test blob, including the exploration INFO
correction and additive insights help. Reapply only this PR's schema refusal
arrays in the two shared tests, preserving its newly merged help comparators.
Append our already-reviewed SPEC/IMPLEMENTATION sections after complete new-main
prefixes. All five directory production files remain byte-identical to the
qualified source. FINDINGS is inherited unchanged from new main and is not part
of this PR's write delta.

Verify the complete435 unowned new-main blobs, own production hash equality,
focused/full/installed gates with the exact5614 seed, and a non-force feature
merge commit retaining both initial feature and new-main parents. Actual merge
of the Draft into main is not authorized or performed by this step. Earlier9a
qualification remains historical; it is not relabeled as this composition.

### Main151 composed execution receipt

The d1 composition passed strict typecheck/build and the full suite on the same
Linux/Node24.19 one-worker512MiB setup: **4,560 PASS /0 FAIL /138 inherited SKIP**,
154 files (152 PASS/2 SKIP),431.12 seconds. This full run used the exact54-file
verified5614 seed. All50 new enrollment tests and the merged87 exploration tests
are included in that total. Actual installed enrollment remains unconditional.
The unchanged artifact verifier passed **139 files**, scripts-disabled
npm-exec/global installation and prior read-only commands, with `published:false`.

All five owned production files remain identical to the reviewed/qualified
initial feature. All435 unowned new-main blobs match exactly. The only shared
test composition is the previously reviewed unsupported-schema array change;
new-main exploration help comparators remain untouched. Full execution log
SHA256: `96ee887568699bddfe1446d98bef525b53b5e46ce47404b9636284d26a4afc7d`.
This qualifies the source composition locally; final feature-head CI is recorded
in PR153/issue5 after it actually completes.
