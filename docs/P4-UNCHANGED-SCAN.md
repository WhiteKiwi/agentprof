# P4: reuse unchanged source snapshots

Status: independently planned and coordinator-reviewed for implementation on 2026-10-01. The coordinator approved the exact HMAC framing, schema-4 lifecycle, exact-current-schema read-only policy, additive unchanged outcome and conservative full validation before this separate development session. Implementation and synthetic local verification are complete as recorded below; final frozen-file review, draft publication and exact-head hosted CI remain pending at developer handoff.

## Baseline and scope

Fresh inspection on 2026-10-01 confirmed PR #26 merged at `1dcd70089d640f5137b382eaf83b0b2ecc49b41d`; repository search returned no open PRs. Eight relevant local scanner/storage/identity files matched that commit's Git blobs; `src/scanner/source-prefix.ts` was separately fetched from main. Project 2 shows the formatter slice Done, P4/P5 In Progress, and P4's prior CLI reservation released. Recheck base and claims before implementation.

Sources:
- https://github.com/WhiteKiwi/agentprof/pull/26
- https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059
- Repository contracts: P4-STORAGE, P4-METRIC-STORAGE, P4-INGESTION, P4-SCAN-RUN, P4-SCAN-CLI, P5-READONLY-STATS, NORMALIZATION and IDENTITY-PERFORMANCE.

Goal: when all bounded observed source bytes and their interpretation contract are unchanged, avoid source JSON decoding, adapter ingestion/normalization and source replacement writes. This is unchanged-result reuse, not parser offset resume. Changed sources still reparse from zero.

Keep current bounds: scan 64 files, 16 MiB/source, 32,768 records, 256 retained scan diagnostics; internal single-source ingestion 64 MiB; existing 1 MiB line, 64 KiB chunk, adapter and 32 MiB combined serialized store bounds. No new concurrency, defaults, global reconciliation, archive/move deduplication, missing-source lifecycle, package/dependency/workflow/report changes. Both readiness flags remain false. `report/**` and `docs/REPORT-PREVIEW.md` remain reserved elsewhere.

## Why existing evidence is insufficient

`boundaryFingerprint` covers only the last min(4096, completedOffset) bytes ending at the last completed LF. It excludes earlier complete bytes and the unfinished tail. Size/mtime or this fingerprint cannot establish whole-source equality. Preserve its current meaning and encoding.

`IdentityContext.fingerprint` canonicalizes all arguments and rejects serialized input beyond 2 MiB. Passing 16/64 MiB files as base64 is invalid. Raising that limit or accumulating the whole source would break the bounded design. The new operation below requires explicit contract review; it is not permission to change existing identity algorithms.

## Exact reviewed streaming HMAC contract

Add specialized types to `src/normalize/identity.ts`:

```ts
type SourceFileProofInput = Readonly<{
  sourceId: string;
  provider: "codex" | "claude";
  parserVersion: number;
  maxFileBytes: number;
  maxRecords: number;
  maxLineBytes: number;
  observedSize: number;
}>;
type SourceFileProofWriter = Readonly<{
  update(bytes: Uint8Array): void;
  finish(): string;
  discard(): void;
}>;
// Additional method on IdentityContext; existing fingerprint is untouched.
startSourceFileProof(input: SourceFileProofInput): SourceFileProofWriter;
```

The input accepts exactly own data properties, no getters/toJSON/custom prototypes. Validate the existing keyed source identity against this context's key ID; provider enum; safe positive parser version; positive bounded maxFileBytes/maxRecords/maxLineBytes; safe nonnegative observedSize <= maxFileBytes. Normalization/key versions are taken from the context, never supplied independently. Same-version parser fixes affecting output must bump parser version or the cache contract before reuse is allowed.

Let H be the UTF-8 encoding of this exact JSON array, in this exact order, using ordinary JSON.stringify after validation:

```text
[1,1,"content","source_file_bytes_v1",sourceId,provider,parserVersion,
 1,maxFileBytes,maxRecords,maxLineBytes,observedSize]
```

The first two integers are normalizationVersion and keyVersion; the integer after parserVersion is cacheContractVersion=1. H is small and metadata-only, never a raw source string. Enforce an explicit 1024-byte H ceiling. The current identity lengths and safe integer bounds fit it.

Compute standard HMAC-SHA256 with the existing private KeyObject over this exact byte sequence:

