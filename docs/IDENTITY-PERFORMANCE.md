# Identity Key Reuse

## Reviewed scope — 2026-10-01

This supplement implements one measured optimization without changing the [normalization contract](NORMALIZATION.md): create one immutable Node crypto `KeyObject` per identity context, after the existing key validation and defensive copy. The context retains the key privately and computes every HMAC independently. Domains, normalization/key versions, canonical JSON, input bounds, safe errors and public fingerprints stay identical. No raw-value or fingerprint-result cache is added.

The coordination plan was reviewed before code changes. The [Project draft](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259184839) owns work status and verification checklists. The existing [SPEC](SPEC.md) user-visible contract is unchanged.

The 2026-09-30 component experiment identified repeated Node key-representation handling in the Buffer-key path. Its optimized two-worker synthetic 1 GiB path also changed scheduling and memory bounds, so its 26.86-second median is not a result for this change. This PR imports only the key representation change. It makes no full-scan throughput or RSS claim.

## Implementation and verification plan

1. Replace the private copied Buffer with `createSecretKey(Buffer.from(secret))` once in `createIdentityContext`. Verify fixed independent vectors, all identity domains and the prior Buffer-key behavior, including validation and size/depth boundaries.
2. Verify defensive copying, subarray boundaries, independent contexts and repeated calls. Run normalization/privacy and Codex fixture oracles unchanged; compare actual normalizer results under both context implementations.
3. Measure only a bounded synthetic fingerprint microbenchmark with repeated trials and exact correctness checks, then run the repository check. Record runtime, workload, measured boundaries and limitations below.

Ordered, byte-bounded normalization batches remain deferred until an ingestion/checkpoint pipeline and its ownership exist. Main `baa384f779d5eab6d31a6c7099372f19a1d98496` has a reader and Codex adapter, while product `scan` remains unimplemented. This optimization does not add workers or modify parsing, usage order, cancellation, checkpoint atomicity, SQLite or reporting.

## Verification evidence

