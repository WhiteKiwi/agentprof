# P4: Bounded Single-Source Ingestion

## Reviewed scope (2026-10-01)

This slice connects an explicit local JSONL file, an existing provider adapter and the [source event-contribution store](P4-STORAGE.md). It builds on corrected and merged [PR #19](https://github.com/WhiteKiwi/agentprof/pull/19), main `adb8bb6e4b0dfeb94f417f91fe234bfa6fdcea5d`. The coordinator approved this bounded plan before implementation; an independent contract review checked identity, file observations, failure behavior and readiness limits. The [P4 Project item](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059) owns execution status and file reservations.

The internal API reparses a bounded single source from byte zero and atomically replaces only its recognized event contributions and completed-line observation metadata. It adds no CLI, source discovery, durable parser restore, cross-source canonical selection or report integration. Provider semantics and existing identity generation stay unchanged.

Successful ingestion means the observed completed-prefix events were replaced atomically. It does not establish complete source coverage. Both the returned result and reopened store remain `aggregationReady: false` and `parserResumeReady: false`; the result explicitly identifies `persistedScope: "events_only"`. Actual adapter capabilities and safe diagnostics are returned transiently, without promoting `recognized_shapes` to complete coverage. Reopened event rows cannot reconstruct capabilities, diagnostics, provenance, turns, usage or pending parser state. Those are later P4 gates.

## Input identity and observed consistency

The source's local `fileIdentity` is its resolved absolute path. The header's keyed ID is `context.fingerprint("source", [provider, fileIdentity])`, matching the existing adapter derivation. A same-path rewrite or truncation keeps this identity. Device and inode identify the observed file generation; they do not become its durable source key. Move/archive identity and cross-source relationships remain unresolved.

Read-only open uses no-follow and nonblocking flags, verifies a regular file and keeps one file descriptor for parsing and boundary verification. Nonblocking open avoids a regular-file-to-FIFO race hanging before `fstat`. Observe bigint device, inode, size, modification time and change time at opening and after parsing. Verify the final path still names the same regular file without symbolic-link components. Reject unsafe or changed observations, including an append during a call, rather than writing a mixed generation. An append between successful calls is reparsed normally.

These checks establish observed stability at the verification points. They are not an atomic filesystem snapshot, a lock on external writers, or proof against undetected change-and-restore races. Inputs may change after the last observation. This limit must remain explicit in the API documentation and tests.

The existing `readJsonLines` API keeps its opening-size behavior, including deferring concurrent append data to a later call. A shared same-descriptor decoder primitive avoids opening the input a second time. Strict change rejection belongs to the new ingestion path.

## Completed-line boundary

Only records terminated by LF enter the adapter. CR, BOM and multibyte UTF-8 contribute their physical byte lengths. An unfinished JSON/UTF-8 tail stays outside `completedOffset`.

At offset zero, `boundaryFingerprint` is null. Otherwise, read the last `min(4096, completedOffset)` raw bytes ending exactly at `completedOffset`, including its final LF and excluding any unfinished tail. The fingerprint is `context.fingerprint("content", ["source_boundary_v1", completedOffset, bytes.toString("base64")])`. The byte window and versioned prefix are part of the contract. Only the keyed value leaves the raw-input boundary; neither boundary bytes nor a plain digest are persisted or returned.

This is a bounded boundary observation, not a whole-file content checksum or a durable parser resume token. Restart always begins at byte zero.

## Atomic replacement and failure behavior

Use one fresh provider adapter per call and only its final `snapshot().events`. Ingest batches are updates and must not be concatenated into the final contribution set. Production inputs cannot supply `trustedFixtureContext` or inject fixture evidence.

Every reader diagnostic rejects this strict ingestion attempt. Ordinary adapter diagnostics may accompany successful event storage while their original partial/unknown capabilities remain in the returned result. Reject `capabilities.stateLimited` or nonzero `diagnosticsDropped` directly; the corresponding diagnostic may itself have been dropped.

Retain the caller's original expected revision throughout parsing and pass it unchanged to one synchronous `replaceSource` call. Do not refresh it, retry stale writes automatically or mark sources unavailable after a read error. No source header, event, revision, checkpoint or first-write key binding changes on rejected input, a stale write, observed cancellation or SQL rollback.

Complete stream and descriptor cleanup before the CAS write. Check cancellation during reading, after awaited verification/cleanup and immediately before committing; pass the signal to the store for its in-transaction checks. Once a write commits, its result cannot be relabeled failed or aborted by later cleanup or cancellation.

The result contains only safe keyed identities, fixed status/reason values, counts, capabilities and safe diagnostics. Local paths, raw records, boundary buffers, stat objects and caught exception text never enter shared results or SQLite.

## Bounds and implementation order

1. Extract a shared same-descriptor JSONL decoder without changing the existing reader contract, then add bounded prefix observation and cleanup.
   **Verify:** existing scanner oracle tests stay unchanged; physical offsets, tail deferral, LF boundary, open-time size and resource closure remain exact. Deterministic append/truncate/rewrite/replace/unlink/symlink cases reject strict ingestion; nonregular inputs never block.
2. Connect each existing provider adapter to the prefix reader and source store with an unchanged optimistic revision and explicit event-only readiness limits.
   **Verify:** all ten existing JSONL fixtures match independent adapter events and reopened stored events; pending-to-terminal append and same-path replacement work; adapter partial coverage is returned unchanged; state limits, stale writes, cancellation and SQL failures preserve the previous generation.
3. Exercise bounds, privacy and failure paths, then obtain independent code review and full repository checks.
   **Verify:** invalid JSON/UTF-8, oversized lines/files/record counts, diagnostic overflow and non-event state limits cannot cause partial replacement; raw sentinels never appear in results/errors/rows; no fixture evidence is accepted. Typecheck, build, tests and artifact verification are reported separately, with exact-head CI after publication.

The initial per-call ceiling is 64 MiB of observed file bytes and 32,768 complete records; callers may lower these limits. Existing 1 MiB line, 64 KiB read chunk and provider/store state limits remain in force. Oversize inputs reject safely. These are bounded integration limits, not a process-RSS or full-history performance guarantee. Large-history streaming persistence and the previously proposed 1 GiB product acceptance remain separate work.

## Execution evidence

The first implementation check on 2026-10-01 used Node 24.19.0, Linux x64 and built-in SQLite, on merged base `adb8bb6e4b0dfeb94f417f91fe234bfa6fdcea5d`. Inputs were existing synthetic fixtures and synthetic temporary files; no user logs were read.

- PASS: `npm run check`, including typecheck, build, 288 tests in 15 files and the 29-file production artifact. Script-disabled isolated npm exec and global-prefix installation both passed help/version checks. These are local results; publication must verify its exact remote head in CI.
- PASS: all ten existing Codex/Claude JSONL files matched a separate full-prefix adapter invocation field for field, including capabilities and safe diagnostics. Event contributions, physical boundaries and keyed fingerprints remained equal after database close/reopen. Existing independent provider semantic oracles also passed unchanged.
- PASS: empty/unfinished prefixes, BOM/CRLF/multibyte offsets, the 4,096-byte boundary window and a pending-to-terminal append. Same-path replacement and truncation retained the source key and removed obsolete contributions. Repeated complete parsing produced the same event values.
- PASS: deterministic append, truncation, same-size rewrite, replacement, unlink, final symlink and ancestor-symlink changes rejected. Malformed JSON, invalid UTF-8, line/file/record bounds, missing/nonregular inputs and a FIFO rejected safely. Source headers, events, boundaries, revisions and first-write key binding were preserved on rejected ingestion.
- PASS: real non-event parser-state exhaustion and diagnostic overflow rejected through capability flags, including the case where the limit diagnostic itself was dropped. Ordinary adapter partial/unsupported observations retained their original capabilities without being promoted to complete coverage.
- PASS: cancellation before reading, during both provider adapters, after awaited descriptor cleanup and inside the SQLite transaction. A second real database connection winning during parsing produced `stale` with the original expectation retained; SQL failure rolled back new and existing source generations. Cancellation after a successful commit did not relabel success.
- PASS: owned file descriptors were confirmed closed by real `FileHandle.stat()` failures with `EBADF` after successful, stopped, failed, limited and cancelled reads. The shared decoder kept its caller-owned descriptor open after early return and complete iteration, allowing a subsequent boundary read. Fixed-size positioned reads replaced a stream that would otherwise close the descriptor when destroyed.
- PASS: raw sentinel/path/digest/buffer exclusion, safe diagnostics and rejection of fixture evidence, unknown fields and accessors. The 55 new prefix/ingestion tests and one new shared-decoder ownership regression supplement the 232 baseline tests.

PASS: an independent final static code review found no blocking defect in the shared decoder, observed-file checks, privacy boundary, original-revision CAS, cleanup/cancellation ordering or tests. The reviewer inspected the recorded check result and did not rerun the suite.

Product scan/CLI, large-history resource acceptance, durable parser resume and aggregation are NOT RUN and are not completed by this bounded API. This slice has not been tested locally on macOS or on every supported Node version.
