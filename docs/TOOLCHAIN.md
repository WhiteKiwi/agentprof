# Pinned development toolchain

Scope: PR #37, originally based on `063ee04b37e97616065254c9534f430bdc33e3c3`; qualify against merged main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735`. The coordinator reviews and publishes; a separate development contributor owns any necessary implementation correction. Live claims and execution status belong to the Project-only draft item.

## Plan and Verify

1. Review the exact mise-action input, Node/pnpm pins and every lockfile resolution against the existing npm lock. **Verify:** no dependency-version or integrity drift, supported matrix retained, least-privilege CI and unsupported-runtime guard preserved.
2. Integrate current main and document development commands separately from npm consumer commands and historical evidence. **Verify:** preserved main changes, unchanged executable/engine/dependency/allowlist contracts, documentation links and no unrelated source edits.
3. Install with `pnpm install --frozen-lockfile --ignore-scripts`, then run full checks on supported local runtimes and hosted CI. **Verify:** actual typecheck/build/test/artifact results, inherited optional baseline/installed tests enabled, no skipped qualification falsely counted.
4. Package with ordinary `npm pack` lifecycle enabled, install the artifact in an isolated prefix, and exercise npm exec/global CLI plus the unsupported runtime. **Verify:** prepack build succeeds, exact artifact contents, consumer execution without development tooling, native SQLite behavior and unchanged JSON/exit contracts.
5. Freeze all changed paths, record exact receipts and obtain current-head CI before merging. **Verify:** independent all-path review, actual merge/main synchronization, and only this narrow Project draft completed.

## Evidence

NOT RUN at plan drafting. Append actual command, environment, revision and limitations after execution. No user logs, publishing, deployment, real-log pilot or package-name claim is included.