```text
UTF8("agentprof.source-file-proof/v1\u0000")
|| uint32_be(H.byteLength)
|| H
|| raw source bytes [0, observedSize)
```

Return `h1:${keyId}:content:${lowercaseHexDigest}`. The fixed NUL-terminated tag and 4-byte header length make framing explicit and domain-separated from existing JSON-only fingerprints. No trailing delimiter or text/base64 conversion is applied to source bytes. This is a new versioned message format using existing standard HMAC, not a new digest primitive or hash tree.

`update` synchronously consumes bytes, retains no input buffer reference, and accounts for exact received length. Reject excess bytes before updating. Zero-length updates are permitted. `finish` requires exactly observedSize bytes, returns once, and closes the writer. Any update/finish after finish/discard rejects with a safe fixed error. `discard` is idempotent and prevents later use; do not claim cryptographic zeroization beyond dropping references. Invalid calls use existing fixed safe errors and never include metadata/raw contents in messages.

Operational chunkBytes is deliberately excluded: update partition boundaries cannot change the digest. Changed effective maxFileBytes/maxRecords/maxLineBytes conservatively cause a miss even when old content would also pass. Key/parser/normalization/cache-contract changes must not hit. Source ID and provider are bound so proof cannot be transplanted between source paths/providers under the same key.

Only keyed proof leaves the raw reader boundary. No secret export, plain digest, raw path, byte buffer, stat object or source text enters SQLite/results. Existing identity vectors and 2 MiB/depth limits remain unchanged. Cryptographic collision resistance is the equality assumption; this is not mathematical collision-free identity or filesystem snapshotting.

## Schema 4 and proof lifecycle

Add `source_cache_evidence` as a STRICT table:

```sql
CREATE TABLE source_cache_evidence (
  source_id TEXT PRIMARY KEY REFERENCES source_event_headers(source_id),
  contract_version INTEGER NOT NULL CHECK(contract_version = 1),
  content_fingerprint TEXT NOT NULL
    CHECK(length(CAST(content_fingerprint AS BLOB)) <= 128)
) STRICT;
```

Read/write validation additionally checks the exact keyed content-domain format, matching key ID and supported contract. The table row is associated with the header's revision by the same atomic transaction; no separate revision counter is introduced. Cache evidence is optional and distinct from completed-line boundary metadata.

Expose a fresh immutable `cacheEvidence: {contractVersion: 1, contentFingerprint: string} | null` on validated StoredSource. Add an optional own-data `cacheEvidence` field to SourceSnapshotInput; absence means null. Existing event-only SourceInput and header fields remain unchanged. Keep backward source API compatibility for callers that omit it; reject unknown extra fields as before.

Lifecycle:
- 0/1/2/3 -> 4 migration adds the table and marker 4 under the existing BEGIN IMMEDIATE migration lock. Existing source rows/revisions/settings/evidence remain unchanged and have no cache proof.
- Refactor the current unconditional schema-3 DDL within the upgrade branch to run only when current < 3; otherwise upgrading 3 -> 4 would recreate existing tables. Preserve per-version marker/settings validation, peer-completed migration and rollback behavior.
- Full replacement with proof: validate proof before writes; replace header, events, metric evidence and cache proof atomically under the caller's original expectedRevision.
- Full replacement without proof: delete prior proof in the same replacement transaction.
- Event-only replacement: delete prior proof together with metric evidence.
- markUnavailable: increment revision and clear proof in the same transaction; preserve historical contributions/checkpoint.
- Stale write, aborted write and SQL failure: preserve proof and all prior generation data; first-write key binding rolls back together.
- A historical missing proof is a legitimate miss. A present malformed/unsupported/oversized/wrong-key proof is DATABASE_ACCESS_FAILED, not a miss. A proof paired with event-only data or unavailable status is structurally inconsistent with this lifecycle and fails validation. Never repair it via reparse.

Extend pinned readback to read/cache-validate the optional row in the same generation snapshot as existing payloads. Bound text in SQL before exposing proof metadata to JS, and reject unexpected extra proof rows/invalid storage types. Existing payload count/byte preflight and allowlist validation remain intact. The cache does not make the DB an authenticated tamper-proof store; it retains the existing corruption-validation boundary.

## Raw observation and parsing ownership

The proof minted on a successful parse must consume the actual bytes returned by that parse's existing same-descriptor reads. An internal raw-chunk observer in readJsonLinesFromFile feeds the writer. Do not accept an arbitrary callback through public SourcePrefixOptions, and do not change standalone readJsonLines semantics. Never checksum a later independent read and attach it to earlier parser results.

