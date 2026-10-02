# P4: bounded source relationship evidence

Status: coordinator-reviewed implementation contract, 2026-10-02 UTC. Root verified PR30 Project closeout and shared-document release, then expanded and read back P4 claim p4-relationships-20261001-2358 at 00:10 UTC. Production authorization covers exactly the 24 paths below (including the subsequently coordinated test-only amendment). Execution evidence remains NOT RUN at implementation start. Historical observations below retain their original timestamps.

## Historical planning observation and coordination (2026-10-01)

Read-only GitHub inspection resolved main to `18bd5579fc4954d29e710c5d47157f4b189b97c7` (merged PR29). Recursive Git tree read was complete, `truncated=false`. Freeze every blob/mode again in the actual authorized development checkout before editing; this document does not claim a local baseline test run.

At 23:53 UTC, PR30 was draft/open/unmerged, head `801791c44984b9b5a670028b3c5f5123c48bb415`, base `18bd5579fc4954d29e710c5d47157f4b189b97c7`. Earlier `f56a4057` verification does not certify that new head. The Project's independent final-review claim belongs to Codex PR #30 review, session `01a0f182-0d47-7d50-acfe-c003c004822e`. Do not fix its CI, modify its files, or take over its merge.

- P4 ticket: https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059
- PR30: https://github.com/WhiteKiwi/agentprof/pull/30
- Active review: https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=260061481
- Report reservation: https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833093

At that planning timestamp, P4's prior PR27 implementation/review reservations were released and the PR30 reviewer reserved possible evidence corrections in SPEC, IMPLEMENTATION, METRICS and P5-SOURCE-FAILURES. This draft is a new local file only. At that point, SPEC/IMPLEMENTATION updates had to wait for explicit release or coordinated permission; the later implementation-start receipt records that release. If repository policy requires those updates before code, that is a production-start gate: this standalone plan does not waive it. Report/**, docs/REPORT-PREVIEW.md and display-model remain reserved elsewhere. The stale P5 statement that PR13 is draft is superseded by its verified merge; it is not permission to reimplement or seize the renderer.

## Frozen pre-implementation gap and purpose

At the frozen pre-implementation main, before this slice:

- `src/parsers/types.ts` defines CodexSnapshot.metadata and wrappers.
- `src/parsers/claude/types.ts` defines ClaudeSnapshot.metadata and messages.
- `src/scanner/source-ingest.ts` takes final snapshot.events, turns, usage, observations, diagnostics and capabilities only.
- `src/db/source-metric-validation.ts` MetricEvidence and `src/db/source-store.ts` StoredSource omit relationship payloads.
- `src/parsers/codex/index.ts` retains private source/stream state, pending results, replay, process/poll links and usage ordering not represented by the public snapshot.

Persist the already normalized relationship observations with the exact source generation. Do not infer relationships or change provider interpretation, existing IDs, metric results, CLI output, report model or public exports. This is not durable parser recovery: changed files still parse from byte zero. `aggregationReady=false` and `parserResumeReady=false` remain unconditional.

Source links use the frozen revision:

- https://github.com/WhiteKiwi/agentprof/blob/18bd5579fc4954d29e710c5d47157f4b189b97c7/src/parsers/types.ts
- https://github.com/WhiteKiwi/agentprof/blob/18bd5579fc4954d29e710c5d47157f4b189b97c7/src/parsers/claude/types.ts
- https://github.com/WhiteKiwi/agentprof/blob/18bd5579fc4954d29e710c5d47157f4b189b97c7/src/scanner/source-ingest.ts
- https://github.com/WhiteKiwi/agentprof/blob/18bd5579fc4954d29e710c5d47157f4b189b97c7/src/db/source-store.ts

## Proposed representation and semantics

Add an optional internal `relationshipEvidence` input/output property, so existing synthetic StoredSource constructions and callers remain source-compatible. Runtime readSource always returns this property explicitly, with one of:

1. null: historical/not-captured. It is not an empty graph and is not current capture-policy coverage.
2. `{contractVersion:1, capturePolicyVersion:1, status:"captured", provider, metadata, wrappers}` for Codex, or corresponding `messages` instead of wrappers for Claude. Arrays can be empty. Captured means complete retention of this bounded adapter snapshot's exposed relationship fields, not complete session/history/provider graph.
3. `{contractVersion:1, capturePolicyVersion:1, status:"unavailable", reason:"relationship_budget_exceeded", provider}`. No partial arrays, graph counts or fabricated zero graph. This is durable, deterministic current-policy unavailability, not historical absence.

