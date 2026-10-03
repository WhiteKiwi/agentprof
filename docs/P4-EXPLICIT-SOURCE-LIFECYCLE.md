# Explicit source lifecycle reconciliation

## Specification — 2026-10-04 KST

Add opt-in `scan --reconcile` for explicitly enumerated ordinary `.jsonl` file paths. It collects files that are present and marks a previously stored path unavailable only after confirming that the leaf is absent under the same readable, ordinary parent directory. Existing scan behavior without this flag is unchanged.

```sh
agentprof scan --reconcile --codex-root ./old.jsonl --codex-root ./archive/moved.jsonl --data-dir ./private-agentprof --json
agentprof scan --reconcile --usage-timing --claude-root ./known-session.jsonl --data-dir ./private-agentprof
```

An unavailable source retains events, usage, turns, diagnostics and relationships. The existing transactional `markUnavailable` increments its revision and removes obsolete cache/checkpoint material. Rechecking an already unavailable source is a read-only no-op. A restored file is reparsed through the existing scanner, becoming available again. A moved file is ingested at its explicitly supplied new path; the old path's data is retained, not heuristically merged or deleted. Successful live source IDs are returned separately for an explicit subsequent history query. Historic unavailable copies are not silently removed from existing history requests.

All root arrays, types, counts, duplicates, provider/path ambiguities and path extensions are checked before filesystem or private-store access. At most 16 distinct input files; directory roots are intentionally rejected in this mode. The store only retains path-derived identities and has no persistent directory-membership manifest: a directory scan cannot safely infer which absent historical hashes belong to that directory. Automatic recursive directory reconciliation is a separate extension, not claimed by this feature.

A missing parent directory, unreadable parent, symlink parent/leaf, nonregular leaf or permission error is never proof of deletion. Preflight errors fail before bootstrap. For an initially absent leaf, read and authenticate the old stored generation, recheck the same parent and missing leaf, then use its original revision as the CAS expectation. Reappearance, parent substitution, newer stored generation or a post-preflight access error leaves the old generation untouched and produces a partial receipt. No force repair or fallback. Filesystem observations and SQLite are not a cross-resource atomic transaction; stable trusted ancestors and no hostile concurrent tree replacement remain required.

Each successful source commit is independent. Collection failure/abort/storage failure preserves earlier commits; abort prevents further retirement. The CLI exposes live scan and lifecycle outcomes separately, never claims that all retained history is current, and never emits input paths, contents or arbitrary exception strings. Existing parser capture modes, status semantics, native admission, history aggregation and output privacy remain unchanged. No user logs, automatic browser, external API, release or merge.

## Findings and implementation plan

Pinned parent PR142 head `631d424dd287df3e287334f92451eef8d8266b19` has versioned usage capture and a passing Foundation run37135015173. `source-store.ts` already provides authenticated ingestion reads, CAS `markUnavailable`, contribution retention, cache/checkpoint invalidation and restoration through `replaceEncoded`. `scan-run.ts` derives a source identity from exact provider and resolved path, but discovery does not reconcile missing paths. Reuse those contracts rather than changing the schema or inventing path ownership from HMAC values.

1. Add strict file selection and path-state proof helpers. **Verify:** present/absent leaf, directory/compression/symlink/missing ancestor/permission failures, dense bounded arrays, duplicates and conflicting providers; invalid input before bootstrap.
2. Add bounded lifecycle orchestration and opt-in scan dispatch. **Verify:** real initial scan, deletion with retained evidence and invalidated cache/checkpoint, idempotent repeat, restoration and append, explicit move and live source selection, wrong key/corrupt checkpoint refusal, actual CAS conflict, reappearance/parent change/access error, abort and safe receipt.
3. Add built/installed regression and qualify the posted head. **Verify:** default scan parity, `--usage-timing` composition, flags before/after command, duplicate/global/unknown/extra rejection, scripts-disabled actual package installation, full supported-runtime typecheck/build/tests/artifact; retain failures/skips and NOT RUN limits.
4. Publish Draft and hand off. **Verify:** exact scoped diff and head checks, parent-first integration, leave independent review/merge and broad #5/#6 open.

