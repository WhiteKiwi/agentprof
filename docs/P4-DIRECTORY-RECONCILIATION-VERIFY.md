# Directory absence reconciliation qualification

## Scope and exact source

2026-10-04, child #157; predecessor PR156 `f790113be47683ae691439eb592e3410ee166313`, which depends on PR153. The pre-code contract was committed at `4317381222c9c50bd22d904889bbc0f9f196f691`. This qualification concerns the bounded `scan --enroll-directory --retire-missing` successor only. Independent maintainer review and actual dependency-order merge remain required.

The new coordinator performs two final complete directory censuses and rechecks physical root identity after successful native enrollment. One owned `BEGIN IMMEDIATE` then authenticates all bounded root memberships, validates the selected revision and live source receipts, and retires only eligible missing members. A failure or observed abort rolls back the entire retirement batch. Earlier successful enrollment/source commits are independent and remain. Event/metric/relationship history is retained; obsolete source cache/checkpoint state is invalidated by the existing retirement mutation.

## Executed local checks

Linux x64, Node24.21.0, pinned existing TypeScript7.0.2/Vitest5.0.2/Commander15.0.0 dependencies. Full qualification used two workers and a512MiB heap per Node with the genuine schema5 seed source `5614a3107b53022f29ea32d44ba83f533fd58b92` rebuilt separately. No dependencies or lockfiles changed.

| Check | Actual result |
| --- | --- |
| Strict TypeScript source check and build | PASS |
| New focused tests | **45 PASS /0 FAIL /0 SKIP**: core29 + CLI/installed16 |
| Complete existing+new test discovery | **4,680 PASS /0 FAIL /138 inherited conditional SKIP**;156 passed +2 skipped test files (158) |
| Existing artifact verifier | **142 files PASS**, scripts disabled, tarball npm-exec/global-install and stored stats/insights/failures parity; `published:false` |
| Actual installed new CLI | PASS, both providers × default/timing/pattern capture, disappearance/repeat/restoration and exact built/installed receipts |
| Previous binary compatibility | **38 comparisons PASS** against the immutable predecessor: plain scan, enrollment JSON/human, retained missing members, help/version; stdout/stderr/exit and DB/key bytes/modes unchanged. Only scan help is intentionally extended |

Commands used the existing tools directly: `node node_modules/typescript/lib/tsc.js -p tsconfig.json --noEmit`, `node scripts/build.mjs`, `node node_modules/vitest/vitest.mjs run --maxWorkers=2`, and `node scripts/verify-artifact.mjs`. Local npm installation used real npm11.19 with a loopback registry serving only the already pinned Commander15 package because external registry DNS was unavailable. This is installed-artifact qualification, not a public-registry connectivity claim. Normal-registry hosted CI results must be recorded separately on the final PR head.

Focused and full counts are not added together. The38 separate comparisons are not additional test cases. The138 inherited optional cases were not selected; they are not passes.

## Boundary and failure evidence

Actual synthetic Codex/Claude log files verify removal, idempotent repeat, reappearance, path rename, capture-mode behavior and unchanged stored payloads. A renamed path is ingested as a new path-based source identity; the absent old source can become unavailable. No move relationship, identity transfer or change to existing history-copy reconciliation is inferred.

Parent/child directory memberships demonstrate the conservative cross-root veto: an observed entry in another authenticated root blocks retirement until that root is explicitly rescanned. An independently replaced missing generation is retained as `source_changed`. Changed membership, changed live source receipt, missing/replaced/symlink root, compressed entry, changed final census, reappeared path, incomplete scan and final close error refuse retirement without changing source states.

A SQLite trigger that fails after one source update demonstrates complete rollback. A test-controlled prepared-statement hook aborts immediately after a real source update and demonstrates cancellation rollback without modifying production transaction policy. Malformed seals, missing manifest rows, checkpoint or payload corruption and wrong keys fail closed. Existing ingestion reads continue to reject caller transactions; new composition helpers require a caller transaction and preserve the old APIs.

The actual validated synthetic store reaches4,096 missing members, checks every source and returns all4,096 outcomes. Four signed manifests total16,384 member references and remain admissible; a fifth refuses with `catalogue_limit`. The separate root-count test accepts64 roots and refuses65. These are store limits, not a claim that the existing scanner admits4,096 files per pass; its64-source bound remains unchanged. JSON retains all bounded outcomes; human output shows12 with exact omissions. Final JSON/human8MiB/32KiB caps remain enforced.

## Preserved initial failures

