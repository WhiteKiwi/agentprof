# Bounded large-directory enrollment

## Specification — 2026-10-04, before implementation

Add explicit `scan --enroll-directory --batch-directory` for one provider/root. The legacy no-flag 64-source path remains unchanged. The opt-in path inventories at most 4,096 selected JSONL files, 256 directories and 16,384 total entries; it processes a sorted complete inventory through the existing scanner in pages of at most 16 explicit file roots. Existing per-file/parser limits remain unchanged. The full inventory and physical directory identities are checked before and after all pages. Only a complete successful collection may atomically replace the root membership with original-revision CAS. Per-source commits from earlier pages remain on interruption/failure; incomplete pages never mark absent members. Captured warnings remain partial rather than becoming success.

The same explicit flag may combine with `--retire-missing`; its independent post-enrollment census uses the same expanded finite bounds. All existing root/source revision, authenticated cross-root veto, retained history, rollback, restoration and root-binding guards remain authoritative. No schema or provider-parser changes, background watcher, persistent pagination cursor, inferred move identity, ownership transfer, bootstrap repair, source-history deletion or performance claim.

## Findings and design review

The inherited census refuses its 65th JSONL file. Simply raising SCAN_LIMITS would change the default scan and still leave capture's 64-observation ceiling. scanSources accepts at most 16 explicit roots; each page can reuse that scanner without raising any ordinary scan limit. Membership persistence already authenticates up to 4,096 members/1 MiB. Add a separately named complete-batch capture entrypoint sharing the existing validation/CAS/seal transaction, while preserving the legacy capture ceiling. Merge page receipts with globally unique source aliases, bounded diagnostic samples and exact omitted counts. Do not call capture between pages. A new final source generation must fail the original source-revision gate, not be replaced with a convenient newer one.

Base: PR163 d0931a53600d2127d551597627b2bee821f26dc3. Rebind/maintenance/retirement and current maintainer integration are separate; do not write their branches or shared help-comparison tests. This environment provides no separate collaboration agent or runtime session UUID. Single-session implementation/self-review is not independent maintainer approval.

## Implementation plan and Verify

1. Add a bounded opt-in census and complete-batch membership capture while retaining default limits. Verify legacy 64/65 behavior, expanded 4,096/4,097 bounds, unrelated entry/directory limits, no symlinks/compression, complete source-revision/authentication/atomic rollback controls.
2. Add serial scanner-page coordination and enrollment selection. Verify real Codex/Claude inputs beyond 64, all capture modes, deterministic aliases and diagnostics, repeat/remove/reappear, page rejection/abort/filesystem change/source or membership race, and no partial membership commit.
3. Wire strict opt-in CLI and retirement census selection. Verify missing enrollment, duplicate/value/mixed flags fail before I/O; legacy outputs remain unchanged except exact new help; full bounded JSON/human counts and cross-root vetoes persist.
4. Run focused tests, typecheck/build, available full regression and installed/artifact checks; publish a Draft. Verify actual result counts, keep failures/skips/NOT RUN distinctions, exact remote source equality and hosted CI state. Dependency integration/independent review and actual merge remain separate. No main merge/release or parent #5 closure.

All new implementation/tests are NOT RUN at this planning revision. Temporary immutable source transport, if used, will be removed before the final Draft diff.

## Pre-code scope amendment

The retirement proof parser also has a separate 64-ID ceiling. Include `src/db/directory-retirement.ts` only for a separately named batch entrypoint sharing the existing authenticated transaction with a 4,096-ID validation ceiling. Preserve the ordinary 64-ID entrypoint and transaction behavior. Verify both limits and cross-root vetoes with more than64 observed members. This amendment precedes production changes and is recorded on issue165.


## Maintainer compatibility specification — 2026-10-04

Original PR166e1c2fdf4d70068dbcf7c953f21d985b99d55391c adds only the explicit bounded batch feature on its authored predecessor. Ordered actual-main composition0459e485069c242023e2939b551c0aaaca416901 preserves all12 original paths, production8 and45 feature cases, and499 unowned main objects/modes. Root owns only165 and additive planning/review/publication; the separate164 actual-main owner does not reserve this source. Existing author plan/results above are dated history, not the live roster.

The retained genuine-D1 scan-help comparator must accept exactly the batch option111 UTF-8 bytes/two lines and terminal batch footer154 bytes/one line, together265 bytes. Current help requires the exact batch regions once in their intended Options and warning/notes/footer context; helpWidth80, continuation padding22, enrollment then retirement then batch then help order and terminal batch footer remain fixed. Historical D1 contains none of the batch region/flag/description/footer-family markers. The complete remaining status/stdout/stderr must still pass the unchanged enrollment307/retirement308/total615 boundary. No permissive old-current fallback or general help normalization is allowed.

Preserve the genuine inert D1 fixture and its complete source/tree/134-file manifest/bootstrap/CLI context/Commander/hash/length metadata. Preserve all156 legacy test identities,141 original mutation inputs and52 retirement controls. Only narrowly update now-nonexistent adjacency/removal anchors so each vector changes the intended enrollment/retirement region, proves a non-noop, and preserves the batch regions. New separate batch guards cover its exact contract, malformed receipts/accessors/proxies without traps, duplicate/missing/context/placement/order/wrapping/width/padding/CRLF/partial/unknown-option/provider/privacy/full-residual drift, frozen input preservation and rejection of batch markers in historical help. This changes test-only comparison logic; original production and45 feature tests remain untouched.

One parent-scheduled local batch establishes original45 and616 retained cases; failures/skips stay recorded. After separate source/actual-receipt FINDINGS and parent-reviewed IMPLEMENTATION/issue Verify, a separately registered developer implements scoped help tests, reports inventory, and runs one scheduled correction batch plus full genuine built/installed receipts. Reuse already-PASS original45 and unaffected cases without repeating the expensive4096-file path; reconcile repeated file/fullName/one-based occurrence identities once. Specifically named unavailable native14 freezes remain NOTRUN with no aliases. Source/full hosted and actual-main four-job qualification remain separate; close only165, keep broad5 open, and retain all original author history and limits.

Actual initial selected661:656PASS/5FAIL/0SKIP. All45 original batch cases passed including4096-file/256-page. Failures are exactly the genuine help positive comparator and four non-noop assertions using now-obsolete E+R+H/R+H anchors. Source typecheck/build, actual146 compiled/148 artifact and built/installed full-help parity passed. Full remaining strict615 comparison is not yet reached by the failed positive case. Preserve this immutable failing JSON and all five failures; no production or original batch-test correction is inferred.
