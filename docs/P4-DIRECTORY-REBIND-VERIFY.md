# Directory root rebind: author qualification

## Scope and tested inputs — 2026-10-04

Issue #162. Immutable prerequisite is PR160 `617e32a13ea3be5b9038acb7b4330131f2c93567`, tree `7eb0795b17bf9ac6191630c8fd70badbf32b5e5e`. The archive tree was checked before implementation. The pre-code plan from `b515b04388350805176b8bb446d57033dcb1ae1d` is preserved byte-for-byte (blob `0a770531682a0453f619b6d18c3ae24a251bb70c`). No edits to schema, parsers, report, dependencies, existing tests or permanent workflows.

Environment: Linux x64, Node24.21.0, npm11.19.0, pinned Commander15.0.0 / TypeScript7.0.2 / Vitest5.0.2 / @types/node24.19.0 from the existing toolchain. Full run uses authentic pre-resume schema5 build `5614a3107b53022f29ea32d44ba83f533fd58b92`, 2 workers and 512MiB per Node. No real user logs or secrets were used.

## Executed commands and results

```bash
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run tests/directory-rebind.test.ts tests/directory-rebind-cli.test.ts --maxWorkers=2
AGENTPROF_PRE_RESUME_DIST=/path/to/verified/schema5/dist node node_modules/vitest/vitest.mjs run --maxWorkers=2
node scripts/verify-artifact.mjs
```

- Strict source typecheck and build: PASS.
- New suites: **65 PASS /0 FAIL /0 SKIP** (core15 + CLI/integration/installed50), then executed again within full regression.
- Full regression: **4,815 PASS /0 FAIL /138 inherited conditional SKIP**, **160 passed +2 skipped files (162)**. Start05:24:58 UTC; test duration220.69s. Counts from focused/full and local/hosted runs must not be added together.
- Existing artifact verifier: **145 files PASS**, scripts-disabled npm-exec/global install and stored stats/insights/failures controls, `published:false`.
- Actual scripts-disabled packed installation contains the exact compiled new module. Both providers rebind using the installed executable; unchanged built/installed JSON matches and stored source tables/key bytes remain unchanged.
- Codex/Claude x default/timing/pattern capture: nonempty refusal, explicit reset, real same-path directory replacement, normal enrollment refusal before rebind, rebind revision2->3, old-request rejection, same-binding byte-identical no-op, explicit re-enrollment at revision4.
- Authenticated source/other-root preservation, wrong key/seal, missing/nonempty/stale root, MAX_SAFE revision overflow, and old enrollment/retirement/maintenance receipts tested.
- Invalid descriptors/CLI flags, missing/old/future/unsafe/sidecar stores, wrong logical path and non-directory/symlink/absent target refused without bootstrap, migration or private-path output.
- Real write lock held while a separate CLI process attempts rebind: safe timeout refusal and successful retry after release. An intervening real authenticated update between preliminary read and write is retained as stale.
- SQL trigger failure after an actual root update and controlled final lease-verify/close failures roll back. A real filesystem rename during the final verification and an AbortSignal observed during final verification leave the old DB bytes intact; owned handles/listeners close.

Local registry DNS is restricted. Real npm installed the real packed application using a temporary loopback registry serving only the already pinned Commander15 tarball; no npm executable or application module was faked. This does not establish public-registry reachability. Hosted normal-registry frozen installation and final-head CI are separate gates to be recorded in the PR after publication.

## Frozen implementation/test blobs

| Path | Git blob SHA |
|---|---|
| src/cli/directory-rebind.ts | bb6815c914f2a706dca419ea6810dd14f9bdb1fb |
| src/cli/directory.ts | 4276c8b987975a1fc0b5bd23bcc8223bc67897e7 |
| src/db/directory-membership.ts | 8d4d065c769e9626132c142bc46ed1c46f57baf2 |
| src/db/read-only.ts | 2a1b7a962eec03bf54cfaf345b747cb0e91d3489 |
| tests/directory-rebind.test.ts | 0b3a19520daac68a454f0aa87670d7cd4c733637 |
| tests/directory-rebind-cli.test.ts | e3d5e46c3900a097433fe7fb85172f4d96669a39 |

