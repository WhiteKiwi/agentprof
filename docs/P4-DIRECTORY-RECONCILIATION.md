# Guarded directory absence reconciliation

## Specification — 2026-10-04

Continue the owner's authorized remaining development after PR153 and PR156. Opt-in `scan --enroll-directory --retire-missing` collects one explicit provider directory using the unchanged enrollment API, then reconciles missing historical members. Without `--retire-missing`, existing scan/enrollment behavior and output remain unchanged.

A complete new census and unchanged physical root are required. Missing/inaccessible/replaced roots, symlinks, compressed entries, incomplete discovery, changed membership or stale source revisions cannot authorize retirement. A missing member is marked unavailable, not deleted; events, metrics and relationships remain stored. The existing retirement policy invalidates obsolete cache/checkpoints. A source still observed by any other authenticated root is retained conservatively, even when that other observation may be old. Rescan that root explicitly before retrying. Root memberships remain observations, not exclusive ownership.

Moving a log creates a new path-based source identity. Reconciliation collects the new path and may retire the absent old identity; it does not assert a move relation, merge identities, or override the existing history copy/conflict rules. No automatic physical deletion, pruning, registry release, main merge, or real-user-log upload.

## Findings and boundaries

- PR153's membership seal authenticates root/provider/physical identity/revision and the entire sorted member manifest. `not_observed` alone currently does not change source availability.
- PR156 already provides complete preflight, mode validation, enrollment, same-version receipts and bounded human/JSON output. Reuse that path instead of adding another standalone stats view.
- Existing source retirement increments revision and deletes only cache/checkpoint rows. Its public API owns its own transaction, so a narrow internal transaction-bound method is needed to compose membership checks and source changes atomically.
- Public source ingestion reads must retain their fresh-snapshot restriction. New mutation-only reads/retirement operate inside a caller-owned write transaction and reuse the existing authenticated source reader.
- Cross-root decisions must not consult an unverified subset of membership rows. Authenticate all bounded roots under the same write transaction. Refuse over-budget or orphaned/corrupt catalogues rather than silently dropping vetoes.
- Filesystem census and SQLite cannot be one atomic transaction. Require trusted stable ancestors, repeat census and root checks, and document this residual race. Do not claim external-anchor protection against complete valid-record deletion/replay.

## Reviewed implementation order and Verify

1. Add transaction-bound authenticated membership/source helpers, preserving existing APIs. **Verify:** caller transaction requirement, valid seals, corrupt/orphan rows, wrong keys, root/member bounds, old APIs unchanged.
2. Add a guarded atomic retirement batch and filesystem coordinator. **Verify:** complete census, root identity, current membership revision and observed source revisions, stale missing revisions retained, other-root observed veto, repeat idempotence, restoration/move paths and rollback on errors/abort.
3. Extend only enrollment CLI with `--retire-missing`. **Verify:** requires enrollment, duplicates/value suffixes/mixed modes rejected before I/O, capture flags preserved, exact no-flag output, structured per-member outcomes and bounded human omissions.
4. Qualify source/CLI/installed integration and publish Draft. **Verify:** synthetic both-provider tests, typecheck/build, focused/full regression and artifact checks as available; exact published blobs and CI recorded separately. Keep original failures/skips and unrun platform/pilot gates explicit.

## Scope and execution

Base: PR156 head `f790113be47683ae691439eb592e3410ee166313`; PR153 is its prerequisite. Reserve source-store and directory-membership transaction-helper hunks, new db/scanner retirement modules, retirement-only directory-scan/main CLI hunks, new focused tests and this scoped contract/verification record. No existing test, parser, metrics/report, schema, dependency or permanent CI changes. Parent #5 remains open. Independent maintainer review and dependency-order merge remain required.

Execution: current ChatGPT session in an isolated container. Separate collaboration-agent and runtime UUID facilities are unavailable; no independent research/development/review sessions are claimed. The plan is self-reviewed for transaction ownership, stale-read and cross-root-veto behavior before implementation. All new tests are NOT RUN at this pre-code checkpoint. Temporary source-only transport, if required by container network restrictions, is removed from the final tree.


## 2026-10-04 maintainer compatibility specification — before test-helper edits

Refs #157; actual156/main bbf0668cfca916a5adb8dcbbbafbc54bf5add132 is the integration base. Original source f58a6b43478fefcd8261ab617c023e61f9e5ea80 and all45 new controls remain unchanged; broad #5 remains open. The original plan/source qualification and all historical limits stay above. Root owns only157, reserves these two scoped planning/evidence docs and publication; the155 actual-main CI owner owns its separate final readback.

The shared scan-help compatibility helper from156 now encounters the intended explicit --retire-missing option and explanatory footer. Accept only these exact current-built/installed retirement additions after independently confirming full authentic156/D1 receipts, Commander context, physical line count, byte delta and insertion positions. Preserve the existing enrollment option/two-note checks, complete other stdout/status/stderr and genuine full-context D1 fixture. Every old enrollment drift/malformed/immutability/provenance guard must remain active. The nine existing historical call sites and their named conditions/non-scan/private assertions remain exact; fourteen unavailable older native freezes are NOT RUN. No future directory-command allowance, generic line/whitespace stripping or conditional baseline alias is allowed.

The developer may extend only tests/scan-help-compatibility.ts and tests/scan-help-compatibility.test.ts after separate source/receipt research FINDINGS, root's reviewed IMPLEMENTATION with concrete Verify and exact issue/developer claim/readback/GO. Add falsifiable missing/duplicate/typo/wrap/padding/order/placement/footer/unrelated drift and malformed/immutable receipt controls against actual compiled and actual normal-registry installed output. Do not modify production, original45 feature tests, fixture provenance, dependencies, shared maintained docs or scanner/store semantics. Current tests/installation and final source/actual-main gates must be recorded from actual terminal receipts, keeping initial failures and focused/full/source/main counts separate.
