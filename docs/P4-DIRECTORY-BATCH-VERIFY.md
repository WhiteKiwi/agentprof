# Directory batch enrollment — author qualification

## Exact scope and environment

2026-10-04. Prerequisite: PR163 `d0931a53600d2127d551597627b2bee821f26dc3`, tree `0dcfd262f5fbf007493c04a44ed22275b14636b0`. The pre-code plan was published at `aa60e9b2b6802a255983b5e8ac203c7de780a355`; its archived complete tree `eb296bb978273881e870a15c53eea5da29506187` was independently reproduced by `git write-tree` before editing. The retirement-proof scope amendment was posted on issue165 before production edits and appended to that plan. Single-session implementation/self-review; independent maintainer approval is still required.

Local Linux x64, Node24.21.0, existing TypeScript7.0.2/Vitest5.0.2/Commander15.0.0. Existing dependency and historical schema5 toolchain archives were reused. `AGENTPROF_PRE_RESUME_DIST` points at the archived5614a310 schema5 build. No package/lockfile/schema/provider/parser/report/ordinary scan-limit changes, no existing test edits, no main/prerequisite branch writes, no release or Work/Codex task.

## Executed verification

| Check | Actual result |
|---|---|
| `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | PASS |
| `node scripts/build.mjs` | PASS |
| New core suite `directory-batch.test.ts` | **25 PASS**, including full4096-file/256-page enrollment and bounded complete output |
| New CLI/installed suite `directory-batch-cli.test.ts` | **20 PASS**, including real scripts-disabled installed Codex/Claude batch paths |
| Full `vitest run --maxWorkers=2`, Node heap512MiB per process | **4,860 PASS /0 FAIL /138 inherited conditional SKIP**,162 passed +2 skipped files (164) |
| `node scripts/verify-artifact.mjs` | **146 files PASS**; actual pack/npm-exec/global install and stored stats/insights/failures, published:false |
| Independent prerequisite/candidate executable comparison | **34 PASS**: no-flag scan/enrollment for both providers and all capture modes, stored directory inspection, help/version; exact stdout/stderr/exit and DB/key bytes/modes |
| Exact published head hosted CI | Not run at this pre-publication document revision; actual run/head/status will be recorded in the PR handoff |

New45 cases are included in the full4860, not added to it. The separate34 prior-build comparisons and focused/local/hosted repetitions are not summed. The first24-case core run passed before the full4096 coordinator case was added; the complete final25-case suite and CLI20 ran in the full suite. Two earlier focused attempts were interrupted by the tool execution timeout before producing a result; neither is counted as a pass. No product/test assertions were relaxed. Full qualification completed with no test failures.

## What was exercised

- Real65-file Codex and Claude collections for default, usage-timing and pattern-evidence capture: native16/16/16/16/1 pages; source versions retained; warnings remain partial; repeated collection is unchanged; complete privacy-safe receipts.
- Empty/nested collections, omission/reappearance with retained source payloads, native64 success/65 refusal without opt-in, absent/false flag compatibility. The old scanner limits,64-entry capture and64-ID retirement proof still reject oversized input.
- Real filesystem changes between pages (add/remove/subdirectory replacement), rejected middle page, cancellation after first/final page, independent source revision changes and competing membership CAS. A partial collection never replaces membership; already committed source generations are not rolled back with later collection failure.
- Global256 diagnostic samples, correct dropped counts and unique page-remapped aliases. Complete4096-file collection uses256 native pages and one final membership revision; full JSON retains all members and human output states12 shown/4084 omitted.
- Expanded census exact4096/4097 selected files,16384 total entries including the root,256 directories, and unchanged symlink/compressed-entry refusal. Real4096-source capture validates authenticated prior membership, stale source revisions, wrong key, unchanged reuse, oversized input and SQL-error rollback.
- Batch retirement with65 currently observed sources, all-root observation vetoes, retained history, idempotent repeated retirement and source restoration. Built CLI additionally exercises actual nested overlapping roots. No move identity or exclusive ownership is inferred.
- Strict malformed/duplicate/value-suffix/mixed CLI flags before bootstrap, immutable pre-await mode selection, proxy/getter refusals, pre-aborted signal cleanup, global option placement and deliberate scan-help extension.
- Installed module bytes match the built batch module; installed/built receipts agree after raw-file removal, and unchanged reads/scans preserve private DB/key bytes.

## Offline dependency transport

Container DNS does not resolve the public registry. A temporary read-only workflow fetched **only the already pinned official Commander15 tarball**, and verified its SHA512 against the unchanged lockfile (`z67u4ZhzCL/Tydu1lJARtEZYWbWaN7oYLHbsuzocr6y4N6WZAagG3RQ4FW61V1/0+jImpj293XfrcYnd1qxtPg==`). That exact archive was verified again locally and served on loopback for real npm scripts-disabled installation into isolated prefixes/caches. It was not a substitute implementation or a dependency upgrade. Local public-registry connectivity is not claimed; hosted frozen installation is checked separately. Temporary transport/publisher paths are removed from the final PR tree.

## Limits and handoff

This is explicit bounded in-process batching, not a persisted page cursor or a background watcher. All pre/post census checks and the original final revision gates still apply; a restarted invocation rescans and reuses valid existing source generations, not a saved directory-page cursor. Up to4096 cumulative membership entries and existing all-root catalogue budgets still apply. Per-file16MiB/32768-record/parser limits are unchanged. The expanded outer census does not raise limits on ordinary scan.

The filesystem and SQLite are not one atomic snapshot; stable trusted ancestors are still required. Actual process-kill recovery for this new coordinator, independent-process page race/lock stress, representative real-user accuracy/performance, native macOS, broad P4 acceptance and release are NOT qualified by this change. Tested AbortSignal/SQL rollback and other inherited tests are not substitutes for those claims. No raw logs or secrets were uploaded.

Independent maintainer review, current-main/dependency composition and actual authorized merge remain pending. Keep issue165 and broad#5 open until their own gates pass. The original prerequisite sequence at authoring is PR158 → PR160 → PR163 → this child (earlier membership/CLI integration is owned separately). Root-slot reclamation, exclusive ownership transfer and source-history pruning are not part of this batch feature.