The first cancellation fixture attempted a SQLite user-defined function in a trigger; `trusted_schema=OFF` correctly rejected that before the callback. The test was rewritten to instrument an actual prepared update instead; database trust settings and production assertions were not weakened. Two new CLI tests initially expected an imprecise phrase and were corrected to the actual `retains event/metric/relationship history` wording. The large-store fixture initially used a non-null boundary fingerprint at offset0 and was correctly rejected by the existing header contract; only its synthetic boundary was corrected to null. The final focused and full runs above follow those fixture corrections. No existing test file or assertion changed.

## Limits and handoff

Filesystem enumeration and SQLite cannot form one atomic transaction. Trusted stable ancestors are required; repeated complete censuses reduce observed-change windows but do not promise immunity to hostile filesystem races. Other-root observations may be old; the veto deliberately favors retaining data. All64 roots and up to16,384 references are authenticated before a decision; over-budget catalogues are refused, never truncated.

This is not exclusive cross-root ownership, automatic pruning/reset, large-directory pagination, cryptographic protection against deletion/replay of an entire valid record set without an external anchor, empirical provider accuracy, performance acceptance, native/macOS qualification, or package release. No real user logs or secrets were used. New batch process-kill/restart and cross-process lock-contention experiments were not run; transaction rollback and the separately enumerated existing regression tests are not represented as those experiments.

The current ChatGPT session self-reviewed the plan and changes. No separate collaboration agent, runtime UUID or independent maintainer review is claimed. Temporary source snapshot/publication transport is excluded from the final product tree. Final remote blob/tree equality and hosted CI are publication gates, to be recorded on the PR after execution. No main or prerequisite branch is changed by this successor.


## Independent maintainer integration qualification — 2026-10-04

This additive record preserves the author's source qualification, initial failures and limits above. Maintainer integration is based on actual PR156/main `bbf0668cfca916a5adb8dcbbbafbc54bf5add132`; original PR158 `f58a6b43478fefcd8261ab617c023e61f9e5ea80` production6 and feature-test2 blobs remain exact. Separate immutable review covered all10 original paths and45 static feature controls. The pre-code correction SPEC, independent FINDINGS and reviewed IMPLEMENTATION preceded the separate developer's two-file test-only change. All developer and research reservations are returned; root retains only #157 final publication/CI orchestration.

On macOS arm64 with Node24.21.0, source typecheck/build PASS. Actual normal-registry npm pack/global install outside the checkout, scripts disabled, validates141 compiled/143 artifact files with `published:false`. Installed and compiled complete help receipts match at status0, empty stderr,1556 stdout bytes and absent storage. Genuine D1's complete134-file compiled context and qualified PR156's139-file installed context, historical runtime inputs, bytes and filesystem modes remain exact. Fourteen unavailable named native historical freezes remain NOT RUN and are not aliased. No dependencies or production source changed in the correction; the source typecheck does not typecheck test files.

The initial selected260 cases were257 PASS /3 FAIL /0 SKIP. All45 new retirement,75 retained enrollment and36 report compatibility guards passed; the three failures were the strict scan-help positive and two old mutation anchors made inactive by the declared intervening retirement option. Those initial JSON/logs and a separate source-mode preflight comparison failure remain recorded. The preflight failure compared incidental root0600 source modes with a fresh0644 checkout; each checkout's starting modes and Git100644 modes were preserved without chmod. It was not a test/build failure.

The reviewed helper now requires exactly the declared three retirement physical lines/308 bytes after enrollment and as the final footer. It removes only those required exact components in a fresh local receipt, then applies every prior307-byte enrollment/object/status/stderr/privacy/remainder guard against genuine D1. Both additions total615 bytes. Retirement-free qualified PR156 is rejected; reordered, missing, duplicated, padded, wrapped, future and unrelated/private additions are refused. The common API, all nine callers and original inert D1 fixture remain unchanged. Existing104 help case names and guards remain; only the two stale mutation anchors change. New52 non-noop retirement/historical negatives were added.

Separate developer source typecheck/build, exact installed receipt control and selected three files were201 PASS /0 FAIL /0 SKIP (help156 plus original retirement45). Repeated149 cases are counted once. Reusing the unmodified initial75 enrollment and36 report results gives **312 unique PASS /0 FAIL /0 SKIP** across the selected six files. No local full-suite or native empirical acceptance is claimed. Exact final-head Foundation four jobs and GitGuardian, followed by actual dependency-order merge and actual-main Foundation four jobs, remain independent publication/closeout gates. Broad #5 stays open; only child #157 can close after those actual gates.
