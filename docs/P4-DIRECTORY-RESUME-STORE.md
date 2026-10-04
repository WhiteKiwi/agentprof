# P4 — Directory resume storage foundation

Issue #167 / Draft #168. Pre-code supplement to P4-DIRECTORY-BATCH-RESUME.md, based on immutable 17fa6b3f511e705294fd84206504efad0ba9f978. This phase implements storage only; no scanner skips a page yet.

## Source findings and decisions

The current database is schema7. Both migration and read-only validation inspect at most eight migration markers; schema8 must inspect nine to reject an extra marker. The authenticated read-only boundary and directory membership identity guard must include resume-only orphan records. Existing synthetic downgrade tests must remove the new table when representing an older schema; historical versions themselves must remain unchanged.

Resume state is not source evidence. Persist only bounded identities, the capture-mode enum, a nullable original membership revision, census count, next offset and fingerprints. The root can be unregistered during first enrollment, so it is not a foreign key to directory_membership_roots; it is bound to the installation identity key instead. Missing installation binding with any resume row is corruption, never an empty store.

The storage API authenticates state, but cannot independently verify filesystem census or skipped source content. Future coordinator code must validate the full census and exact source-generation prefix before skipping. Read returns authenticated historical hints even when their membership anchor is stale, so callers can discard them explicitly; save checks the current membership anchor under the owned write transaction.

## Contract refinements

- Use the authenticated prior seal as a compare-and-swap token for both save and remove. Null means the row must be absent. A stale delete cannot remove a concurrent writer's replacement.
- Save may advance only the same root/provider/physical/capture/census/membership envelope. Lower offsets and changed fingerprints at an identical offset are refused. Replacing an obsolete envelope requires explicit conditional removal first.
- Identical saves and absent conditional removals are no-ops. Root progress is a hint, not an externally anchored replay-proof log; deletion/recreation does not claim global monotonic history.
- Valid but stale hints may be conditionally removed. Bad keys, bad schema, malformed rows and seal failures fail closed without writes. They are not silently deleted or converted into an apparently successful resume. This clarifies the earlier broad 'tampered fallback' phrase.
- nextOffset is positive, no greater than censusCount, and divisible by16 unless it is the terminal count. censusCount is1..4096. There is no empty-run cursor.
- At most64 cursor rows are admitted, with bounded SQL projections before materialization. Row count is checked inside the write transaction; there is no eviction of another root's hint.
- Read/save/remove own their transactions and refuse nested use. A separate removeInTransaction primitive permits later atomic maintenance invalidation without committing the caller's transaction. Observed cancellation or errors roll back owned writes only.
- Source payloads, source availability, caches/checkpoints and directory memberships are never mutated by this store. The only ancillary write is establishing the identity binding in a truly empty store when inserting its first valid cursor.

## Implementation and Verify

1. Add schema7-to8 STRICT table and marker; extend existing schema/orphan checks without bootstrap or read-only migration. Verify genuine schema7 migration preserves every old table/row and key, schema7 read-only refusal, reopen/idempotence, extra-marker and DDL-conflict rollback.
2. Add src/db/directory-resume.ts with authenticated read, monotonic-envelope save, conditional delete and caller-owned invalidation. Verify both providers/all capture modes, descriptor/proxy/type/bounds rejection, each tampered column, null handling, wrong keys, stale seals/anchors,64/65 roots, transactions/abort/SQL rollback and full source/membership preservation.
3. Update only current-schema expectations, future-version sentinels and synthetic downgrade cleanup in affected existing tests. Preserve actual historical fixtures, all existing privacy/semantic assertions and conditional test gates. Verify affected suites and full regression with the genuine schema5 seed.
4. Build and qualify the scripts-disabled installed package and frozen published source. Record exact commands, failures, skips and limits in P4-DIRECTORY-RESUME-STORE-VERIFY.md. Verify exact-head CI separately from local runs and retain Draft until independent review/integration.

Single current ChatGPT implementation/self-review session; no independent subagent or runtime ID is available or claimed. No main merge/release, actual user logs or Work/Codex task launch. The next phase remains scanner/coordinator wiring, prefix verification, automatic maintenance invalidation and actual directory interruption/resume qualification.


## Completion cleanup clarification — issue #169 (2026-10-04)

The original storage-only implementation and qualification above remain unchanged. The [current completion contract and Phase B Verify matrix](P4-DIRECTORY-BATCH-RESUME.md#completion) supersede the original blanket revision-change explanation: membership `committed` advances the prior revision (or establishes `1`), while `unchanged` returns exactly the prior revision. Thus an unchanged post-capture cursor can retain its membership anchor. Only fresh complete census/physical-root/mode/anchor and actual source-content/authenticated-generation prefix validation can authorize page reuse; final census/lease and membership CAS authority still apply.

Normal completion cleanup after either successful result must remove only the previously observed seal. A concurrent replacement makes that removal stale and must survive; cleanup must not retry against the replacement’s newly read seal. An absent row with expected `null` is an `unchanged` no-op; an absent row with the old non-null seal returns `stale` without mutation. Interrupted cleanup leaves an optimization hint, not evidence of absence or permission to bypass final capture. Valid stale-state fallback stays separate from fail-closed tamper/key/schema/malformed-row handling. It cannot override existing `root_changed`/ineligible membership admission or the explicit physical-root rebind requirement.

Both-provider interruption immediately after capture and immediately before cleanup, for both `committed` and `unchanged`, plus concurrent replacement are required #167 coordinator tests. They are **NOT RUN here**. This documentation correction does not change schema8, the qualified storage primitives, or establish implemented scanner resume.