Executed on 2026-10-01 against this patch over `baa384f`, then carried forward without overlapping changes onto main `00539409595fe17349cf68dd41c0f83cc0383e23` (the report-only PR #13 merge). The complete repository check was rerun successfully on that current base.

- `npm run check`: PASS on Node 24.19.0 / Linux x64, including TypeScript, build, all 125 tests (116 existing + 9 new), and packed artifact help/version through isolated npm exec and global prefix with install scripts disabled.
- The first artifact attempt failed because the environment's default npm cache directory was unavailable. Selecting a writable task cache resolved it; the complete check was rerun successfully. No package, lockfile or workflow change was needed.
- New identity tests cover three fixed Python `hashlib`/`hmac` vectors; all nine domains; canonical primitives/arrays, composed/decomposed Unicode and lone surrogates; exact UTF-8 2 MiB and depth boundaries; invalid keys/inputs and safe error parity; copied subarray key isolation; and 20,000 repeated/alternating calls across three contexts.
- 200 synthetic normalizer combinations match the previous Buffer-key context exactly, including diagnostics, pending/unknown/failed state and timing. Every existing Codex JSONL fixture is ingested twice through both contexts; each batch, complete snapshot and retained state matches. Existing independent provider oracles, key-file concurrency/permissions and privacy sentinel tests remain unchanged and pass.
- No user logs were read. Synthetic secrets and raw identity material are absent from the benchmark output and public context serialization. The code does not add a cache, worker or raw retained field.
- That initial Linux run did not execute macOS or the supported CI Node matrix. The later integration checks below extend its evidence. The product 1 GiB scan acceptance remains NOT RUN.

## Integration review — 2026-10-01

The user requested final review and processing of open PRs. PR #17 was integrated with main `c65761838b77f76c204d3349c5fa6b26af8ef7d4`, including the verified Claude P3 adapter. The production patch, benchmark and nine new test groups are unchanged from the original PR. All five changed files were reviewed, including the test and documentation files excluded by OCR's source-file preview; no blocking findings were found. Three independent HMAC vectors were also reproduced with Python `hashlib`/`hmac`.

On macOS arm64, a clean install with scripts disabled and the complete `npm run check` passed on Node 24.15.0, 24.21.0 and 26.7.0. Each run passed 213 tests in 12 files, TypeScript, build and the 25-file packed artifact through isolated npm exec and global-prefix help/version checks. The existing Codex and Claude provider oracles and privacy checks passed. Node 22.16.0 rejected execution with `UNSUPPORTED_RUNTIME` and exit code 2 before CLI/SQLite imports. The source tree was verified at integration commit `c5adf115e486fd7f2141db2eff467138784d11bd`; subsequent reconciliation only updates this evidence document.

The focused benchmark was reproduced after these checks on Node 24.15.0 / OpenSSL 3.5.5 / macOS arm64, Apple M4, 10 available CPUs and 17,179,869,184 bytes reported RAM. All twelve trial checksums matched the Linux value below. Buffer and KeyObject medians were 73.161 ms and 71.887 ms respectively under the same synthetic workload and timing boundaries. These close timings further show that the earlier Linux observation is specific to its runtime and environment; neither run establishes a general speed ratio. Both hosts have uncontrolled background load.

The published integration must also pass the supported Linux CI matrix on its exact final head before merge. The [PR](https://github.com/WhiteKiwi/agentprof/pull/17) and [Project draft](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=259184839) retain the final-head CI and merge evidence. No product scan, checkpoint pipeline, worker scheduling or memory-budget acceptance is added by this review.

## Focused performance observation

Reproduce after `npm ci --ignore-scripts` with `npm run build` and `node scripts/benchmark-identity.mjs`. The script imports the actual compiled identity factory and a frozen copy of the prior Buffer-key implementation. It validates all 1,000 synthetic inputs for exact equality before timing, then checks the complete output checksum after every trial. Neither path memoizes fingerprints.

Conditions: Node 24.19.0, OpenSSL 3.5.7, Linux x64, reported AMD EPYC 9V74, nine available CPUs and 10,451,464,192 bytes RAM. Shared-host background load and CPU scheduling are uncontrolled. One process, one thread, 5,000 warm-up calls per implementation, six alternating-order paired trials of 50,000 fingerprint calls per implementation. Context construction and imports happen before timing. The measured interval includes validation, JSON encoding, HMAC, formatting, loop and output-checksum work; it excludes disk I/O, parsing, SQLite, scanner startup and worker scheduling.

| Trial | Previous Buffer key (ms) | Reused KeyObject (ms) |
| --- | ---: | ---: |
| 1 | 852.206 | 235.003 |
| 2 | 868.641 | 183.888 |
| 3 | 809.205 | 158.854 |
| 4 | 827.095 | 157.215 |
| 5 | 786.531 | 169.123 |
| 6 | 801.853 | 161.244 |
| Median | 818.150 | 165.183 |

All twelve trial output checksums equal `3a2cb849a443cbcf26b3fceadf9ab884837a5dc43bb5fd5cac998dcf9cf72b56`. This final run followed the completed repository checks with no other task-owned load. A prior exploratory run overlapped artifact verification; it also matched all outputs, but is not used for this table.

This observation supports reusing the key representation on this Node version and workload. It is not a general speed ratio, product scan measurement, cold-disk measurement or memory-budget result. There is no timing assertion in tests: performance varies with runtime, hardware and workload. No new 1 GiB run was needed for this narrowly scoped patch.

## API evidence

Checked 2026-10-01: Node's [KeyObject documentation](https://nodejs.org/docs/latest-v24.x/api/crypto.html#class-keyobject) recommends the representation for its security features, and [createSecretKey](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptocreatesecretkeykey-encoding) creates a symmetric key usable by HMAC. Those documents support the API choice; the timings above are this experiment's observations, not a speed guarantee from Node. The existing 32-byte validation stays in place even though the Node API accepts other key sizes.
