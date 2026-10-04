# Directory membership maintenance qualification

## Candidate and execution

2026-10-04, issue #159. Immutable prerequisite: PR158 `f58a6b43478fefcd8261ab617c023e61f9e5ea80`, tree `9e84c61a7a221a1204fd35f1cce98a322eb63683`. The extracted 475-blob baseline reproduced that Git tree exactly. The pre-code plan blob `fa8d7309c3073763cee2491f5a3c430c530fe39b` is preserved unchanged. Only the scoped five production files, two new test files and two documents differ from the prerequisite.

Local execution: Linux x64, Node24.21.0, TypeScript7.0.2, Vitest5.0.2, Commander15.0.0, existing dependency bytes. Authentic historical schema5 seed `5614a3107b53022f29ea32d44ba83f533fd58b92` supplied through AGENTPROF_PRE_RESUME_DIST. Full qualification used two workers and a 512MiB Node heap limit.

Commands executed against the candidate:

```sh
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run tests/directory-maintenance.test.ts tests/directory-maintenance-cli.test.ts --maxWorkers=2
node node_modules/vitest/vitest.mjs run --maxWorkers=2
node scripts/verify-artifact.mjs
```

Results: strict typecheck and build PASS; new suites **70 executed PASS /0 FAIL /0 SKIP** (25 core,45 CLI/installed); full suite **4,750 PASS /0 FAIL /138 inherited conditional SKIP**, **158 passed +2 skipped files (160)**. Existing artifact verification **144 files PASS**, scripts-disabled npm-exec/global installation, installed read-only stats/insights/failures parity, `published:false`. Focused, inherited control and full counts are not added together. The initial inherited read-only/membership control run also passed68 cases.

Registry DNS access is restricted in the local container. Installed tests use actual npm11.19 with a temporary loopback mirror serving only the already-pinned Commander15 package; this is not public-registry connectivity qualification. Hosted frozen-install/typecheck/build/test/artifact results for the exact posted head must be read separately and recorded in the PR/issue. They are NOT RUN at the time this local evidence document is frozen.

## Verified behavior

- Authenticated inspection is read-only, creates no private directory, does not migrate old stores and exposes no paths, physical fingerprint, seal or key secret. Wrong keys, corrupted manifests, orphan rows, unsafe permissions/symlinks, unsupported schema and journal/WAL/SHM sidecars fail without repair.
- Prune removes only not-observed members whose current authenticated source is unavailable. Observed, available and absent-source rows remain. Reset explicitly clears one root's members, retains its physical binding and monotonic revision anchor, and preserves every source event/metric/relationship/cache/checkpoint row and key bytes.
- Stale original revisions are nonwriting; empty operations preserve exact private DB/key bytes. Re-enrollment after reset increments the retained revision, so pre-reset enrollment and reset requests cannot match again. Maximum-safe revision overflow refuses before mutation.
- Both providers use actual scanner/store/CLI paths, including nested-root retirement vetoes. Reset changes only the selected root; other-root observations remain. A subsequent explicit retirement can use released vetoes, with the existing source/version guards still active. No exclusive ownership or move identity is inferred.
- SQL failure or AbortSignal after the first actual membership deletion rolls the entire operation back. A microtask abort during the final asynchronous path checks also rolls back before COMMIT. Existing read-only callbacks still reject writes; async/thenable callbacks are refused.
- A separate process successfully writes first and makes an old receipt stale. A real concurrently held BEGIN IMMEDIATE causes the CLI writer to fail safely without changes; after release the same valid request succeeds. This is a lock-timeout/retry check, not an exhaustive concurrency proof.
- Complete4,096-member JSON and exact12-detail human omissions are exercised. Reset allows re-enrollment without deleting the anchor. Bounded outputs, exact canonical revisions, malformed IDs, getters/proxies/inherited options, mixed/duplicate/value-suffix/unknown/extra flags, help/version/global flag placement and missing-store errors are checked.
- Actual scripts-disabled installed tarballs outside the checkout match compiled CLI bytes and both-provider inspection/reset results while preserving source rows and key files. No production package was published.

## Failures and corrections retained

Initial core run:20 passed and2 new fixture failures because SQLite correctly prevented constructing orphan/invalid-header fixtures. The test setup now temporarily disables constraints only to construct corrupt test data, then restores them before the product operation. No product validation was weakened.

