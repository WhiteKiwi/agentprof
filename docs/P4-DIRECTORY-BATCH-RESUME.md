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
6. every source in the skipped prefix still has the exact authenticated revision represented by the cursor prefix fingerprint
7. cursor seal authenticates under the current installation key

Any mismatch deletes/refuses the hint and restarts from page zero. It must not fail the enrollment solely because an optimization hint is stale.

### Completion

After all pages, the existing #166 authority remains unchanged:

- repeat complete census
- verify directory lease
- require `sameCensus(before, after)`
- reconstruct the complete observed source/revision set
- close the final filesystem lease
- perform the existing synchronous membership CAS

Only after successful committed/unchanged final membership capture is the resume record deleted. A crash after membership capture but before cursor deletion is safe: the next retry sees a changed membership revision and invalidates the stale cursor.

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