The normal ingestion adapter produces (2) or (3). Missing optional input is retained as null for existing internal callers. No new CLI schema/flag or raw graph output is added. Safe persisted unavailability is inspectable in internal readSource; current CLI does not claim relationship completeness. Any future user-facing relationship view must expose the distinction.

Preserve exact current type fields: Codex metadata ownership/declaration/version/fork/origin/sourceRef; wrapper kind/callSeen/resultSeen/relationship/childEventIds/sourceRef; Claude metadata nullable root/session/agent/sidechain/declaration/version/origin/sourceRef; message kind/parent/source-tool-assistant/response/conflicted/sourceRef. Keyed IDs remain keyed, never raw provider IDs. Preserve order deterministically and do not relabel trusted_fixture/trusted_copied as ordinary. A wrapper does not add an execution.

References to nodes absent from the bounded source are legal when the adapter emits them. Validate identity domains and shape, not invented referential completeness. No foreign key to a possibly absent event/message/session; no recursive graph traversal, cycle resolution, ancestor closure, cross-source winner, copied-history dedup or retry inference. Duplicate row IDs within one kind are invalid. The same canonical IDs in independent source contributions remain legal.

## Limits and preserving old accepted sources

Existing production ingestion uses default adapters. Source-backed default ceilings:

- Codex DEFAULT_CODEX_LIMITS: metadata 8192, events 4096; wrappers use the events ceiling; aggregate wrapperChildLinks use links=1024.
- Claude DEFAULT_CLAUDE_LIMITS: metadata 8192 and messageLinks 8192. Each message type has two nullable message-reference fields; the sourceToolAssistantMessageId field is distinct from parentMessageId.
- Both adapters allow explicitly configured limits up to 1000000 in their standalone constructors. This proposal does not change those APIs or claim its storage limits cover custom expanded snapshots.

New storage capture-policy limits: the above default row/link ceilings, 64 KiB serialized relationship row and 4 MiB total serialized relationship payload. These are optional relationship-capture limits, not new rejection thresholds on previously accepted event/metric ingestion. Existing 16 MiB event and 16 MiB metric limits remain independent and unchanged. Maximum combined serialized payload becomes up to 36 MiB, explicitly an increase from 32 MiB; actual RSS is not inferred. Coordinator approved this 4 MiB relationship budget before code. This introduces capture policy v1; future eligibility/budget changes must version policy explicitly.

For well-formed adapter snapshots exceeding any new capture budget, discard the entire attempted relationship encoding, emit status unavailable with the fixed reason, and commit the already accepted event/metric snapshot atomically. Do not silently reject the source, partially store a graph as captured, or invent a complete graph. Enforce count ceilings before traversal, field/row bounds before accumulating and total bytes incrementally. Do not JSON.stringify the whole unbounded candidate first. Data corruption/type violations are distinct from a legitimate budget result and remain safe errors; do not hide corrupt DB input as budget-unavailable.

## Actual trust boundary

Raw log records are parsed into ordinary data by existing adapters. Relationship storage accepts supported in-process adapter data and validated parsed database JSON; this is not a sandbox against arbitrary hostile executable JavaScript objects. Use exact own-property descriptors and allowlists, reject accessors, unexpected fields, unsupported prototypes, symbols and toJSON hooks without reading arbitrary property values through getters; clone only validated primitives/arrays into owned plain records before encoding.

Generic ECMAScript code cannot reliably identify all proxies or promise that descriptor/prototype inspection never triggers a proxy trap. Do not claim a blanket proxy guarantee. If the implementation deliberately uses Node's supported `util.types.isProxy`, verify its specific behavior and scope on supported runtimes before any stronger claim; it is not required to change shared validators in this slice. Tests must distinguish ordinary-object accessor rejection from unsupported executable-proxy behavior. No serialized input can carry JavaScript getters/proxies, and no raw records or strings are stored outside existing safe fields.

## Schema 5 and atomic lifecycle

Add separate STRICT source_relationship_headers and source_relationship_contributions tables. Header is source-owned and records contract/capture policy/status/fixed reason, row counts and bytes. Captured empty arrays have a real captured header; unavailable has no contribution rows and a fixed reason; historical null has no header. Rows use provider-compatible kind, ordinal, keyed row ID and JSON. Validate source/header/key/version/sourceRef positions, exact row/count/byte agreement and status consistency on every read.

