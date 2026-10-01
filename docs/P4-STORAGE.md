# P4: Atomic Source Event Contributions

## Reviewed scope (2026-10-01)

This is the first bounded persistence slice of [P4](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059), reviewed by the coordinator before implementation. It advances the existing [SPEC](SPEC.md) and [normalization/privacy contract](NORMALIZATION.md) without exposing a partially working scan command. P2 and P3 adapters are merged; their in-memory inspection APIs are not durable restore APIs.

Schema version 2 introduced one installation key binding, source headers and normalized event contributions. A source header and its entire event set are replaced in one synchronous transaction. Existing schema-1 settings are preserved. A database schema version is separate from normalization, key and parser versions.

The [metric evidence extension](P4-METRIC-STORAGE.md) introduced schema 3 and added atomic turns, usage, source observations, capabilities and diagnostics. `replaceSourceSnapshot` writes both sets together. `replaceSource` remains event-only and clears prior evidence under the same revision; `readSource` exposes `evidence: null` for absent historical evidence and a bounded evidence object when present. Both readiness flags remain false. The initial version-2 evidence below is historical; the extension document owns its new contract and verification.

## Current schema and reuse contract (2026-10-01)

[Unchanged-source reuse](P4-UNCHANGED-SCAN.md) advances the writable store to schema 4, preserving schema-3 generations and settings. Optional whole-byte keyed `cacheEvidence` belongs to the same revision as the header/events/metric evidence. Full replacement without proof and event-only replacement clear it; `markUnavailable` clears it while preserving historical contributions. Missing proof is a cache miss; present invalid proof is a safe storage failure. A successful `confirmUnchangedSource` validates the entire generation in a fresh owned synchronous read transaction and leaves all data/revisions unchanged. Unlike general `readSource`, it rejects a caller-owned transaction untouched. The original event-storage verification below remains historical.

## Source and privacy contract

The caller supplies a complete event contribution set for exactly one source prefix, produced by a separate single-source adapter instance. Every event's keyed source reference must equal the header source ID. Multiple-source adapter snapshots have already selected canonical values; splitting them by sourceRef cannot recover original contributions and is unsupported.

Different sources may hold the same canonical event ID. The store keeps both contributions and chooses no winner, sums no metrics and does not claim to resolve archive/fork provenance. Duplicate event IDs within one submitted source are rejected. Readback explicitly reports that it is neither aggregation-ready nor parser-resume-ready. The extension stores metric evidence; complete provenance graphs, cross-source interpretation and durable parser state remain later P4 work.

Inputs are read through own data properties and validated into fresh allowlist objects before serialization. Unknown fields, getters, custom prototypes and `toJSON` are rejected without execution. All identity domains and key IDs, provider/version fields, finite numeric values, UTC timestamps, lookup ranges and source offsets are checked. Tool names and command patterns use closed safe vocabularies matching normalization version 1; arbitrary strings in those fields are not accepted. Existing normalized identities are never regenerated. No paths, raw records, prompts, command arguments, outputs or secrets are stored.

The installation key ID is non-secret and binds the store on its first successful write. A different key ID cannot mix contributions into that database. The secret key remains outside SQLite.

## Atomicity, revisions and lifecycle

