# P4 — Persisted directory batch resume state

Issue: #167  
Dependency: PR #166 (`e1c2fdf4d70068dbcf7c953f21d985b99d55391c`)

## Problem

`--batch-directory` deliberately commits each native source page before final whole-directory membership capture. If the process is interrupted after page N, a retry safely reuses committed source generations, but still starts page traversal from the beginning. Large 4,096-file roots therefore repeat discovery and source-store validation for pages that are already durably committed.

A persisted cursor must only optimize that replay. It must never become evidence that a file is present or absent.

## Contract

Persist one bounded resume record per directory root. The record contains only identities and counters:

- contract version
- root ID / provider / authenticated physical-root fingerprint
- capture mode
- membership revision observed before the run (nullable for first enrollment)
- complete pre-run census fingerprint and source count
- next page offset
- fingerprint of the ordered, already-committed prefix with exact committed source revisions
- seal bound to the installation identity key

No raw path, log content, event, diagnostic text, parser state, or secret is stored.

### Advance

The coordinator may advance the cursor only after a native page is complete: every expected source is committed/unchanged, there is no stop reason/truncation, and the source revisions used for the prefix fingerprint have been read back from authenticated source headers.

Cursor write and source-page commit cannot be one SQLite transaction because the existing scanner owns its source transaction. Therefore the cursor is explicitly a post-commit optimization hint. A crash after source commit but before cursor advance merely replays that page.

### Resume

Before skipping any page, a retry must prove all of:

1. same root ID/provider/physical root
2. same capture mode
3. same membership revision anchor
4. same complete pre-run census fingerprint/count
5. cursor offset is page-aligned and within the current census
6. freshly verified actual source content and the exact authenticated source revisions for every source in the skipped prefix match the cursor prefix fingerprint
7. cursor seal authenticates under the current installation key

An authenticated but stale hint is conditionally removed using its exact observed seal and traversal restarts from page zero. A concurrent replacement is preserved and cannot authorize skipping without its own fresh validation. Malformed/tampered rows, wrong keys and unsupported schema fail closed without deleting the evidence or silently restarting. Staleness alone must not fail enrollment, but fallback does not override existing admission checks: a physical root mismatch against registered membership remains `root_changed`/ineligible and requires the existing explicit rebind workflow. This follows the storage supplement’s existing strict boundary.

### Completion

After all pages, the existing #166 authority remains unchanged:

- repeat complete census
- verify directory lease
- require `sameCensus(before, after)`
- reconstruct the complete observed source/revision set
- close the final filesystem lease
- perform the existing synchronous membership CAS

Only after successful `committed` or `unchanged` final membership capture may normal completion remove the resume record, conditionally on the exact previously observed cursor seal. A failed/aborted/stale capture is not successful completion. Conditional removal returning stale must preserve the concurrent replacement; the older run must not fetch its new seal and delete it as a cleanup retry.

#### Completion correction — issue #169 (2026-10-04)

The original design at PR #168 head `617615b44e08ef368dd721bb7333c1bcbc769a87` stated: “A crash after membership capture but before cursor deletion is safe: the next retry sees a changed membership revision and invalidates the stale cursor.” **Historical statement, superseded:** this revision-change explanation applies to `committed`, not `unchanged`. Preserve the earlier review and storage qualification as history; this correction does not report a storage defect or implemented coordinator behavior.

Let `R` be the cursor’s membership anchor (`null` for first enrollment), and `S` its exact seal observed by the completing run:

- `committed` creates revision `R + 1` (or `1` from `null`). A surviving cursor at `R` is an authenticated stale hint on retry. Remove only `S` conditionally, then start traversal at zero with a freshly established census/root/mode/anchor. A newer cursor must survive that old removal attempt.
- `unchanged` retains prior revision `R`; revision equality cannot identify completion. The retained cursor `S` is eligible only after fresh whole-census/count, physical-root/provider, capture-mode, membership-anchor and complete processed-prefix validation, including actual source content and authenticated generation revisions. Any authenticated mismatch falls back safely; seal/key/schema/malformed-state failures remain fail-closed. A terminal offset does not waive these checks.
- When all fresh checks match, an unchanged retry may reuse the validated prefix, but it must still repeat the full final census/lease/observed-source reconstruction and original membership CAS. The cursor never grants membership capture or absence authority. Only a successful capture may enter normal completion cleanup against the seal owned by that run.
- Cleanup is a separate transaction; interrupted or failed cleanup must not imply that the already committed membership was rolled back. Any remaining hint is revalidated on a later run. A replacement `S2 != S`, whether written before the old cleanup call or between interruption and restart, must not be removed by a cleanup attempt expecting `S`.