Events, metrics, relationship header/rows, checkpoint, revision and optional cache proof commit in one existing original-CAS transaction. No separate graph revision. Failed SQL, cancellation or stale CAS preserves all prior contributions and installed-key binding. Legacy event-only replacement and snapshot replacement without relationship input clear old relationship rows/header. markUnavailable preserves historical relationship evidence as it preserves events/metrics, but clears cache proof; no new unavailable source reconciliation is added.

Migration preserves existing records/settings/revisions/proof and leaves relationships null. At the frozen pre-implementation base, database.ts unconditionally ran schema 4 cache-table DDL inside `current < DATABASE_SCHEMA_VERSION`; first guard that DDL with current < 4, then add current < 5. Otherwise existing schema 4 upgrades repeat CREATE TABLE. Keep version observation under BEGIN IMMEDIATE. Exact marker validation supports 1..5 with LIMIT 6 sentinel and rejects missing/extra/wrong-type markers before mutation.

Bounded readback must preflight real SQL counts, serialized byte lengths, largest row, ID/kind lengths and header consistency before ordered payload consumption. Query source+kind+ordinal through indexed bounded rows, avoiding unbounded sorting/materialization. Read under the same snapshot as events/metrics. Close cursors and owned transactions on all exits and preserve caller-owned transaction ownership. No multiplied joins.

## Cache and read-only compatibility

Keep source-file HMAC/cache proof v1 because its bytes/provider/parser/key/interpretation framing is unchanged. Do not forge parser-version increments for a storage-only projection. Candidate selection requires relationshipEvidence with understood contractVersion=1 and capturePolicyVersion=1, whether captured or explicitly unavailable. Null historical evidence forces one full byte-zero reparse under the original expected revision. Both statuses then permit normal unchanged reuse, avoiding endless reparsing of an over-budget source.

Final confirmUnchangedSource revalidates relationships and status in its fresh owned transaction, not just initial candidate metadata. Cache proof never certifies graph completeness. Persisted unavailable must have the exact allowed reason, no payload rows and internally consistent bounded header. Current-policy mismatch forces recapture; unsupported future durable contracts are safe incompatibility, not silent repair. Any future change to relationship projection/capture eligibility/budgets must change the appropriate contract or capture-policy version and define migration/recapture. Same-revision contradictory payload is corruption.

Keep exact-current-schema read-only policy: new read-only binary rejects schema 4 with DATABASE_SCHEMA_INCOMPATIBLE and no creation, migration, permission change or write. Authorized write-open migrates 4→5. New schema 5 with historical null graphs remains valid for existing stats/insights/failure commands. Old schema 4 binaries reject schema 5 safely. Update read-only marker checks to exact 1..5/LIMIT 6; retain DELETE-mode/sidecar/key/no-write safeguards.

## Approved editing scope

Production (seven paths):

- new src/db/source-relationship-validation.ts
- src/db/database.ts
- src/db/source-store.ts
- src/db/source-metric-validation.ts (optional relationship input/encoding connection only)
- src/db/read-only.ts
- src/scanner/source-ingest.ts
- src/scanner/scan-run.ts

Tests (fourteen paths; all existing paths verified in the frozen tree, except two marked new):

- new tests/source-relationship-store.test.ts: validators, lifecycle, bounds, corruption and relationship equality
- new tests/source-relationship-integration.test.ts: ten fixture pipeline, cache states, CLI parity and local installed artifact supplement
- tests/database.test.ts: schema 5 exact markers/migrations
- tests/source-store.test.ts: legacy replacement/readback compatibility
- tests/source-metric-store.test.ts: preserved metric data and transactions
- tests/source-ingest.test.ts: optional relationship capture and unchanged old payloads
- tests/source-cache.test.ts: null recapture/captured+unavailable reuse/fresh confirmation
- tests/read-only-database.test.ts: schema 4 rejection/schema 5 no-write
- tests/scan-run.test.ts: source lifecycle, cache result parity, bounds
- tests/source-catalogue.test.ts: unchanged catalogue metadata/output
- tests/cli-scan.test.ts: exact current-schema assumptions only where required
- tests/cli-insights.test.ts: legacy fixture stripping and historical/future schema expectations only
- tests/cli-failures.test.ts: legacy fixture stripping and historical/future schema expectations only
- tests/cli-stats.test.ts: clear inherited relationships in the explicitly empty-source synthetic fixture only