- Migration reads and validates the current schema version after acquiring `BEGIN IMMEDIATE`. Concurrent first opens/upgrades serialize: a connection whose peer already completed the target version observes it under the lock and does not repeat DDL. Unsupported/future versions keep their existing safe error codes; failed migrations preserve the prior schema and settings.
- A new source uses `expectedRevision: null`; an existing source requires its positive current revision. Compare-and-swap runs inside `BEGIN IMMEDIATE`, before any mutation. A stale writer receives a distinct safe result and makes no change.
- Each successful replacement increments the source revision, even for equal content. Revisions are never reused. An empty replacement clears that source's events atomically. Revision overflow is rejected.
- Marking a source unavailable retains the header, checkpoint and event history while incrementing its revision. A later successful full replacement makes it available again. The API does not automatically delete missing input history or remove source headers.
- SQL failures roll back source identity binding, event rows, header/checkpoint and revision together. No caller-owned transaction is committed or rolled back after a nested BEGIN rejection.
- An optional AbortSignal is checked before work, within the write loop and before commit. A detected pre-commit abort rolls back. Synchronous SQLite work cannot promise immediate delivery of asynchronous abort notifications; after commit the write is successful.
- Readback obtains the header, events and any metric evidence from one pinned SQLite transaction snapshot, so another connection cannot mix generations between queries. Actual count/byte preflight runs before payload selection and ordered iterators check again while reading. Cursors close on every outcome; the store ends only a read transaction it owns. The [extension contract](P4-METRIC-STORAGE.md) specifies limits that also protect against SQLite sorting before the first payload row reaches JavaScript.

## Completed-line observation boundary

The header contains `completedOffset`, `observedSize`, parser version and a keyed `boundaryFingerprint`. Integers must be safe and nonnegative; completedOffset must not exceed observedSize; each event's source offset must be below completedOffset. Offset zero has no boundary fingerprint; a positive offset requires a content-domain keyed fingerprint.

These are caller-verified observations committed with the event contributions. SQLite cannot establish that an offset follows LF, that the digest matches source bytes, that a file was unchanged while read, or that an adapter processed all records. The reader/integration must verify those facts. A saved offset alone does not restore pending calls, deferred results, poll links, usage ordering or provenance. Until the later durable-state contract exists, restart parsing begins at offset zero. No seek-from-checkpoint or scan CLI API is added here.

## Bounds and verification plan

One replacement/readback is limited to 4,096 events, 64 KiB of serialized data per event and 16 MiB total event bytes. These bounds reject oversized inputs before writes and cap readback; they are not a process RSS or full-scan performance guarantee. Inputs limited by a provider adapter must not be presented as complete source coverage.

Verify new 0→2, existing 1→2, idempotent 2→2 and failed/future/corrupt migrations; controlled two-connection first-open/upgrade interleavings before lock acquisition; migration atomicity/settings preservation; two-connection stale revisions; pending/terminal and empty replacement; source unavailability; failure/cancellation rollback; exact reopened P2/P3 fixture event values; duplicate canonical IDs across sources; and inert, raw-free validation. Run full repository checks and independent contract/code review. Product scan/incremental recovery and large-history acceptance remain NOT RUN.

## Initial implementation evidence

Base: `9f85567a0810a9300daf1b0d26f4b81ce299cbf5`. The initial developer verification on 2026-10-01 used Node 24.19.0, Linux x64 and built-in SQLite. The results below describe the original implementation before the coordinator correction. No user logs were read.

- PASS: TypeScript check, build and 227 tests in 13 files, including 14 source-store tests and all existing P2/P3/HMAC/privacy oracles. Command: `npm run check` with a writable local npm cache; its artifact stage is separately qualified below.
- PASS: new/existing/idempotent migrations, settings preservation and DDL rollback; two-connection stale-write rejection; pending→terminal replacement; empty/truncated-source replacement; retained unavailable-source history; first-write key binding rollback; mid-write SQL failure and detected cancellation; caller-owned transaction protection; limits, raw-field/accessor/toJSON rejection and corrupted readback.
- PASS: all ten existing Codex/Claude JSONL fixtures were parsed separately by their actual adapters, stored and reopened. Each event field and completed-line boundary matched its source input, with more than twenty events exercised. Existing independent provider oracle tests also passed unchanged.
- PASS: independent static review. Its two findings were fixed: iterator-based readback stops at the total-byte/count bound and always closes its cursor; same-scope duration/interval conflicts greater than 1 ms reject the whole replacement. Regression tests cover another writer progressing after failed readback, atomic rejection, distinct scopes and the 1 ms tolerance.
- Earlier pre-review code passed the complete repository check, including the 27-file packed artifact, isolated npm exec/global install and help/version. After the final two corrections, the fresh-cache artifact install was BLOCKED by HTTP 403 from the npm registry while fetching Commander. The final typecheck/build/227 tests passed, but the final complete `npm run check` did not pass locally. No network workaround was attempted. CI must verify the exact published head, including this artifact step.