Hash every observed byte, including unfinished JSON/UTF-8 and zero-completed-record sources. Only LF-terminated records enter the adapter, unchanged. Reader diagnostics reject ingestion; committed readerDiagnostics are therefore empty. There is no lost committed reader-diagnostic blocker. Persisted adapter diagnostics and capabilities remain the source for successful reuse.

Finalize/release evidence only after full read success, existing final handle/path comparisons and descriptor cleanup; a close failure cannot follow a commit. On rejected parsing, observed mutation or cancellation, discard any proof. Existing sameFile dev/ino/size/mtimeNs/ctimeNs checks, no-follow/nonblocking regular-file open and final no-symlink verification remain. They detect observed changes, not arbitrary invisible change-and-restore races or changes after final observation.

Implement a bounded raw-byte probe using the same safe open/verification/cleanup policy, but without JSON decoding/adapter ingestion. It reads opening observedSize bytes exactly, rejects short reads, and does not retain the source. A size mismatch from the stored candidate is an immediate safe miss after the requisite observation/cleanup, and can skip unnecessary proof computation. A current size above the effective file cap retains file_limit rejection. If a candidate's versions/eligibility already mismatch, skip the probe and directly reparse.

## Exact final confirmation API and transaction contract

Reviewed store method:

```ts
type SourceCacheToken = Readonly<{
  sourceId: string; provider: "codex" | "claude"; revision: number;
  parserVersion: number; normalizationVersion: 1; keyVersion: 1; keyId: string;
  completedOffset: number; observedSize: number; boundaryFingerprint: string | null;
  cacheEvidence: Readonly<{ contractVersion: 1; contentFingerprint: string }>;
}>;
type SourceUnchangedResult = Readonly<
  | { status: "unchanged"; reusedRevision: number;
      capabilities: ParserCapabilities | ClaudeCapabilities;
      diagnostics: readonly SafeDiagnostic[] }
  | { status: "stale"; actualRevision: number | null }
  | { status: "aborted" }
>;
confirmUnchangedSource(token: SourceCacheToken, signal?: AbortSignal): SourceUnchangedResult;
```

A token is constructed from the original fully validated StoredSource, never raw caller properties. The method still validates exact own-data properties/domains/versions/numbers defensively. It does not itself claim file freshness: the scanner must only call it after a successful matching whole-byte probe.

Sequence:
1. Validate arguments and observe pre-abort, with no DB effects on abort.
2. If database.isTransaction is already true, reject with DATABASE_TRANSACTION_FAILED without committing/rolling back caller work. Reusing a caller-owned old snapshot could conceal a newer committed generation, so this method intentionally differs from general readSource.
3. Begin a fresh owned read transaction (`BEGIN`, not BEGIN IMMEDIATE). No awaits occur inside or after final successful confirmation. Check installation key binding inside this snapshot. A mismatch is INVALID_IDENTITY_KEY; malformed/missing identity for existing sources is a safe storage failure.
4. Obtain the current source and optional proof through existing full pinned payload validation. Missing source returns stale(null). A changed revision returns stale(actualRevision), with no retry. All cursors/owned transactions close on every path.
5. At the same revision require all token header fields and proof to match, available metric-evidence scope, compatible capabilities and no stateLimited/diagnosticsDropped. Same-revision disagreement is an integrity failure, not an unchanged result or implicit repair. Revalidate the full evidence rather than trusting the initial JS object.
6. Observe cancellation, commit the owned read transaction, and return immutable diagnostics/capabilities from this validated generation with reusedRevision. No payload write, revision increment or source identity binding is performed. Detected cancellation before this terminal return yields aborted with no writes.

The fresh snapshot acquisition is the generation observation point. Writers committing before it are seen; a writer after it may later replace the generation, as after a normal successful source commit. Do not promise perpetual freshness or exclusion of subsequent writes. A synchronous API cannot promise delivery of timer-driven abort callbacks during synchronous SQLite processing.

## Scanner coordination and outputs

Retain the existing initial full bounded readSource call for now. Capture original expectedRevision once and preserve the current corruption-stop behavior. Retain only the small candidate token/evidence needed while probing; the first payload arrays can be released. Header-only and validation-without-materialization optimizations are separate work.