Three documents: docs/P4-RELATIONSHIP-STORAGE.md, docs/SPEC.md and docs/IMPLEMENTATION.md. Root verified explicit release and amended/read back the reservation before edits. Parser files/types, identity framing, provider fixtures/oracles, CLI/main/stats/insights/failures, report/design, package/lock/workflow and scripts/verify-artifact.mjs are excluded. Existing pure analysis tests should not need changes because the internal relationship property is optional. If compilation proves another path is required, stop and request a precise scope amendment, especially for any PR30 file.

## Baseline fixtures and independent expected outcomes

Existing provider JSONL files (ten): claude-fork, claude-message, claude-real-shapes, codex-archive, codex-fork, codex-legacy, codex-pending-append, codex-real-shapes, codex-structured, codex-usage-replay. Reuse bytes unchanged; no actual user logs.

Frozen codex-p2-expected.json says codex-real-shapes has 2 executions, 1 wrapper, 0 poll executions; command runtime2250ms vs lifecycle3000ms, completed/no_match; MCP1400ms vs lifecycle1500ms. Preserve them. Wrapper output exit91/process314 must not become child execution evidence. Do not supply trusted contexts to ordinary ingestion.

Frozen claude-p3-expected.json says claude-real-shapes has13 records,5 executions (4 root/1 sidechain), completed2/failed1/pending2; paired latencies3000/3000/2000ms; acknowledgement latencies1000/1000ms; duration-only turns9000 and0, zero located turn intervals. Usage finality unknown/selection provisional remains so. Explicit trustedFinalContext is a separate test-only case, not ordinary source truth.

Provider expected.json includes historical combined-source/trusted annotations (archive/fork known copies, wrapper relations). It is not permission to infer those facts from an ordinary single file. Preserve existing parser oracle assertions unchanged. For new relationship expected values, hand-enumerate a small raw synthetic fixture's metadata declarations, IDs/source byte positions, parent/source-tool edges and wrapper fields before coding. Independent ordinary adapter invocation supplies pipeline equality but is not the sole semantic oracle. No new exact graph counts are asserted as measured yet.

## Staged development and verification gates

1. Before production: resolve latest main and PR30, compare changes; freeze complete base tree/modes and existing fixture/oracle bytes. Review this contract, resource increase and unavailable policy; coordinate reserved shared docs, then record/read back one fresh narrow P4 Project claim and exact file list. No production authorization is implied by this local plan.
2. Add pure relationship validator/encoder and independent synthetic expected cases. Review safe object boundary, provider variants, null/captured-empty/unavailable, limits and deterministic order before DB integration.
3. Add schema/store lifecycle and bounded same-generation reads. Verify all old schemas0..4→5, current5, future, corrupt settings/markers, controlled peer-completed migration, rollback, unavailable retention, legacy clears, original CAS, cancellation, hostile oversized rows before payload sorting and real cursor/transaction cleanup.
4. Connect unchanged adapters' final relationship projections. Verify all ten fixtures through ingest/store/close/reopen against independent adapter results plus hand oracles. Test partial/dangling references, conflicts, sidechains, unknown/trusted origins, repeated source, replacement, append and input change failures. Old event/turn/usage/observations/capabilities remain byte/semantic equivalent.
5. Verify migration+cache matrix: schema 4 migrated null forces exactly one recapture; captured and deterministic budget-unavailable both subsequently reuse with zero adapter ingests/replacements and unchanged revision/DB bytes. Capture-policy mismatch recaptures, unsupported/corrupt contract fails safely, stale peer change returns stale without retry. Budget exhaustion never changes previously accepted metrics into source rejection.
6. Integrate only after PR30 status/ownership recheck. Run exact status/stdout/stderr comparisons for scan repeat, list/select stats and insights, and PR30 failures if merged. Fresh schema 5 stores and migrated stores need separate controls because one-time recapture legitimately advances generation. No raw fields or graphs leak into existing JSON/human output. Test read-only DB/key bytes/modes/directory entries unchanged and schema 4 refusal untouched.
7. Final authorized verification: focused suites then full check/typecheck/build/existing artifact script; separate script-disabled installed-tarball graph/cache/parity test using existing test paths, no premature artifact-script claim. Verify Node 24.15.0/24.21.0/26.7.0 and Node 22 rejection on applicable environments, exact final remote hashes/CI, all-file independent review. Counts are recorded only after execution; no old gate certifies the new head. No merge/deploy/npm publication unless separately authorized.

## Stopping and non-goals

