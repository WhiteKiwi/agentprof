# Explicit same-path directory rebinding

## Specification — 2026-10-04, before implementation

Continue the remaining physical-root replacement behavior from #5 and PR160. Baseline: PR160 commit `617e32a13ea3be5b9038acb7b4330131f2c93567`, tree `7eb0795b17bf9ac6191630c8fd70badbf32b5e5e`. This child does not merge or modify prerequisite branches. PR153 is now merged, but PR156/158/160 still need their independent integration.

`agentprof directory --root FULL_ROOT_ID --rebind --path SAME_LOGICAL_PATH --expected-revision N` explicitly accepts the currently accessible physical directory at the exact registered provider/path identity. The root must already exist and have an empty membership; inspect and, when intended, use the existing explicit reset first. Rebind does not silently clear membership or release observation vetoes. The user-supplied path is transient and never emitted or stored as plaintext.

Keep the root ID, provider and monotonic revision anchor. Only physical binding, revision and authentication seal may change. Same binding is an unchanged no-op. Changed binding increments the revision once, so every old enrollment, retirement or maintenance receipt stays stale. Preserve all source event/metric/relationship payloads, availability, cache/checkpoints, other roots and identity-key bytes. Rebind neither scans logs nor initializes/migrates a missing/old store; later explicit enrollment collects the new directory contents.

Reject malformed/duplicated/mixed flags before I/O. Rebind conflicts with prune/reset and requires path plus a positive exact revision. Missing root, nonempty membership, stale revision, different logical path, symlinks, non-directory, inaccessible or replaced filesystem target cannot authorize a binding update. Overflow and commit-time errors must roll back. Filesystem and SQLite do not form one atomic snapshot; supported operation assumes trusted stable ancestors and checks an owned directory handle through precommit.

## Source findings and design review

The immutable baseline tree was materialized through a read-only GitHub artifact and verified with `git write-tree`. `src/scanner/directory-enrollment.ts` derives root ID from `[directory_root_v1, provider, resolvedPath]` and physical fingerprint from `[directory_physical_root_v1, dev, ino, mode, uid]`; normal enrollment refuses physical changes before scanning. `src/db/directory-membership.ts` authenticates the full root/manifest and retains the monotonic anchor on reset. Therefore deleting/recreating the root or changing the fingerprint with an unsigned SQL update would break existing receipt or integrity guarantees.

Reuse the strict existing-store access from PR160. Add a narrowly optional precommit verification callback for explicit writable access, called after the existing final datastore path checks and before cancellation check/COMMIT. Legacy callers keep their same synchronous operation callback and no-hook execution path. Rebind uses this callback to verify and close its owned filesystem lease; failure occurs before commit. Public errors remain fixed SafeError codes. No raw-path output or automatic recovery is introduced.

No collaboration subagent or runtime session UUID is exposed in this continuation. Source inspection, implementation and author tests are performed in one isolated container; independent maintainer review remains required and is not claimed.

## Implementation plan and Verify

1. Add an authenticated empty-root rebind primitive and explicit writable precommit guard. **Verify:** wrong key/seal, missing/nonempty root, original revision CAS, monotonic revision/MAX_SAFE overflow, no-op, guarded failure rollback and unchanged source tables.
2. Add rebind coordinator and integrate the existing directory command without changing inspect/prune/reset receipts. **Verify:** strict descriptor and CLI argument checks before I/O; same logical path; symlink/file/missing root refusal; real directory replacement, lease recheck/close and abort/listener cleanup.
3. Add synthetic both-provider integration and regressions. **Verify:** reset -> rebind -> re-enroll, earlier receipts stale, source/key/other-root preservation, failed precommit leaves old binding, repeated unchanged operation, build and available full/installed checks. Record initial failures and unrun gates separately.
4. Publish a scoped Draft against PR160. **Verify:** only reserved source/tests/docs, temporary snapshot removed from final tree, local/remote content equality and exact-head CI. Review and actual merge are separate; do not close broad #5 or merge main.

Reserved: rebind-only helper in `src/db/directory-membership.ts`, optional guard in `src/db/read-only.ts`, new `src/cli/directory-rebind.ts`, rebind-only registration/dispatch/help in `src/cli/directory.ts`, new `tests/directory-rebind*.test.ts`, and `docs/P4-DIRECTORY-REBIND*.md`. No schema/parser/report/dependency or existing-test changes. Root-slot reclamation, cross-root exclusive ownership, source-history deletion and large-census pagination remain separate.

At this planning revision, implementation and new tests are NOT RUN.
