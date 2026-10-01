# P4: bounded sequential source scan

## Reviewed scope

The coordinator approved this three-file plan on 2026-10-01 after the metric-storage implementation handoff. It uses the discovery, source-store and ingestion APIs already on main `c6b80d29e4a796666d0e7eadbfcbeebea1e6ce41`. Before publication the isolated branch was advanced to merged metric-storage main `f051467037554f014d73733b0f8728c481da81f3` for integration verification. It modifies none of those APIs or the separately owned report code. [P4](https://github.com/users/WhiteKiwi/projects/2?pane=issue&itemId=258833059) owns its claim and verification status.

`scanSources` connects explicitly supplied local roots to sequential source ingestion. It does not choose home-directory defaults, expose a CLI, restore parser state, skip unchanged files or start workers. Each source uses the current ingestion API; its returned storage scope is preserved rather than upgraded. This remains a bounded integration primitive, not completion of incremental scan or an aggregation-ready database.

## Input, privacy and ceilings

Validate exact own-data-property input fields before I/O. Roots contain only provider (`codex` or `claude`) and path; normalize their absolute identities, reject unsafe input and deduplicate identical provider/root pairs. Require at least one explicit root and permit at most 16. No implicit discovery of user logs occurs when the API is imported or called with invalid input.

Run ceilings are 64 discovered source files, 256 directories, 4,096 internal discovery nodes and, separately, 4,096 yielded discovery entries, 16 MiB per source file, 32,768 complete records per file and 256 retained diagnostic samples. Callers may lower these ceilings only. Existing 1 MiB line, 64 KiB read chunk and provider/store bounds also apply. Discovery is consumed as an async iterator, never materialized into a full source list. The coordinator stops on the first yielded entry beyond its budget, records DISCOVERY_LIMIT and closes the generator. Existing discovery does not charge each immediate symlink diagnostic to its internal node counter, so this separate yielded-entry budget bounds diagnostic-only directories as well. These are two separate ceilings, not a promise of exactly 4,096 filesystem operations. Maximum source outcomes and the identity-dedup set are bounded by 64. At most one source is being parsed or read from the store at a time.

The file ceilings bound observed file input to at most 1 GiB per run, plus small boundary rereads; this is not a measured time/RSS acceptance claim. Existing same-file reparsing remains intentional until durable parser recovery is implemented. Obtaining the original revision currently uses the existing bounded source read API, including its stored contribution data; this slice introduces no separate header-query optimization.

Paths remain local to discovery and ingestion. The returned envelope includes only keyed source IDs, stable-within-run safe aliases, fixed statuses/reasons/error codes, source revisions, actual provider capability summaries, counts and bounded safe diagnostic samples. Never include exception messages, raw provider text, tool output, buffers or filesystem metadata. Aliases are display labels, not persistent identities. Diagnostic sample truncation reports exact observed totals and dropped samples; it never silently changes coverage to complete.

## Source transactions and partial runs

Deduplicate keyed provider plus resolved file identities before reading a revision or ingesting. Different sources remain separate even if they share canonical execution IDs. Discovery rejects ambiguous provider roots and compressed inputs through existing safe diagnostics; no guess or decompression is added.

Read a source's original stored revision once, then pass that same revision (or null when absent) to one ingestion call. Never refresh or retry a stale result. Successful sources commit independently. Rejected/failed/stale files preserve their prior stored contribution according to the existing ingestion/store contracts. Do not mark undiscovered, missing, rejected or unreadable files unavailable, and do not delete history after a partial discovery.

Cancellation is observed before discovery, between iterator results and during the existing ingestion call. Stop starting sources after it is observed; preserve earlier committed sources. Filesystem discovery itself has no abort API, so immediate cancellation during an awaited directory operation is not promised. Breaking iteration closes its generator. An abort after a committed source does not relabel that source as failed.

The run status distinguishes completed traversal, partial processing and cancellation. Any discovery diagnostic, rejected/stale/failed source, or provider partial/limited coverage makes the summary partial. Completed traversal means the bounded traversal finished; `recognized_shapes` is never full provider coverage. Include per-status source counts and actual diagnostic totals. A budget stop has `discoveryTruncated: true`; count the one observed overflow entry but never ingest its source. Unvisited files and unknown future input are not included in those counts. A global storage/key failure stops further ingestion and returns a partial run with a fixed error code; individual file rejection may continue to the next source.

`aggregationReady` and `parserResumeReady` remain false. No token totals, duration totals, archive/fork resolution, observed-source completeness or whole-run atomicity is claimed.

## Implementation and Verify

1. Validate bounded explicit-root input and connect streaming discovery to serial ingestion.
   **Verify:** mixed providers, nested/duplicate roots, provider ambiguity, unsupported compression, count/directory/entry limits, identity dedup and privacy; no input enumeration on invalid/pre-aborted calls.
2. Preserve original per-source CAS and expose a bounded truthful run summary.
   **Verify:** real provider files, repeat/append/rewrite, failed file alongside committed files, no stale retry, preserved prior contributions, bounded diagnostics with exact dropped counts, unchanged storage-scope/capability flags and no aggregate/resume promotion.
3. Exercise interruptions and finish independent review plus repository checks.
   **Verify:** cancellation during ingestion and after a commit, closed discovery/file resources, fatal store failure stops new work, inert safe errors and strict ceilings. Run full typecheck/build/tests/artifact, independent coordinator review and exact-head CI after publication.

## Verification evidence

2026-10-01, Node 24.19.0 / Linux x64:

- PASS: final full `npm run check` on merged main `f051467037554f014d73733b0f8728c481da81f3`: typecheck, build and 349 tests across 17 files. This includes 26 new scan-coordinator tests and all 323 metric-storage baseline tests. An earlier independent event-only base also passed its existing suite before the merged-main recheck.
- PASS: 31-file packed artifact, isolated tarball npm-exec/global-install help/version and disabled install scripts. No package publication, merge or deployment was performed by this implementation contributor.
- PASS: real mixed-provider directories through SQLite; actual storage scope/capabilities compared with direct ingestion; normalized/nested-root dedup; repeat/append/stable-path replacement; committed files alongside a rejected file; no invented unavailable/deleted state.
- PASS: real-peer original-revision conflict without retry; actual SQLite write failure; actual installation-key mismatch stops subsequent ingestion while preserving all prior keyed sources; fixed safe errors contain no raw paths or synthetic log sentinels.
- PASS: pre-aborted calls perform no discovery/store read; cancellation inside the second real adapter retains the first commit; cancellation after commit does not relabel that source. Abandoned directories reject subsequent reads with `ERR_DIR_CLOSED`; interrupted source descriptors reject `stat` with `EBADF`.
- PASS: default 64-source ceiling, lowered directory/internal-node/file/record/line bounds, diagnostic sampling including a zero-sample budget, strict root/option validation and no getter execution. A symlink-only directory with a yielded-entry budget of two stops after its observed overflow diagnostic, records the limit, reports a partial/truncated result and closes the directory; unseen entries are not counted as completed discovery.
- PASS: both local documentation links resolve and `git diff --check` passes. Coordinator read-only review of the bounded source transactions, entry limits, CAS and truthful partial summaries found no blocking issue; final frozen-content review/publication remains with the coordinator.
- At the implementation handoff, macOS, exact published-head CI and full-history time/RSS acceptance had not run. The parent verification below adds supported-runtime evidence; full-history time/RSS acceptance remains unverified. There is no CLI/resume/cache/aggregate integration claim, and both readiness flags remain false.

### Supported-runtime parent verification — 2026-10-01

The parent reviewed all three published files at `609fbb4eb7742681de73fca47dadb3adabb08dd1`, including the test and documentation files excluded by OCR's deterministic selection. No additional actionable finding remained. Review also checked the existing discovery, source-prefix, ingestion and metric-store contracts on merged main.

- PASS: clean `npm ci --ignore-scripts` in an isolated macOS arm64 checkout and full `npm run check` on Node 24.15.0, 24.21.0 and 26.7.0. Each passed typecheck, build, 349 tests across 17 files and the 31-file artifact check, with isolated npm-exec/global-install help/version and installation scripts disabled.
- PASS: Node 22.16.0 returns `UNSUPPORTED_RUNTIME`, exit 2 and no stdout before importing the SQLite CLI implementation.
- PASS: repository documentation validation checked 31 Markdown documents, 224 local links and 23 anchors with no failures; `git diff --check` passed.
- The product and test files above are unchanged by this verification-document update. Final published-head CI, remote hashes and merge-tree equality are recorded in [PR #22](https://github.com/WhiteKiwi/agentprof/pull/22) and the P4 Project draft before the merge is treated as verified.

This evidence covers bounded sequential coordination on the metric-evidence store. Full P4 integration, durable recovery, CLI and full-history resource acceptance remain open; both readiness flags remain false.

The existing [ingestion contract](P4-INGESTION.md) and [source storage contract](P4-STORAGE.md) retain their own limits. Integration on the merged metric-evidence revision preserves its actual storage scope; subsequent API changes still require revalidation.
