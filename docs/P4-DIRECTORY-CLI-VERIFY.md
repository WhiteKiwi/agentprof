# Directory enrollment CLI qualification

## Implemented contract

The explicit `scan --enroll-directory` adapter consumes PR153 without changing its directory census, membership authentication, schema, scanner or source-store APIs. Exactly one explicit Codex or Claude directory is required. Ordinary scan and file-only reconciliation keep their previous dispatch; mixed enrollment/reconciliation and duplicate/malformed arguments fail before bootstrap.

A complete directory safety census occurs before identity/SQLite creation. Enrollment then performs its own authoritative before/after census and original-revision checks. The subsequent authenticated snapshot is read synchronously, outside any other transaction, and accepted only for the same root/provider/revision/member count as the native receipt. A later membership winner is reported as stale rather than substituted. Scan warnings remain partial even when the membership committed. Interrupted/ineligible scans retain their original receipt and any already committed source work.

Public JSON contains the native enrollment receipt plus an explicit directory-scan status and an allowlisted membership snapshot. The physical root fingerprint, seal and raw paths never appear. Every member is retained in bounded JSON; human output displays at most twelve with full-population counts and exact omissions. Output ceilings are 8 MiB JSON and 32 KiB human. Not-observed is not deletion, retirement or a relocation inference. Exit codes are 0 for completed, 1 for partial/ineligible/stale, 130 for interruption and the existing CLI 2 for safe errors.

## Immutable sources and scope

Initial prerequisite d14cce6647ebb8456af6f768405ad5d211e37074 was downloaded as a git-tracked archive. Its 455-file Git tree was verified as d14a94c9643c01d027c19ef1002502b0ae283761 after removing a local dependency symlink mistakenly included in the first local index; no repository source was missing.

Before final qualification the prerequisite advanced to afdc9fbd129c352f55e3f8f32e28d9e8ecaf453d, incorporating actual main d1b84f1 and the already merged exploration detector. The new archive's 464-file Git tree was verified as 26e9e8db16b847ddfb7a776c72a33f8eef9dec7e. Our exact four-file implementation/test delta was replayed cleanly onto this immutable base. No inherited test, shared maintained document, parser, database, source detector, permanent workflow or dependency was changed by this child.

Final child scope is six paths: src/cli/directory-scan.ts, enrollment-only main.ts hunks, tests/directory-scan.test.ts, tests/directory-scan-cli.test.ts, the original pre-code P4-DIRECTORY-CLI.md and this qualification record. The original plan remains preserved; its initial dependency read is historical, not the final qualification base. Issue155 records the dependency-refresh amendment and parent coordination.

## Executed local qualification

Linux x64, Node24.21.0, TypeScript7.0.2, Vitest5.0.2, existing pinned Commander15.0.0. Strict typecheck and ordinary build PASS. The complete current-base run used two workers with a 512 MiB per-Node heap ceiling and the authentic schema5 source5614a3107b53022f29ea32d44ba83f533fd58b92 built into AGENTPROF_PRE_RESUME_DIST.

- **4,635 PASS /0 FAIL /138 inherited conditional SKIP**,154 passed plus2 skipped test files (156). No new test is skipped. The earlier original-base full run was superseded before completion after the dependency update; it is not a completed full-suite qualification and is not added to these totals.
- **75 new cases executed and passed:**51 validation/projection/real store cases plus24 public/built/installed CLI cases. This includes both providers and all three capture modes; missing/file/symlink/compressed/65-file preflight nonwrites; empty/nested directories; unchanged/remove/reappear/append; rejected appends; replaced directories; a real newer membership commit between native receipt and snapshot; corrupt HMAC rejection; actual scanner commits before cancellation; cleanup of SIGINT and caller-signal listeners; real OS SIGINT delivered to the built directory module; complete4096-member JSON and exact12/4096/4084 human detail.
- Actual 64-file CLI enrollment succeeds within the native ceiling; a65th candidate fails before any storage mutation. Partial provider evidence retains a committed membership but remains exit1/partial rather than a healthy completed result.
- Real npm pack/global installation with scripts disabled runs outside the checkout. For Codex and Claude, ordinary/timing/pattern capture receipts match built and installed stdout/stderr/exit while DB/key names, modes and bytes remain unchanged on repeats. Installed deletion observation preserves last source data; legacy scan remains compatible.
- The existing unmodified artifact verifier PASS: **140 artifact files**, npm-exec/global installed help/version and stored stats/insights/failures parity, published:false.
- A separate actual-build comparison against immutable prerequisite afdc9fbd executed **18 comparisons**: both-provider/capture ordinary scan human/JSON plus help/version. All stdout/stderr/exit and stored bytes match. Scan help differs only by the new option and its two added explanatory lines. These controls are not additional Vitest cases and are not summed into the75 or4,635 counts.

The isolated container cannot resolve the public npm registry. Local installation uses real npm11.19.0 and a loopback mirror serving only the exact already pinned Commander15.0.0 source; no npm implementation, product artifact or test result is substituted. This is an installed-artifact qualification, not a public-registry networking check. The normal-registry hosted Foundation result is recorded separately in the PR at its exact published head. Temporary test mirror must be stopped before final handoff.

## Initial failures retained

The first typecheck rejected an array-descriptor TypeScript inference and an invented output-error literal. The descriptor is now viewed as an object descriptor map and both output caps use the existing REPORT_LIMIT; no diagnostics or schema file changed. Initial focused tests produced71PASS/3FAIL because the new parameterized CLI cases expanded argument arrays as tuples and two new assertions read parserVersion from the summary root instead of capabilities. Correcting the test payloads and the actual contract path yielded all75 cases passing; existing tests, numeric/privacy assertions and native semantics were not relaxed. An earlier install-stage test execution was interrupted by its tool deadline while DNS was unavailable; no success is claimed for that unfinished attempt. Container streaming sessions are unsupported; subsequent same-turn process execution uses checked log/exit files.

## Publication boundary and remaining verification

Source transport uses only the authorized feature branch. A temporary read-only snapshot workflow exports tracked prerequisite/seed files, not .git, credentials or user data. If a patch publisher is used, it verifies decoded SHA256, exact changed-path allowlist, final Git blobs and complete target tree; it performs only a non-force feature push and removes its payload/snapshot/publisher in that commit. Shared maintained docs and the pre-code plan are preserved. No main merge, release, deployment or real-user input collection occurs.

This author used one isolated container. Separate collaboration agents and runtime UUIDs are not available and are not invented. Independent maintainer review and latest-main integration remain required. PR153 must be reviewed/merged before this child, or both must be composed and requalified without overwriting other contributors. Native/browser/real-user performance and broader P4 acceptance are not completed by CLI enrollment. Automatic directory retirement/move resolution and cross-root ownership remain separate: an authenticated absence observation alone does not authorize those operations.