## Ownership and boundaries

This ChatGPT continuation owns only the new lifecycle modules, new tests, this plan and scan-only option/action integration in `src/cli/main.ts` on `feat/explicit-source-lifecycle`. No actual runtime UUID or separate development/review subagent is exposed; none is invented. Independent maintainer review remains required. Preserve #5/#7 broad owners, #50 exploration, #136 display coordination, PR139 unified report, existing parser/store/history implementations, shared documentation, CI and dependencies. New work is stacked on PR142; no other branch is modified.

## Initial execution record

Plan commit `eed730bfcd6e17557f30a795ec42b3e324b8ffd5` preceded code and issue144 claim/readback. No new test PASS was asserted at plan creation. Recursive directory manifests, richer ordinary error/content/change/validation-scope evidence, latest-main composition, real-user/macOS/browser/performance and release acceptance remain outside this explicit-file slice.

## Executed qualification — 2026-10-04 KST

Published [Draft PR145](https://github.com/WhiteKiwi/agentprof/pull/145), owning [issue144](https://github.com/WhiteKiwi/agentprof/issues/144). Qualified code/test head: `0f45f24dee76a0eab003fe573f0ea9927caea744`, fixed parent PR142 `631d424dd287df3e287334f92451eef8d8266b19`.

[Foundation run37136914838](https://github.com/WhiteKiwi/agentprof/actions/runs/37136914838) was read back with **all four jobs completed/success**: Node24.15 job111243250797, Node24.21 job111243250826, Node26.7 job111243250814, unsupported-runtime guard111243250860. These checks qualify the fixed stack, not current-main/all-PR composition.

Directly read the complete Node26.7 job111243250814 log. Its checkout is GitHub's synthetic test-merge `a292bb3a37aa8dd100d8e211eda45ef9b28d697f`, merging qualified source0f45f24 into fixed parent631d424. This is not an actual PR merge. Environment: Linux x64/Ubuntu24.04.5, Node26.7.0, pnpm10.34.6.

| Check | Observed result |
| --- | --- |
| Production strict typecheck and build | PASS; compiler settings unchanged |
| Complete suite | **2,987 PASS /0 FAIL /68 inherited conditional SKIP**;119 files,117 PASS/2 SKIP |
| New lifecycle tests | **52 PASS /0 new skips**: source-lifecycle42 + source-lifecycle-cli10 |
| Ordinary Codex and Claude | Actual scan, unlink, retained events/metric/relationship equality, invalidated checkpoint/cache, unchanged-byte repeated absence, restored revision and append PASS |
| Explicit archive move | Actual rename followed by old/new path reconciliation; only new live ID selected; canonical event identity and one-completion history control PASS |
| Post-preflight change controls | Actual file recreation and parent rename/replacement preserve old availability; injected access failure preserves state |
| Generation/CAS controls | Real intervening sequential DB commit and final revision-guarded write both preserve the newer revision; no second retirement |
| Corrupt checkpoints and wrong key | Both provider checkpoint corruption controls refuse retirement without repairing/removing evidence; changed key refuses/reset-free; private bytes retained |
| Abort/storage failure | Internal AbortSignal and controlled collector failure stop retirement, retain previous generations and restore owned listeners |
| Legacy CLI path | Default scan human/JSON bytes match original runScan for both providers; existing stats/history behavior retained |
| Selection and bounds | Repeated/mixed/unknown/extra flags, sparse/accessor arrays, symlinks/directories/missing parent refused; actual16-file CLI passes,17th input rejected without mutation; tested receipt below128KiB |
| Dedicated installed package | Actual npm pack and isolated global install with lifecycle scripts disabled, execution outside repository; both providers with usage-timing collect/reuse/delete/repeat/restore, exact built/installed receipt/status/stderr parity and private-byte checks; raw-deleted existing history parity PASS |
| Existing artifact verifier | **92 files PASS**, scripts-disabled tarball npm-exec/global install and existing read-only stats/insights/failures qualification; published:false |

The inherited usage-timing capture46, usage-history analysis33, usage-history CLI20 and installed1 tests also execute in this stack. They are not newly authored lifecycle tests and are already counted in the full-suite total. New tests52 are likewise part of2,987, not additional to it. The inherited68 skips remain conditional historical/installed scenarios; no new test was silently skipped.

### Initial failure and correction history

- Initial source `2814866c917925c4c96b61e540cd981ced4363cf`, [run37136592007](https://github.com/WhiteKiwi/agentprof/actions/runs/37136592007): production typecheck/build passed. Directly read Node24.15 job111242261116: **2,985 PASS /1 FAIL /68 inherited SKIP**. New lifecycle51 cases had50 PASS and1 failure.
- The failure occurred before product reconciliation, while the new test tried to set checkpoint_json='{}' without changing checkpoint_bytes. Existing SQL correctly rejected the setup with its payload-length CHECK. After reading database.ts, commit `68e813117c9fbddba356bad5c6136df02f0c03e3` changes the synthetic JSON and its byte length together while retaining the old generation seal, so authenticated ingestion must reject actual tampering. The same test now also runs for Claude; no SQL CHECK, compiler option or product validation was disabled. Assertions retain exact private bytes and available state after rejection.
- Commit `0f45f24dee76a0eab003fe573f0ea9927caea744` restores the original main.ts terminal newline. An accidentally shortened unrelated insights help string was already restored before qualification. Final inspected main.ts patch is scan-only; no existing validator/run/formatter semantics were changed.
- All52 new tests and the complete suite subsequently passed on0f45f24. The first failure and corrections remain in [PR145 Conversation](https://github.com/WhiteKiwi/agentprof/pull/145#issuecomment-5971077257).

### Scope review and handoff

The actual PR file list has seven paths: this document, main.ts's scan registration, three new lifecycle modules and two new test files. Existing scanner/parser/store/checkpoint/schema/history/report implementations, old tests, dependencies, CI and other branches are unchanged. Later-discovered [integration coordinator143](https://github.com/WhiteKiwi/agentprof/issues/143) retains its separate oldest-first evidence/report work; this slice neither takes over that ticket nor modifies its branches.

This execution-record update is documentation-only after qualified code0f45f24. The resulting final head's own CI is checked separately and recorded in PR145/issue144 after observation, rather than inferred from source-head PASS. Release only this ticket's implementation reservations at handoff; retain independent maintainer review and parent-first latest-main integration/full regression/merge as open gates. Do not close broad5/6 or publish a package.

### Explicit limitations / NOT RUN

Only explicitly supplied file leaves are reconciled. Automatic directory membership, missing-root/offline-volume retirement, implicit archive move resolution and a global latest-history selector are not implemented. Missing/read-failed parents remain errors, not deletion evidence.

Access-error handling uses an injected SafeError control; no full real POSIX permission matrix is claimed. Generation races use actual sequential writes with deterministic interception, not independent-process concurrent writers. Abort tests use internal AbortSignal controls, not an end-to-end SIGINT test of this new workflow. Filesystem and SQLite updates remain distinct resources; no hostile-rename race-proof guarantee.

All runtime evidence above is from GitHub Actions, not a local supported-runtime run or independent reviewer. No actual user logs, external LLM calls, browser/macOS/empirical usefulness/performance or release acceptance were exercised by this slice. A test runtime or bounded synthetic receipt is not a representative product benchmark. PR142's daily token work and PR139's unified report remain their own reviewed scopes; richer ordinary provider error/content/change/validation-scope capture and broader integration remain unfinished development.