#### Phase B cleanup regression plan — NOT RUN

These synthetic coordinator cases belong to #167 for both Codex and Claude; #169 verifies the written contract only. Test both interruption hooks independently even if no product write currently separates them: (A) immediately after successful capture returns and (B) immediately before conditional cleanup is invoked.

| Capture / interruption | Persisted membership and cursor after restart | Required Verify |
| --- | --- | --- |
| `committed` / A | Revision `R + 1` (first enrollment `1`); old cursor remains at `R`, seal `S` | Fresh validation detects anchor mismatch; conditional deletion targets only `S`; traversal restarts at zero; final membership and source history match uninterrupted enrollment |
| `committed` / B | Same committed revision and retained `S`; no cleanup has run | Independently exercise the pre-cleanup hook; verify the same stale-anchor fallback and exact-seal deletion, without treating capture as rolled back |
| `unchanged` / A | Membership stays exactly `R`; old seal `S` remains | Freshly verify full census/root/mode/anchor plus actual content and authenticated revisions for the entire skipped prefix; matching state may reuse only that validated prefix; repeat final authority/CAS and conditionally remove the run’s exact seal |
| `unchanged` / B | Same unchanged `R` and retained `S`; no cleanup has run | Independently exercise the pre-cleanup hook; revision equality alone must never skip a page or bypass full final capture validation |

For every row, Verify concurrent replacement with a valid `S2 != S`: an old `remove(root, S)` must return stale and preserve `S2` byte-for-byte, with no source/membership mutation. On restarted execution `S2` is a new hint requiring its own complete validation, never something the old run can unconditionally erase. Also Verify an absent row with expected `null` returns `unchanged`, while an absent row with old expected `S` returns `stale`; neither mutates data. Already finished source history must be preserved, and final membership must equal the uninterrupted control.

For both unchanged interruption hooks, separately mutate the whole census, physical root, capture mode, processed source bytes without an authenticated header update, and authenticated source generation while retaining membership revision `R`. Verify every mismatch prevents unsafe prefix skipping and takes the existing safe path: authenticated-stale cursor fallback cannot override root_changed/ineligible membership admission or authorize implicit physical-root rebinding. Missing files do not gain absence authority from the cursor. Separately corrupt the seal/key/schema and verify fail-closed behavior with no silent cursor deletion. These are planned tests, not executed PASS evidence.

### Maintenance invalidation

Reset, prune, rebind and future root-forget/ownership-transfer mutations must invalidate the root cursor in the same owned database transaction where practical. Until those integrations land, the resume coordinator must reject a cursor whose membership/root anchors no longer match, so stale state is never authority.

## Storage plan

Use schema 8 with a single strict table, rather than overloading `settings` or writing an unauthenticated sidecar:

`directory_batch_resume(root_id PK, provider, contract_version, key_id, root_fingerprint, membership_revision nullable, capture_mode, census_count, census_fingerprint, next_offset, prefix_fingerprint, seal)`

Bounds:

- at most 64 rows (same root catalogue ceiling)
- `census_count <= 4096`
- `next_offset <= census_count`, aligned to native page size except terminal count
- identity/seal fields <= existing 128-byte identity bound
- no variable JSON payload

Schema migration must preserve schema7 stores exactly and remain read-only incompatible until explicit write-open migration, matching existing historical-schema policy.

## Implementation split

### PR A — storage foundation (this child)
- schema7→8 migration/table
- authenticated bounded read/upsert/delete API
- corruption/tamper/key/schema/membership-anchor validation tests
- no CLI or scanner behavior change

### PR B — coordinator wiring
- page completion callback / start offset in `scanDirectoryPages`
- prefix revision proof and cursor advancement
- resume/fallback logic in `enrollDirectory`
- final deletion and maintenance invalidation
- CLI receipt fields for resumed/skipped pages
- interruption/restart tests for Codex and Claude

## Required verification before PR A leaves Draft

- schema7 authentic migration and rollback conflict
- exact schema8 reopen
- wrong key / malformed row / tampered seal / oversized values fail closed
- stale cursor can be deleted without touching source history or membership
- 64/65 root bound
- typecheck/build/focused tests/full suite/artifact
- scripts-disabled installed package
- exact hosted CI head

## Explicit non-goals

No background watcher, unlimited history, cross-machine cursor portability, raw path persistence, automatic source retirement, root-slot reclamation, ownership transfer, or main merge/release.
