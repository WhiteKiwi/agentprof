# P4 bounded explicit-root scan CLI

## Reviewed scope

The coordinator approved this bounded slice on 2026-10-01 at 12:04 UTC,
before the separate development session. [SPEC](SPEC.md) defines observable
behavior and [IMPLEMENTATION](IMPLEMENTATION.md) links this plan. The
[P4 Project item](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059)
owns the live claim, contributors, execution checklist and status. Full P4
acceptance remains open. The baseline is merged main
`489cd20637e692b27ed6e590af41b04f0858c27f` (PR #22).

This connects the existing TypeScript CLI to the merged bounded sequential
[scan coordinator](P4-SCAN-RUN.md), using the existing local identity helper,
SQLite bootstrap and schema 3 metric-evidence store. It does not change any
provider interpretation, identity, schema, dependency or scanner limit.
`stats`, `insights`, `report` and `open` remain `NOT_IMPLEMENTED`, exit 2.
Historical P1 foundation-only CLI statements in NORMALIZATION and earlier
evidence describe the original boundary, not this scan activation.

Excluded: default home-log discovery, config files, workers/watch mode,
network/telemetry, full-history guarantees, offset resume, unchanged-file
skipping, cross-source reconciliation, automatic unavailable/deletion marks,
aggregate/token/time computations, report integration and package publication.
P5's `report/**` and `docs/REPORT-PREVIEW.md` reservation is untouched.
No merge or deployment is part of this development handoff.

## Inputs and storage

```sh
agentprof scan --codex-root ./synthetic-codex --data-dir ./private-agentprof
agentprof --json --data-dir ./private-agentprof scan --codex-root ./synthetic-codex --claude-root ./synthetic-claude
```

- Require at least one explicit root. An omitted provider has no selected roots;
  the CLI never scans default-filled `resolvePaths().inputRoots`.
- Existing repeatable global root flags work before and after `scan`. Relative
  paths resolve against cwd. Valid spaces are retained. Empty/whitespace-only,
  NUL/CR/LF and paths beyond the existing 4096-byte scanner ceiling are rejected.
  Every supplied flag occurrence is validated, including an earlier data-dir
  value superseded by a later one. Resolved paths are validated before bootstrap.
- Count all supplied roots before scanner normalization/deduplication: maximum
  16 across both providers. Bare scan and malformed argv fail without private
  directory/key/DB creation or input access. Help/version/pending commands do
  not import SQLite or create local data.
- Keep `SCAN_LIMITS`: 64 sources, 256 directories, 4096 internal discovery nodes
  and separately 4096 yielded entries, 16 MiB/32768 records per source, 256
  diagnostic samples. Existing line/parser/store limits also apply. No flags
  can raise the ceilings.
- Data location remains explicit `--data-dir`, else absolute
  `XDG_DATA_HOME/agentprof`, else `~/.local/share/agentprof`. The existing helpers
  own 0700 directory, 0600 identity file/SQLite, symlink rejection, serialized
  migrations, FK/trusted-schema/extension/journal settings and busy timeout.
- The local HMAC identity key is reused, never rotated or automatically repaired.
  Malformed/unsafe existing keys fail safely and are not overwritten. The
  existing helper may create a missing key even when a DB exists; a key mismatch
  then fails safely at the existing store validation boundary without replacing
  contributions. Preserve original files before any manual recovery.
- Repeated scans intentionally reparse from zero and atomically replace each
  source using its original revision. IDs/contributions do not duplicate, but
  revisions may increase. No stale retry or whole-run transaction is introduced.

## Output and errors

One result goes to stdout, human or JSON:

```text
{schema:"agentprof.cli/v1",ok:<status is completed>,command:"scan",result:<unchanged ScanResult>}
```

A returned `partial` or `aborted` result has `ok:false`; earlier source commits
remain retained. Human output derives from the same result: status,
discovered/attempted/committed/rejected/stale/failed/aborted/duplicate counts,
stop reason/discovery truncation, observed/adapter-dropped/sample-dropped
diagnostic counts, safe aliases and fixed source reason/error/diagnostic codes.
It does not print events, raw paths, arbitrary exception text/stacks, logs or
secrets. Both readiness flags stay false; stored source counts are not verified
final session/token/time totals.

| Outcome | Stream | Exit |
| --- | --- | --- |
| Returned completed scan | stdout result | 0 |
| Returned partial scan, including storage failure | stdout result | 1 |
| Cooperative SIGINT / returned aborted scan | stdout result | 130 |
| Pre-result argument, bootstrap or store error | stderr existing safe error envelope | 2 |
| Pending commands | stderr `NOT_IMPLEMENTED` | 2 |

Known `SafeError` codes survive; Commander parsing failures become
`INVALID_ARGUMENT`, and unexpected handler failures become `INTERNAL_ERROR`.
Fatal JSON retains `{schema,ok:false,error:{code,message}}` with no stdout.
Node may independently emit a version-specific SQLite warning on stderr; the
CLI does not intercept global warnings. Machine scan results live on stdout.

The existing store defers installation-key matching until a source operation.
A mismatched key discovered during scan therefore produces the actual
`partial`/`storage_failure` result and exit 1, rather than manufacturing a
pre-result fatal error. The CLI does not shift this validation boundary.

## Startup and cancellation design

`src/cli/scan.ts` validates arguments without I/O, renders results and owns
startup. SQLite and source-store imports are lazy. `runScan` installs one
SIGINT listener synchronously before asynchronous bootstrap and removes that
exact listener in `finally`. Multiple SIGINTs abort the same controller;
there is no forced `process.exit` and unrelated listeners are retained.

`collectScan` checks the signal before imports/effects and between identity,
database and store startup stages. Once opened, the database is closed in
`finally`, including cancellation or exceptions. The same signal is passed to
`scanSources`; its actual returned object is used unchanged. Committed sources
are never relabeled after interruption.

Before `scanSources` starts, cancellation returns a literal checked by the
`ScanResult` return type, without a loose cast:

- status/stopReason `aborted`, discoveryTruncated false
- no sources or diagnostic samples
- every count and diagnostic drop/observed count zero
- aggregationReady false, parserResumeReady false

This means no discovery/ingestion ran. Private bootstrap files created before
cancellation may remain. Cancellation is cooperative: no instant interruption
of synchronous SQLite or an awaited filesystem operation is promised.
SIGTERM/SIGKILL retain OS behavior; no crash-wide output/rollback guarantee.

## Implementation order and Verify

1. Reconcile SPEC/implementation contract and record/read back the narrow P4
   claim before code. Verify current main/open PRs/P4 release and P5 reservation;
   preserve imported full-P4 acceptance and In Progress status.
2. Wire explicit validation, lazy bootstrap and truthful output. Verify zero,
   one and two providers, both flag positions, relative/spaced/duplicate/nested
   roots, per-occurrence invalid flags, ceilings and storage-free non-scan paths.
3. Exercise built CLI with synthetic inputs and actual reopened SQLite. Verify
   evidence/capabilities, repeated/append/rewrite generations, malformed/missing/
   ambiguous/compressed/limited input, earlier retained commits and privacy.
4. Verify failure and interruption behavior. Controlled startup/scan tests and a
   real IPC-synchronized SIGINT subprocess must prove pre-effect cancellation,
   DB closure, exact listener removal, earlier commit retention and rescan.
5. Run full repository/artifact checks, local documentation links and diff
   whitespace checks. Parent independently reviews frozen content, publishes a
   draft from the exact manifest and verifies remote hashes/exact-head CI.
   macOS/full-history resource acceptance is not inferred from Linux tests.

## Source inspection evidence

On 2026-10-01 the implementation session re-fetched main at the baseline above;
GitHub's open-PR search returned no entries. Authenticated Project readback
confirmed PR #22's explicit reservation release and P5's continuing exclusive
report paths. Existing `scanSources` preserves independent commits and original
CAS, returns bounded safe outcomes, and exposes no aggregate/resume readiness.
`resolvePaths` computes default roots, so only its dataDir is consumed; explicit
selected roots are constructed separately. Root review additionally requires both resolver provider slots to receive a validated explicit path, so an unrelated malformed omitted-provider environment value cannot affect the selected scan. This is a CLI-only adjustment before implementation; it does not change the path helper or selected roots. Existing identity and database
helpers retain their safety behavior and are unchanged.

The repository's requested local ObsDog integration file is absent in this Linux
workspace and no corresponding plugin is available. No guessed service,
credentials, user logs or invented memory evidence were used.

## Verification evidence (2026-10-01)

The actual local results are recorded below. Coordinator source review approved
the implementation and resolver correction; final manifest approval and remote
publication/CI remain pending. All input fixtures are synthetic. No actual user
logs were accessed.

- PASS: Linux x64, Node 24.19.0, `npm run check` with a writable temporary
  npm cache: typecheck, build, 384 tests across 18 files, and 32-file artifact.
  Installation scripts are disabled. Existing isolated tarball npm-exec/global
  install help/version checks pass; a new isolated packed installation performs
  a real synthetic scan and creates its expected private database.
- PASS: 36 new CLI-scan tests exercise strict arguments/combined root ceilings,
  repeated data-dir validation, explicit/omitted providers, malformed unrelated
  provider config, relative/spaced paths, both flag positions, XDG data selection,
  empty inputs, nested/deduplicated roots and 64-source discovery truncation.
- PASS: actual two-provider CLI execution and reopened SQLite preserve source
  metric evidence/capabilities; repeated/append/stable-path replacement preserve
  identities and original revisions without duplicate contributions. A malformed
  source and file-size rejection retain prior generations; good source commits
  survive other rejected sources. A long supported metadata stream encounters
  the tighter existing adapter state ceiling before the record ceiling, and
  reports `state_limit` honestly. The inherited scanner tests verify its record
  budget independently; no CLI-level `record_limit` observation is claimed.
- PASS: human/JSON counts agree; incomplete results and fatal errors have their
  specified streams/exit codes. Corrupt/future/unsafe key and DB fixtures retain
  original files and safe codes. Key mismatch returns actual storage failure
  with unchanged database bytes. Raw path/log/key/exception sentinels are absent
  from application output and normalized stored payloads.
- PASS: controlled cancellation before all bootstrap effects, after key startup
  and after DB open; exact owned listener removal, unrelated-listener retention,
  repeated in-process calls, repeated interrupts, unknown/safe handler errors,
  actual scan-result identity and DB closure after abort/throw.
- PASS: a real subprocess pauses on its second source open through an explicit
  IPC barrier, after the first source has committed. Two real SIGINT deliveries
  produce one aborted JSON result and exit 130, with one committed source and one
  aborted source. Reopened storage preserves the commit; a subsequent normal
  scan succeeds. The watchdog is only a deadlock failure guard, not readiness
  evidence or a sleep-based synchronization mechanism.
- PASS: 56 local links/anchors in the three changed documentation files and
  `git diff --check`. Final main/open-PR recheck shows no baseline/PR overlap.
- Environment note: the first offline dependency attempt lacked a cached package;
  script-disabled installation with a writable temporary cache succeeded. An
  initial packed-test attempt used an unwritable environment default cache; the
  test now selects its own isolated writable cache. Final gates pass with that
  correction; no package/lockfile/dependency changes were made.
- Pending: independent final frozen-content approval, draft publication, remote
  hashes and exact-head CI. macOS and full-history time/RSS acceptance for this
  CLI slice are NOT RUN. Full P4/P5/P6 and parser/aggregation readiness are not
  completed by these bounded checks.