Stop before production if shared-doc prerequisite cannot be coordinated, a proposed budget changes existing source acceptance, graph identity semantics cannot be justified from current adapters, or extra reserved paths are needed. Stop a failing verification at its actual failure; do not weaken gates or claim resource performance. Durable restart state, append parser resume, cross-source reconciliation, new metric/rule/report behavior and real-user usefulness remain later slices. Full P4 stays In Progress.

Original planning-only evidence (2026-10-01): read-only source/Project inspection and the local planning document only. Implementation and every proposed test were NOT RUN at that point. Later execution receipts below supersede this historical boundary.

## Implementation-start receipt (2026-10-02 00:12 UTC)

Fresh main is `469f22e3dc33809039f78a068740094627e0a4b8`, tree `e7a34f293e27ff6516556c819e640d3dd31193dc`, 176 exact blobs/modes, equal to PR30 final tree. PR30 merged at 00:00:42Z and its Project closeout explicitly released shared docs. Root owns claim expansion/readback at 00:10UTC. The earlier unreleased reservations and proposed 16 MiB budget are superseded by this receipt and the 4 MiB contract above, not erased as historical facts.

Claude capture bounds additionally count both nullable message references against the adapter default aggregate edge ceiling8192. The independent pre-code oracle uses fixed synthetic keys and test-local HMAC framing, explicit Codex metadata/wrapper call/result records and Claude assistant/user/sidechain records, including distinct parent and absent source-tool edges. It is not computed by the new storage implementation. Existing fixture/oracle bytes remain unchanged. Full check, focused tests, CLI comparisons and artifact supplement are NOT RUN at this point.

### Fresh confirmation binding

The internal small cache candidate additionally binds the validated relationship capture header and row sequence with a transient SHA-256 fingerprint (incremental per-row framing, not a new durable source-file proof). Fresh confirmation recomputes this binding inside its owned snapshot, so valid-shape relationship substitutions without a revision advance fail safely. This transient change-detection binding is not durable evidence or an authenticity guarantee. The durable source-file HMAC remains v1 and no public CLI token is added. Future capture-policy versions may be structurally read under contract1, but cannot reuse until current-policy recapture. Unknown durable contract versions fail safely.

### Bounded capture preflight precedence

For supported in-process adapter snapshots, an over-limit row/child count short-circuits capture before traversal of the unseen tail. The unavailable marker does not certify validity of uninspected elements. Shape/type errors in inspected values remain safe errors. This is an explicit resource boundary, not a sandbox promise for arbitrary executable objects. Durable database reads always reject malformed headers/rows/counts/bytes; corruption is never converted into unavailable. Over-limit semantic fixtures use dense adapter-shaped values. Root approved this clarification before those fixture corrections.

## Interim development evidence (2026-10-02 UTC)

Baseline Node 24.19.0 Linux x64: typecheck/build, 895 tests across 34 files with heap512 MiB/one worker, then the unchanged40-file script-disabled installed artifact passed. The first dependency-copy command used the wrong relative path and did not run tests; the first artifact attempt used missing default `/home/agent/.npm`, then passed with an explicitly writable local cache. These were preparation failures, not baseline source failures.

The first targeted compatibility run had four setup failures: historical future-schema expectation, current-version fixture label, legacy synthetic input retaining the new optional field, and manually constructed event-only SQL data retaining stale relationship rows. Corrected within reserved tests. A subsequent273-test/eight-file run passed. Independent tiny HMAC/offset oracles and all ten fixture relationship round trips passed. Initial unavailable reuse fixtures used a64 MiB ingestion proof but a16 MiB scan proof; aligned the semantic limits so relationships alone determine eligibility.

The first full run did not pass: five further synthetic CLI fixture assumptions in three test files require a coordinated test-only scope amendment (future-schema 5 expectations, event-only input stripping and empty-source relationships). It also reported an integration worker SIGKILL. A bounded isolated run reproduced that signal; replacing only generic deep Buffer equality for multi-MiB DB files with lossless base64 string equality made the unchanged real-budget test pass under the same512 MiB/one-worker limits. The next combined relationship/store/schema/read-only run passed 136 tests across 4 files;13 optional CLI-parity/installed cases were not enabled. This supports a test-comparison overhead explanation but is not an OS-level OOM diagnosis or production performance claim.

At this interim checkpoint, full-check status remained NOT PASSED. Optional CLI parity/installed supplements, final frozen review and remote CI remain pending. No limits or correctness gates were weakened, and no deployment/npm publication occurred.

### Coordinated compatibility-test amendment (2026-10-02 00:34 UTC)