Each uploaded Git blob matched the frozen local hash. The temporary prerequisite snapshot workflow is not part of the final candidate tree. Final commit/tree and exact-head hosted results belong in the PR handoff, not a claim of actual main integration.

## Failures and limitations retained

The first new CLI suite failed to parse because of a test-matrix parenthesis edit; the matrix was split into a named value. A subsequent attempt hit the execution deadline while the local registry helper had not started; that incomplete run is not a pass. A deliberately added explicit-undefined reset case reproduced an argument-validation gap; own-property checks now reject it, and all new/full suites were rerun without weakening old tests or changing fixtures. Earlier core14/CLI37 runs are superseded by the final65, not extra coverage counts.

Independent maintainer review, latest-main/prerequisite composition, actual merge/release, real-user accuracy, native macOS, large-directory performance and rebind-specific process-kill/recovery are NOT RUN. Controlled rollback and a held-lock test do not replace crash recovery. Filesystem and SQLite do not form one atomic snapshot: trusted stable ancestors remain required. No external monotonic anchor is claimed against full valid-record replay. Rebind does not scan content, clear membership, transfer exclusive ownership, reclaim a root slot or prune source history.

Review after PR160 and the preceding PR156/158 integration. Issue #162 remains open until its independent review and authorized actual merge; broad #5 acceptance is separate.


## Ordered maintainer qualification on actual PR160/main — 2026-10-04

Original source `d0931a53600d2127d551597627b2bee821f26dc3` is composed with actual PR160/main `ea482f1102f3be85b547b21957eea5df7d05fcb9`. Independent and root immutable source reviews cover all eight original paths and all65 authored controls; no production Critical/High/Medium finding. All eight original blobs were exact before this additive evidence paragraph, including four production files and both feature suites. All490 unowned main blobs/types/modes are exact. Original precode `b515b04388350805176b8bb446d57033dcb1ae1d`, source findings, four-step implementation/Verify and all author failures/limits above remain preserved. No product/test correction is required or implemented by the maintainer.

Node24.21.0 darwin-arm64 source typecheck/build passed. One selected batch of12 files executed616 PASS/0 FAIL/0 SKIP:65 rebind,70 maintenance,45 retirement,75 enrollment,156 strict scan-help,129 strict top-help,36 report composition and40 legacy read-only database controls. Counts from original source CI or prerequisite tests are not added. The selected JSON is indexed by file/full name/one-based same-name occurrence. There was no local full-suite rerun. Fourteen unavailable specifically named native historical freezes remain NOT RUN and retain their original conditions; no alias or fabricated baseline was supplied.

The actual normal-registry scripts-disabled global installation outside the checkout matches all144 compiled files by relative path/hash/mode. The146-file artifact verification passes with `published:false`. Built and actual-installed complete top-level and scan-help receipts are byte/status/stderr-identical to qualified160; directory-help's scoped rebind additions are exercised by the original CLI cases. The real original scripts-disabled rebind tarball control ran rather than being skipped. Source bytes/modes, all current compiled/install files and qualified160 full143 installed context remain exact after selected/artifact execution.

The separate narrowly reviewed precommit question confirms the declared contract, not a stronger filesystem guarantee. Original specification line17 explicitly orders final private datastore path checks, optional callback, cancellation and COMMIT. The callback verifies/closes the selected input-directory lease; it does not pin private datastore directory/DB/key pathnames through every await. A datastore leaf substituted during the callback is not rechecked, and inherited writer source expressly excludes external path/mode substitution from supported concurrency. Stable ancestors alone do not exclude leaf replacement. Lack of an external monotonic anchor against full-valid-record replay is a separate limit. No runtime leaf-substitution result is claimed; the optional synthetic observation proposal remains NOT RUN. Existing no-hook control behavior and new callback failure/post-callback cancellation rollback controls passed within their documented scope.

Root review covers every final path and finds no unresolved High/Medium issue. Actual160 main4 must pass before this PR's oldest-first merge. Exact final-head Foundation4 plus GitGuardian, Ready, actual merge parents/qualified tree, primary tracked-clean ff-only and separately owned actual-main4 remain required publication gates. Close only issue162 after its own Verify gates; broad #5 remains open. Earlier author's synthetic CI merge and local/hosted evidence remain attributed to their recorded stage and are not an actual-main merge claim here.