The interrupted executor's last focused-test process could not be recovered, so its missing result is not counted. The recorded initial tests above were run after recovery. The initial developer results cover Linux only; supported macOS coordinator results follow below. No full-scan performance or incremental-resume acceptance is claimed. Product scan, durable parser recovery and aggregation remain NOT RUN.

## Migration review correction evidence (2026-10-01)

The correction was verified with actual Node 24.15.0 on macOS arm64 and built-in SQLite. Inputs were synthetic. The pre-correction implementation was published head `4573684b3d928cec90a3d8179a7f3cf9be05057a`.

- BEFORE: `node node_modules/vitest/vitest.mjs run tests/source-store.test.ts -t peer-completed` failed both new controlled 0→2 and 1→2 cases with `DATABASE_MIGRATION_FAILED`. Each case first confirmed that both real connections retained valid schema 2, migration records, settings and unrelated data. Only the first connection's instance `exec` was interposed to finish its peer's real migration immediately before the actual `BEGIN IMMEDIATE`; SQLite version, data and DDL results were not mocked.
- AFTER: the same two cases passed in `node node_modules/vitest/vitest.mjs run tests/source-store.test.ts tests/database.test.ts --reporter verbose`: 23 tests passed in two files, including 19 source-store tests. Explicit Node 24.15.0 typecheck (`node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`) and build (`node scripts/build.mjs`) also passed.
- PASS: future schema 99 retains `DATABASE_SCHEMA_TOO_NEW`; unsupported settings, schema -1 and failed DDL retain `DATABASE_MIGRATION_FAILED`, preserve prior state and leave no migration transaction active. Corrupt-file opening retains `DATABASE_ACCESS_FAILED`. Nested migrations at versions 0, 1 and 2 reject safely, preserve the caller's schema/work and allow the caller to commit its original row. The generic `transaction()` helper is unchanged.

Schema-2 no-op migrations now acquire the same immediate lock before inspecting the version. They can therefore wait for a writer or fail safely when the lock cannot be acquired, including inside a caller-owned transaction. The deterministic cases verify the specified pre-lock interleaving, not arbitrary scheduling or lock-timeout performance. This developer evidence covers the targeted correction; full supported-runtime, artifact and corrected-head CI verification remain the coordinator's publication gate.

## Coordinator verification (2026-10-01)

The coordinator reviewed all seven PR files and the migration correction. The corrected source/test commit is `23d2310` on base `9f85567a0810a9300daf1b0d26f4b81ce299cbf5`; only documentation evidence changed after this local verification.

- PASS: macOS arm64, Node 24.15.0, 24.21.0 and 26.7.0 each completed `npm run check`: TypeScript, build, 232 tests in 13 files (19 source-store tests) and the 27-file packed artifact. Artifact validation includes isolated npm exec/global-prefix install, help/version and fixture exclusion, with install scripts disabled.
- PASS: Node 22.16.0 rejects the built CLI before importing unsupported SQLite APIs, with `UNSUPPORTED_RUNTIME` and exit 2. Local documentation validation checked 28 Markdown documents, 213 local links and 23 anchors without failures.
- The original published head `4573684` passed the Linux CI matrix with 227 tests, including the artifact stage. The initial fresh-cache HTTP 403 is historical; the corrected macOS artifact checks above passed. Merge requires successful Linux CI for the final corrected published head. Exact head, run URLs and merge evidence are recorded in [PR #19](https://github.com/WhiteKiwi/agentprof/pull/19) and the [P4 Project item](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059).

This verifies only the bounded source event-contribution store. The full P4 ticket stays In Progress: durable parser state, diagnostics/provenance/usage/turn storage, cross-source integration, discovery/rewrite handling, incremental resume, scan CLI and full-scan resource acceptance remain incomplete.
