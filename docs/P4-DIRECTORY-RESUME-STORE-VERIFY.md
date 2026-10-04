# Directory resume storage — executed qualification

2026-10-04. Issue #167 / Draft #168, storage foundation only. The scanner still does not skip or resume pages from this record.

## Revision and scope

Source prerequisite: original PR168 `17fa6b3f511e705294fd84206504efad0ba9f978`, on PR166 `e1c2fdf4d70068dbcf7c953f21d985b99d55391c`. The pre-code supplement was published as `f49e69795b23790ac6dd9637502ee588665d8477` before implementation. Original resume design and supplement bytes remain unchanged; the supplement explicitly clarifies that corrupted state is refused without silent deletion, rather than treating tampering as successful resume.

Published source commit: `c2b7c80cfaf2f8da9fc55176878256144f1ef490`. Its tree `fb0c16618334bee155c91f47859b30e3adcf3737` is the frozen locally tested source tree. The source delta from the supplement is 27 files, +790/-54: five production paths, eighteen narrow existing-test schema compatibility paths, three new test suites and one immutable schema7 DDL fixture. This qualification document follows without changing code or tests.

The production changes are schema8 migration, authenticated resume-state storage, migration-marker/read-only validation and resume-only orphan identity guards. CLI/scanner/parser/analysis/report, dependencies, existing help-comparison helpers and permanent workflows are unchanged. Source/header/cache/checkpoint/membership data are preserved. Save and delete use exact authenticated prior-seal CAS; save additionally checks the membership anchor, fixed envelope and monotonic offset. Malformed rows, wrong keys, tampered seals, schema mismatches and oversized state are refused. The store does not claim to verify filesystem census or source-prefix freshness.

## Environment and executed commands

Linux x64, Node24.21.0, existing pinned TypeScript7.0.2/Vitest5.0.2/Commander15.0.0. Existing dependencies were reused without version or lockfile changes. Two Vitest workers; outer Node heap512MiB. Genuine schema5 seed5614a310 supplied through AGENTPROF_PRE_RESUME_DIST; the final run additionally supplied its actual CLI as AGENTPROF_SCHEMA5_BASELINE_BINARY, activating two inherited optional migration controls.