- No candidate or legitimate ineligibility: full parse from zero with original CAS.
- Stable matching proof: final confirmUnchangedSource, then unchanged/stale/aborted as returned.
- Stable mismatch: full parse from zero, still with original expectedRevision; the new parsing pass performs its own file stability verification.
- Probe observed mutation/access/close failure: reject safely, do not hide it with a retry.
- Corrupt store/key/schema: safe storage failure and stop according to current scan policy.
- Cancellation: stop starting sources, preserve earlier commits/reuses and close resources.

Add `unchanged` to source outcomes and scan counts, plus reusedRevision (null except unchanged). Keep committedRevision exclusively for committed writes, staleActualRevision for stale results. `attempted` includes reused sources. Add unchanged=0 to pre-bootstrap zero-work results. CLI JSON remains an explicitly additive scan-result change under the existing envelope; confirm this additive compatibility choice during root review. Human output must distinguish reused and committed sources.

On unchanged outcomes, replay persisted adapter diagnostics through existing scan alias substitution/sampling, and propagate their actual capabilities. Committed readerDiagnostics are empty. Partial provider coverage remains partial even on a cache hit; recognized_shapes is not full provider support. Adapter stateLimited or diagnosticsDropped generations cannot be eligible for reuse. No invented global totals, freshness guarantee, source completeness, parser resume or aggregation readiness. No raw cache proof needs to appear in CLI output.

## Reviewed file scope

Production:
- src/normalize/identity.ts
- src/scanner/jsonl.ts
- src/scanner/source-prefix.ts
- src/scanner/source-ingest.ts
- src/scanner/scan-run.ts
- src/db/database.ts
- src/db/source-store.ts
- src/db/source-metric-validation.ts
- src/db/read-only.ts
- src/cli/scan.ts
- Optional small src/db/source-cache-validation.ts only if it keeps shared strict proof validation clearer; no generic caching abstraction.

Tests: new tests/source-cache.test.ts and tests/source-file-proof.test.ts; focused updates to tests/source-prefix.test.ts, tests/scanner.test.ts, tests/source-ingest.test.ts, tests/scan-run.test.ts, tests/source-store.test.ts, tests/source-metric-store.test.ts, tests/database.test.ts, tests/read-only-database.test.ts, tests/source-catalogue.test.ts and tests/cli-scan.test.ts where result/schema assertions require them; reviewed narrow expected-shape update in tests/identity-keyobject.test.ts and unchanged-count/revision update in tests/cli-stats.test.ts. Do not widen changes preemptively.

Documents: new docs/P4-UNCHANGED-SCAN.md; minimal docs/SPEC.md and docs/IMPLEMENTATION.md; dated docs/FINDINGS.md; precise current-contract reconciliations in P4-STORAGE, P4-METRIC-STORAGE, P4-INGESTION, P4-SCAN-RUN, P4-SCAN-CLI and P5-READONLY-STATS. No rewrites of historical benchmark budgets/evidence.

## Read-only schema policy

Keep the current exact-current-schema policy, explicitly advancing it to schema 4. `withReadOnlyStore` must remain non-creating/non-migrating. New binary read-only stats rejects schema 3 with DATABASE_SCHEMA_INCOMPATIBLE until a separately authorized scan/openDatabase migration occurs. It must not silently upgrade or open a write connection. Supporting both schema versions is deferred, rather than silently broadening this slice.

`verifySchema` currently hardcodes exactly three migration markers and LIMIT 4. Change to exactly markers [1,2,3,4], with a bounded LIMIT 5 sentinel for extras, preserving DELETE mode/sidecar/key/path/no-write checks. Read-only stats does not use cache evidence to claim freshness; selected source/cataloque semantics and readiness remain unchanged. Old binaries should safely reject future schema 4 rather than mutate it. Document this compatibility consequence before implementation approval.

## Implementation sequence and Verify gates

1. Root reviews/approves the exact framing, schema lifecycle, read-only policy and additive scan output. Then update maintained plans and Project claim before any implementation, using a separate developer and current base/ownership readback.
   Verify: no overlapping reservation; exact reviewed contracts; no hidden parser/header-only/resume scope.
2. Implement and review the proof primitive and schema/store lifecycle before using it to skip parsing.
   Verify: independent HMAC test vectors, chunk partition invariance, empty/BOM/CRLF/multibyte/raw-tail bytes, key/source/provider/version/options separation, short/excess/closed writer validation and privacy. Existing fingerprint oracles unchanged. 0/1/2/3->4, idempotent 4, future/corrupt/missing-marker cases, controlled peer-completed migration and rollback retain all existing data.