A subsequent run had2 new case-sensitive human-text expectation failures, corrected to match the intended capitalized contract. Review also found that one new it.each matrix spread argv tuples; the test now uses object-wrapped full argument arrays. All complete argument vectors were rerun, not credited from the earlier defective matrix.

The first installed test failed ECONNREFUSED because the temporary local registry process had not started after an unsupported interactive-container launch. The harness was fixed and the actual installed test rerun successfully. Final focused and full runs above had no failures or newly skipped tests. No existing test, schema, parser, analyzer, report or dependency was changed.

## Remaining gates and publication

Independent maintainer review and latest-main/prerequisite composition are pending. Dependency order: PR153 -> PR156 -> PR158 -> this PR. No main/prerequisite branch write, release, Work/Codex task or real-user log upload is performed. Temporary source/publication transport must be removed from the final diff and the final remote Git tree compared to this qualified candidate before handoff.

Reset intentionally releases this root's future retirement vetoes; it is not deletion of source evidence. Root binding and root-slot allocation remain. Physical-root rebinding, root-slot reclamation, exclusive cross-root ownership transfer, large-directory census pagination, process-kill recovery of this new operation, real-user/performance/native/macOS/release and broad P4 acceptance remain separate. File-system checks and SQLite are not one atomic snapshot; trusted stable ancestors are still required. No external-anchor replay/deletion protection is claimed.


## Ordered maintainer qualification on actual PR158/main (2026-10-04)

Original source `617e32a13ea3be5b9038acb7b4330131f2c93567` is composed with actual PR158/main `084cebf1cac97c921cfa8e09cd93b5c1910de51b`, whose four actual-main Foundation jobs passed separately. All five original production blobs and both original70-case feature suites are byte-exact. Independent review covered all nine original paths. SPEC `8dd50517640311c3426a404da1fd23510ad3e9b9`, separately returned receipt/source FINDINGS, reviewed IMPLEMENTATION `8432e1fb681085ed4e28949b61d6c59cf7adcdcd`, and the issue159 developer readback preceded the ten-path test-only correction. All developer reservations were returned before integration. The original evidence and failures above remain historical records.

Actual Node24.21.0 darwin-arm64 source typecheck/build passed; the source tsconfig does not typecheck test files. Normal-registry scripts-disabled pack/global installation outside the checkout matched all143 compiled files by relative path, SHA256 and filesystem mode; the145-file artifact check passed with `published:false`. There was no second pack/install or local full-suite run.

Initial selected eight files:382 PASS/0 FAIL/0 SKIP. Developer-selected ten files:430 PASS/0 FAIL/28 unchanged conditional SKIP (458 cases), including all129 new top-help controls and all original329 case IDs/statuses. The70 repeated maintenance cases have the same file/full-name/one-based-occurrence identity and PASS result. Combined evidence therefore contains742 unique PASS/0 FAIL/28 conditional SKIP, not812 independent passes. The remaining312 parent cases were reused without rerunning. Unavailable fourteen specifically named native historical freezes remain NOT RUN; no baseline aliases or new skip conditions were introduced.

The genuine D1 and qualified PR158 actual-installed top-help receipts are identical: status0, empty stderr,1677 UTF-8 bytes/32 LF rows. Built and actual-installed candidate receipts are identical1798 bytes/34 rows. The strict helper requires exactly the121-byte two-row directory command between the complete history block and common report prefix, removes only that block into a fresh receipt, and compares the entire remaining stdout/status/stderr. The seven historical callers preserve every other assertion; search retains its original exact-once/opposite-absence guards and two declared prior text transformations. The scan615-byte helper, public fixture and its nine routes remain unchanged. An ordinary qualified158 receipt presented as current is rejected because the directory addition is mandatory. Complete frozen-input/descriptors, no storage creation and no private-context output controls passed outside the checkout with the real installed binary.

All143 compiled/install files, genuine D1 full134 context, qualified158 full141 context, four older genuine maps, unowned source bytes/modes and frozen private receipts remain exact. Root review covers every final path and finds no unresolved High/Medium issue. Original scanner/maintenance contracts, stable-ancestor and external-anchor limitations above remain. Exact final-head four Foundation jobs plus GitGuardian, Ready, oldest-first actual merge/tree/parents, and all four actual-main Foundation jobs remain separate publication gates. Refs #159; broad #5 remains open until its own acceptance criteria pass.
