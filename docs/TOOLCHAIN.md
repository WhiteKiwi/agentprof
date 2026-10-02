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

## Independent parent qualification (2026-10-02)

The original implementation file contents and npm lock deletion are unchanged from PR head `d5e09cbf1f0e3a3d961076d0c75da00f0b311859`. Integrated candidate `0165f7fe7f790065e04421827c3c8a52c3c8e4c4` preserves merged main `ffd87e1dc1bcbc21d925d7466ae19b944c1a8735`, including Claude parser v2 and strict historical CLI compatibility checks. All ten changed paths were reviewed, including the deleted npm lock and complete new lock graph; no implementation correction was required. All 144 local links in the five reserved documentation files resolve.

macOS arm64 Node 24.15.0, 24.21.0 and 26.7.0 each passed `pnpm check`: typecheck/build, 55 files / 1,544 tests with zero skips, and the unchanged 52-file artifact verifier. All 40 optional cases used authentic preserved historical baseline binaries and this candidate's independently installed package. Frozen pnpm 10.33.0 installation succeeded with dependency scripts disabled; no lock rewrite was needed.

With the owned generated dist removed first, ordinary `npm pack --json` successfully ran the new pnpm prepack build. The allowlisted artifact retains executable mode 0755 and 50 runtime files, whose bytes and modes match the installed distribution. Isolated npm install/npm exec and direct installed help/version pass without mise or pnpm on PATH. A separate installed synthetic scan committed one source and read it through native SQLite in that same tool-free consumer environment. The standard artifact verifier additionally passed isolated global installation and synthetic read-only stats, insights and failure parity. Node 22.16.0 rejects the installed CLI with exit 2, empty stdout and `UNSUPPORTED_RUNTIME` before CLI/SQLite imports.

Exact candidate push run [37021161958](https://github.com/WhiteKiwi/agentprof/actions/runs/37021161958) and PR test-merge run [37021168694](https://github.com/WhiteKiwi/agentprof/actions/runs/37021168694) passed all eight actual jobs. Each supported Linux job passed 55 files / 1,504 tests with the 40 optional local-baseline/installed cases explicitly skipped, plus the 52-file artifact verifier; the separate Node 22.16.0 guard passed. Checked checkout SHAs, test-merge parents and tree prove the correct integrated content ran. Effective reported runtimes match all three matrix values. GitGuardian also passed. Final publication adds only this execution record; current-head CI is checked again before merge and retained with the Project closeout.

Proof: private `agentprof-reviews/pr37-40-20261002-51d062/pr37-qualification`, complete lock comparison under `research-pr37`, and [Project draft](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=260682270). Only synthetic inputs were exercised. No npm publication, deployment, real-user logs, performance claim or broad P7 completion is asserted.

## Common pnpm pin follow-up plan (2026-10-02)

Base: merged main `106d6c1329499fdb57e63c7aad3f8aac78987249`. Actual owner-authorized cross-repository coordination requests pnpm 10.34.6 with Node 24.21.0; the message arrived after PR #37 was merged. Preserve that merge and its proof. This is a narrow successor; original dependency and product contracts remain intact. Live claim and execution status belong to a separate Project draft. The coordinator plans/reviews/publishes; a separate development contributor changes only the current tool pins.

1. Confirm the requested pnpm release and the exact locally installed runtime, preserving source applicability. **Verify:** primary package/release metadata and actual 10.34.6 version outside package-manager auto-selection; Node engine compatibility and frozen-lock support.
2. Align only mise.toml, package.json packageManager and the workflow's pnpm tool value; update current README setup wording. **Verify:** exact three configuration value replacements, unchanged npm consumer/dependency/scripts/engine/matrix/guard contracts and byte-identical pnpm lock; historical 10.33.0 evidence retained.
3. Qualify frozen scripts-disabled installation, enabled npm prepack, full pinned macOS checks and exact installed artifact. **Verify:** all 40 optional cases enabled with original historical baselines, zero skips, artifact contents/modes, npm consumers without development tools and Node22 rejection; hosted supported-runtime CI and guard pass at the actual proposed head.
4. Publish a successor PR, hold its merge for the authorized cross-repository ordering handoff, then synchronize main and release this narrow claim. **Verify:** exact-head/all-path review and successful CI, actual ordering handoff, merged tree equality, conditional Project readback and preserved unrelated claims. No package publication or deployment.

At initial follow-up drafting, qualification was NOT RUN and no implementation changes had been made. PR #38~#40 were queued and unclaimed by this coordinator; the plan requires handling this successor and the ordering gate first. Live status belongs to the Project.