3. Connect same-read proof generation and bounded raw probes; preserve reader/parser behavior.
   Verify: all ten independent provider fixture outputs remain exact, LF offsets/pending tail behavior unchanged; proof describes actual read bytes. No full-file buffer; current ceilings and early failure behavior remain.
4. Add original-CAS unchanged confirmation and scan output.
   Verify: reopened second scan unchanged with same revision/evidence, zero adapter ingest calls and zero source replacements. Keep real diagnostics/capabilities and partial status. Same-size early/middle rewrites with unchanged tail and restored mtime miss; changed incomplete tail, LF completion, append/truncate/replacement miss and correctly reparse. Lowered semantic limits cannot bypass rejection through cache.
5. Exercise corruption/concurrency/cancellation before completion.
   Verify: malformed/missing/oversized/wrong-key cache metadata, corrupt cached events/metrics and payload bounds fail closed; no repair-on-miss. Real second connection replaces or marks unavailable between initial read/probe/final confirmation -> stale/no retry. Already-active caller transaction rejects without disturbing it. SQL failure/cancel preserves proof/header/evidence/key binding. File change/unlink/symlink/FIFO/short read/close failures preserve generations and close actual handles. Aborts before read, during probe, before confirmation and after prior terminal sources preserve truthful per-source outcomes.
6. Verify read-only and installed CLI integration, then full checks/review/publication.
   Verify: schema-4 read-only list/select no-write assertions; old schema-3 safe rejection without migration; schema4 proof absent is valid historical data; selected summary/catalogue output unaffected. Packed synthetic scan/repeat/list/select, Node guard, full npm run check, docs links and whitespace. Independent all-file review, frozen manifests, remote exact-byte verification and exact-head supported-runtime CI before merge/Done. No timing benchmark campaign.

## Limits and authorization boundary

This is not a two-file shortcut. Correct reuse needs durable proof, interpretation identity, atomic lifecycle and generation validation. It still reads all bounded source bytes and validates stored payloads; the conservative first implementation validates a cached generation twice. Misses can add an extra read pass. It does not speed cold parsing or enable oversized files. No universal speedup/time/RSS result is claimed; existing historical budgets remain untouched and full-history acceptance is unverified.

Implementation follows the reviewed narrow scope and Project claim. This contract does not authorize merge, deployment, benchmarks, actual user-log access, Work/Codex quota tasks or desktop work. The parent owns independent review and draft publication.

## Implementation review refinement — 2026-10-01T16:19Z

Before scanner integration, the coordinator reviewed proof/schema/store code. Exact bounded migration-marker validation is required under the write lock for every supported nonzero schema, including idempotent schema 4 opens: precisely markers 1 through the observed version, plus a single extra-row sentinel. Preserve settings validation for current-schema opens too. Schema-0 bootstrap first establishes marker/settings 1 in the same transaction. Unknown extra/missing/invalid marker or settings rows fail migration and roll back without altering existing data. This closes the prior presence-only boundary rather than claiming it was already strict. The additive IdentityContext method requires one existing key-privacy shape assertion to include that method; its existing fingerprint vectors remain unchanged.

## Current-parser gate correction — 2026-10-01T16:26Z

Root review caught a hard-coded version-1 candidate gate before completion. Read the actual current provider adapter's fresh snapshot version without ingesting records; compare stored candidate version with that value and frame the probe using that current value. A synthetic provider-version bump must force parsing and must never confirm the old proof. No separately duplicated parser-version constant is permitted. Also update only the old repeated-scan expectations in cli-stats tests to unchanged counts/preserved revision; retain all selected-source output assertions. These corrections are recorded before code.

## Proof argument hardening — 2026-10-01T16:35Z

The new primitive must account for actual typed-array byte length even when a caller shadows the public byteLength property. Read it with the intrinsic typed-array getter; the synchronous HMAC receives the same view. Reject proxy metadata before any traps rather than letting it counterfeit own-data validation. Add a shadowed-length/getter regression and revoked/throwing-proxy metadata cases. This only tightens the new proof primitive; existing fingerprint algorithms and source-reader behavior remain unchanged.

## Developer verification receipt — 2026-10-01