- `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: PASS.
- `node scripts/build.mjs`: PASS.
- `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=default --reporter=json --outputFile=../full-final.json`: **4,971 PASS /0 FAIL /136 inherited conditional SKIP**, 166 passed files and one skipped file (167 total). Total cases5107. The final whole run, not a sum of retries, is the stated result.
- Scoped suites: **101 executed PASS /0 SKIP** — resume store73, schema8 migration26, installed package2. They are included in the full count.
- Corrected focused six-suite run:150 PASS /0 FAIL /0 SKIP, including all101 new cases and the actual historical migration tests. This count is not added to the full result.
- `node scripts/verify-artifact.mjs`: **147-file artifact PASS**, scripts-disabled tarball npm-exec/global installation, stored stats/insights/failures parity, `published:false`.

The local container cannot resolve the public package registry. Actual npm install/exec commands used a temporary loopback registry serving only the official existing Commander15 tarball, checked against the lockfile's SHA512. No substitute package implementation or dependency version was introduced. This is real installed-package qualification, not public-registry connectivity qualification. Hosted normal-registry checks remain separately attributable.

## Functional evidence

Both providers and all three capture modes round-trip sealed bounded state. Tests cover exact fields/descriptors, proxies/accessors/non-enumerable properties, null versus malformed membership revisions, every persisted field's tampering, oversized SQL projections, duplicate/moved rows, changed keys/secrets, cursor-only orphan refusal, exact64/65 roots and4096-source bounds, page alignment and terminal short pages.

Save rejects stale CAS tokens, changed membership or physical-root anchors, changed envelopes, offset regression and a changed prefix at the same offset. Identical operations are no-ops. Conditional delete cannot remove a newer cursor. Authenticated but now-stale hints can be explicitly removed without mutating source or membership data. Caller-owned invalidation does not commit the surrounding transaction. SQL failures after mutation, commit failure and observed abort roll back owned changes. Two independent SQLite connections prove sequential stale-winner behavior; this is not a simultaneous multi-process stress test.

The schema7 fixture was extracted from the genuine immutable predecessor's compiled migration, whose original src/db/database.ts blob is `c672cc28f07527ef61680093ceef9188e695d304`. It is not regenerated from schema8 during tests. Both-provider populated migration controls preserve every old table definition/row, normalized source, checkpoint and identity-key bytes. New tests also verify ninth-marker refusal, DDL conflict rollback, STRICT/check constraints and read-only incompatibility without migration.

A separate actual predecessor-binary probe exercised Codex/Claude × default/timing/pattern: **90 exact CLI comparisons** and **12 incompatible-reader refusal checks** passed. Schema7 inputs were created by the original17fa binary, copied into private directories, explicitly migrated by the candidate, and compared after deleting raw input files. All old tables/rows and keys were preserved; old and new read-only outputs/help matched in their compatible stores, with status/stdout/stderr and private bytes retained. These controls are not counted as additional Vitest cases.

## Preserved failures and corrections

1. Initial new store suite:66 FAIL /5 PASS. The test-only snapshot helper ordered a one-column migration table by columns1,2, failing before the intended assertions. Changing that helper to ORDER BY1 yielded71 PASS; two later negative cases brought this suite to73. Product checks were not weakened.
2. First whole run:4,968 PASS /1 FAIL /138 SKIP. One inherited metric-store test used schema8 as a future-version sentinel. It now uses9 while retaining DATABASE_SCHEMA_TOO_NEW and exact non-mutation assertions. The final complete run passed.
3. The first optional genuine-schema5 focused activation had148 PASS /2 FAIL: the isolated historical dist lacked its runtime Commander dependency and exited2 before scanning. Linking only the existing pinned dependency outside the repository corrected the environment; the same two unchanged tests and all six selected suites then passed150/150, and both controls executed again in the final full run.
4. The first independent predecessor-copy probe was correctly refused as UNSAFE_PRIVATE_FILE because Node cpSync created the destination directory as0755. Creating the synthetic destination as0700 before copying fixed the fixture, with no product permission change. All90 comparisons/12 refusal checks then passed.
5. The local npm launcher initially printed a missing mise reshim warning after installation. Setting its documented MISE_SKIP_RESHIM environment switch avoided that wrapper-only action. Installed product bytes and assertions were unchanged.

Existing conditional tests retain their original conditions. Named unavailable old artifacts are not replaced by the current predecessor, and skipped cases are not passes. Narrow existing-test changes update current schema expectations, add historical7/future9 coverage and remove only later tables in intentional downgrade fixtures. The inherited schema5 table-projection helper now asserts later membership/resume tables separately as empty while preserving every historical row comparison.

## Publication and remaining gates

The decoded source patch length89066 and SHA256 `0a32cd8877e0ad9756090e1ae840d105da37eaf224603a7030fb93b0ccc7ed10` were verified before applying against exact supplementf49. The separate transport job checked both expected branch head and final tree before a non-force update. No transport payload or publication workflow is in the feature tree or PR diff.

At creation of this document, final-head hosted Foundation checks are not yet qualified. Their actual terminal status, normal-registry install and checkout/tree provenance must be read and recorded in PR168 and issue167; local results do not imply hosted success. No source/test edits follow this qualification.

Independent maintainer review, latest prerequisite/main integration and actual merge remain pending. This is one ChatGPT implementation/self-review session, not independent approval. No main merge, package publication, real user logs or Work/Codex task launch occurred.

Still unimplemented: scanner/coordinator resume wiring, verification of skipped source content/generations and census freshness, page-completion cursor advancement, success/maintenance invalidation wiring and actual directory interruption/restart behavior. Source-history pruning, root ownership transfer, background watching, process-kill recovery, simultaneous process-race stress, native macOS/real-user/performance/release acceptance remain separate. Valid whole-record replay/deletion has no external monotonic anchor and is not claimed detectable.
