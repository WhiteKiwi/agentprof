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

## Execution record

Plan recorded before code. No new test PASS claimed yet. Recursive directory manifests, richer ordinary error/content/change/validation-scope evidence, latest-main composition, real-user/macOS/browser/performance and release acceptance remain outside this explicit-file slice.