- PASS: Linux x64 Node 24.19.0 and 24.21.0 final `VITEST_MAX_WORKERS=2 npm_config_cache=<writable temporary cache> npm run check`: typecheck/build, 593 tests across 26 files, and 36-file artifact. Existing script-disabled isolated tarball npm-exec/global-install help/version and packed synthetic scan/list/select pass. No repository configuration, package or dependency changed.
- PASS: independent fixed HMAC vector and standard-HMAC framing oracle; empty/BOM/CRLF/multibyte/unfinished raw bytes, chunk invariance, effective limits/key/source/provider/parser separation, exact short/excess/closed/discard semantics, shadowed byteLength and proxy metadata rejection. Existing identity fingerprint vectors and privacy assertions remain unchanged except the new public method's expected shape.
- PASS: fresh 0/1/2/3 to 4 and idempotent-4 migration, real peer-completed migration, data/settings/revision preservation, exact markers/settings, missing/extra/wrong-type/corrupt/future cases and failed-DDL rollback. Cache proof follows atomic full/legacy/unavailable lifecycle. SQL failure and mid-transaction cancellation preserve proof and every contribution, including first-write key binding.
- PASS: cache input validation and bounded malformed/oversized/wrong-key/TEXT/BLOB proof reads, duplicate/orphan/event-only/unavailable proof inconsistencies; initial/final cached payload corruption fails closed. Final confirmation revalidates immutable evidence in a fresh owned read transaction. Real peer replacement/unavailability returns stale without retry; a real caller-owned older WAL snapshot is rejected without committing/rolling back it, then sees the newer generation after its caller commits.
- PASS: same-parsing-read proof tested by injecting different bytes into the actual decoder buffer and showing the proof matches those bytes rather than a later disk reread. Descriptor cleanup precedes proof release. Existing ten-provider-fixture semantic/normalization oracles and LF/unfinished-tail offsets pass. Raw probes reject observed append/truncate/rewrite/replace/unlink/symlink, short read, read/close errors and cancellation, with actual closed-descriptor assertions.
- PASS: all ten synthetic provider fixtures reopened and rescanned with zero adapter ingest calls, zero source replacements, identical DB bytes/revisions and exact diagnostic/capability replay. Different chunk partitioning still reuses. Same-size early/middle/tail changes with exactly restored mtime and unchanged completed-boundary evidence miss and reparse; LF completion, append/truncate/replacement and lowered semantic limits cannot bypass parsing/rejection. Actual current adapter version is checked; the root-found initial literal-version gate was corrected and a synthetic version bump proves no old-proof confirmation.
- PASS: stale and failed-write regressions retain their original parsing path via a changed unfinished tail rather than weakening their expectations. Reused partial coverage stays partial, diagnostics retain alias substitution/sampling, cancellation retains previous terminal reuse, and CLI output contains no cache proof/raw path/source text. Existing CLI/stats repeat expectations now distinguish unchanged from committed and preserve reused revision.
- PASS: separately installed packed tarball synthetic scan/repeat/list/select: second scan reports unchanged=2, committed=0 and reusedRevision=1, exact diagnostics/capabilities, no proof fields, identical DB bytes; subsequent read-only stats preserves DB/key bytes, modes and directory entries. This supplemental check used Node 24.19.0 and script-disabled isolated npm installation.
- PASS: 10 changed documents, 105 local links and 13 anchors, plus `git diff --check`. Fresh main remains `1dcd70089d640f5137b382eaf83b0b2ecc49b41d` and no open PRs were observed before freeze.
- PASS: actual historical schema-3 read-only rejection without any store mutation, explicit write-open migration, and subsequent schema-4 list/select with legitimate absent proof. Existing no-create/no-migrate/no-write, sidecar/mode, catalogue and selected-summary contracts remain unchanged.

Initial execution attempts are not passed gates: one default-worker run was interrupted by a worker SIGKILL while running scan-run (no assertion failure reported); the independently executed scan suite passed. The next bounded-worker run passed tests but artifact packing failed because the default home npm cache path was unavailable. The final full command above uses only explicit runner/cache environment settings and passes every stage. These observations establish no resource/RSS or performance claim. Hosted CI must still verify the exact published head with its standard workflow.

At this handoff, macOS and real-user/full-history resource acceptance are NOT RUN. No timing benchmark, actual user-log access, default-root expansion, durable parser resume, global reconciliation, report changes, merge, deploy or npm publication occurred. Broad P4 acceptance stays open, both readiness flags remain false, and unchanged-source equality is the documented bounded observation rather than a perpetual filesystem freshness guarantee.
