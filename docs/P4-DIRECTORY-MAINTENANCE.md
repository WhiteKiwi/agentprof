# Explicit directory membership maintenance

## Scope and user behavior

Planned 2026-10-04; implementation and tests have not run at this planning revision. This is the reset/pruning follow-up to PR158, based on immutable f58a6b43478fefcd8261ab617c023e61f9e5ea80. Read the inherited SPEC/IMPLEMENTATION/TODO and PR153/156/158 contracts first. This scoped specification/findings/implementation document avoids replacing shared ongoing plans.

`agentprof directory --root FULL_ROOT_ID` inspects one authenticated stored membership without scanning inputs or creating/migrating a store. `--prune --expected-revision N` removes only not_observed members whose authenticated current source is unavailable. Observed, still-available and missing-source members remain. `--reset --expected-revision N` explicitly clears all selected root members and releases that root's cross-root observation vetoes. Reset is not implicit pruning and does not retire or delete any source.

Both mutations require the exact previously inspected positive revision, authenticate the prior membership, execute in one owned write transaction and reseal the remaining membership. The root row, provider and physical binding remain; revision increments only on a change. No root deletion/recreation: this avoids reusing a revision and prevents old enrollment/retirement receipts from matching after reset. Empty reset/prune is unchanged. Physical-root replacement, root-slot reclamation, exclusive ownership transfer and large-directory census pagination remain separate.

All source event/metric/relationship rows, cache/checkpoint bytes and identity-key files are preserved. Only the selected membership rows/root metadata may change. A later explicit scan can enroll current files again. A reset intentionally releases this root's veto on later opt-in retire-missing operations; the receipt/help must say so. It is not proof of a file deletion/move. Raw paths, physical fingerprints and seals never appear in output.

## Findings and design review

The existing membership store authenticates the complete manifest and binds root/provider/fingerprint/revision. PR158 exposes transaction-bound source authentication and all-root veto checks. Simply deleting a root would reset its next revision to one, so retain the anchor. Prune must read full authenticated source evidence, not trust an unauthenticated availability header. Existing read-only store preflight supplies bounded key/DB validation and rejects absent/old-schema/sidecar/unsafe stores. Reuse that boundary for an explicitly authenticated existing-store mutation path, without invoking bootstrap or migration.

This environment exposes no independent development/research/review subagent or session UUID. The single continuation will execute and test this scoped change; independent maintainer review is still required. No independent approval is claimed.

## Implementation and Verify

1. Extend the existing-store access boundary for authenticated read/write callbacks without altering the legacy read-only API. Verify missing/corrupt/unsafe/old-schema/sidecar stores do not create, migrate or repair files; preserve legacy read-only rejection tests and callback transaction ownership.
2. Add authenticated membership replacement restricted to removing existing members, and maintenance inspect/prune/reset operations. Verify wrong key/seal, stale revision, no-op, source preservation, source corruption fail-closed, revision monotonicity, all-batch SQL-error/abort rollback and independent-root preservation.
3. Register the directory command with strict pre-I/O argument validation and bounded human/full JSON output. Verify root identity, mutually exclusive modes, required positive revision, duplicate/value/unknown/extra flags, global argument placement, help/version and exact omission counts; real both-provider scan/reset/prune/re-enroll flows.
4. Qualify source and installed builds. Verify strict typecheck/build, focused and full tests, scripts-disabled installed command, artifact gate, final remote blobs/tree and exact-head hosted CI. Record failures, skips and environment limitations rather than counting unrun checks as passes.
5. Publish a Draft against PR158 and hand off with dependency order. Verify no main/prerequisite writes, no user logs/secrets/release/Work/Codex task, no broad parent closure. Child closure requires independent review and actual merge.