Root expanded and verified Project readback for three test-only paths, bringing the reserved maximum to 24: cli-insights, cli-failures and cli-stats tests. Changes are limited to the failures recorded above: strip relationshipEvidence when building legacy event-only input, treat schema 4 as historical and schema 6 as future, and explicitly clear relationships when replacing an inherited source with an empty offset0 generation. CLI production bytes and semantics are unchanged. This maintained plan was updated before editing those files.

### All-enabled first run and installed-fixture correction (2026-10-02 00:45 UTC)

Typecheck/build passed. With all 13 optional parity/installed cases enabled, the full36-file suite reached1005 passed/1 failed, with no worker signal: only the installed7000-metadata budget fixture incorrectly assumed exit0. The frozen pre-change CLI and new installed CLI were then run on identical synthetic bytes, source path and keys; status/stdout/stderr were exactly equal. Both returned partial/exit1 with one committed source, zero rejected/failed, and `INSUFFICIENT_OPERATION_CONTEXT` at byte 532000. This is pre-existing provider coverage, unrelated to relationship capture.

Corrected only the installed fixture expectation to exact exit1 and diagnostic; reuse must preserve the same diagnostics, revision1 and complete DB/key bytes. The focused corrected installed case passed with unchanged512 MiB/one-worker controls. Production bytes did not change. The1005/1 receipt remains a failed full run; a complete final rerun is still required. Heavy execution was released to the coordinator after the focused check.

## Final local execution receipt (2026-10-02 01:01 UTC)

Final Node 24.19.0 Linux x64 verification passed with explicit `NODE_OPTIONS=--max-old-space-size=512`, one Vitest worker, umask022 and a writable npm cache. The complete check sequence was `npm run typecheck && npm run build && npm test -- --maxWorkers=1 && npm run verify:artifact`, with both optional test binary paths explicitly enabled. This runs every unchanged check-script stage with the required one-worker control. All 1006 tests in36 files passed, with zero skipped cases, failures or unhandled errors. The unchanged artifact verifier passed its41-file script-disabled tarball npm execution/global installation, selected stats/insights/failures and unchanged-store checks.

The13 enabled supplementary cases cover110 exact pre-change/new CLI status/stdout/stderr comparisons across all ten provider fixtures (initial/reused scan, list/select stats, insights and failures, human/JSON where applicable), two installed captured-relationship provider cases and one real installed budget-unavailable case. The installed provider cases additionally compare16 current-versus-installed stats/insights/failure process results. Installed compiled bytes match the final local build. The separately recorded7000-metadata baseline comparison also matches exact status/stdout/stderr; current-policy unavailability preserves the admitted event/metric source and unchanged reuse.

Validated behavior includes independent synthetic keyed IDs/offsets, nullable metadata, sidechains, distinct/dangling message edges, trusted wrapper children without invented executions, immutable round trips over ten unchanged fixtures, null-versus-empty-versus-unavailable, policy recapture, bounded same-snapshot reads, corruption preflight, exact schema markers and migrations0..4→5, read-only historical-schema refusal/no-write, original CAS, cancellation/SQL rollback and caller transaction ownership. Captured/unavailable cache reuse keeps source revision and complete DB/key bytes/modes/entries unchanged; transient token binding catches same-revision relationship substitutions.

Independent read-only review covered all 22 changed paths (18 inherited modifications and4 new files); no missing inherited file, mode change or concrete production defect was found. The final installed fixture-only correction was explained to the reviewer. All seven production files remain byte-identical to the independently reviewed production manifest. The three shared/current-schema documentation sections were reconciled without rewriting historical receipts.

Fresh connector observation before final publication still resolves main to `469f22e3dc33809039f78a068740094627e0a4b8`, tree `e7a34f293e27ff6516556c819e640d3dd31193dc`. Parser/normalizer/CLI/analyzer/report/package/lock/workflow/artifact-script bytes and all inherited fixture/oracle bytes remain unchanged. This is synthetic compatibility/privacy/storage verification, not measured real-user usefulness, provider-complete graph retention, RSS performance, durable resume or full P4 completion.

Local Node 24.15.0/24.21.0/26.7.0 and Node 22 guard executions were NOT RUN in this environment; remote exact-head CI/runtime receipts, draft publication and any later merge remain coordinator-owned gates. No worker Git publication, merge, deployment or npm release occurred.

Final changed-document link verification passed 72 local file references and7 local anchors; added-line whitespace passed. Frozen scope is22 changed paths (four new),180 tracked final files and158 byte/mode-identical inherited paths outside the change.
