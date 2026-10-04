# Explicit directory enrollment CLI

## Specification — 2026-10-04

Expose the authenticated directory observations implemented in PR153 through `agentprof scan --enroll-directory --codex-root DIR` or the analogous Claude root. Exactly one explicit root and one provider are required. Ordinary scan and file-only `--reconcile` remain unchanged; mixing these two opt-in modes is invalid. Existing `--usage-timing` and `--pattern-evidence` capture semantics remain unchanged. No default provider roots, watcher, reset, retirement, relocation inference or automatic deletion is introduced.

A complete successful enrollment reports its exact membership revision, full bounded source IDs with observed/not_observed and last-observed source revisions, and counts computed before human display truncation. Physical-root fingerprint, seal, installation key material, raw paths/file names and raw logs never appear. A subsequent source query still explicitly chooses a source ID. Not observed means absent from this successful census, not proven deleted or unavailable. Stored source data and checkpoints are never removed by this CLI.

Argument errors are rejected before storage/identity bootstrap. The explicitly selected root must pass the existing directory safety preflight before creating a data directory. A missing root, file, symlink, unsupported input or failed preflight does not create storage. Root/census/source checks performed by the enrollment API remain authoritative after preflight; the CLI does not substitute metadata guesses. Interrupted or incomplete collection cannot be described as completed membership. Earlier successful per-source commits may remain when enrollment later fails.

Exit codes: 0 only for committed/unchanged membership and completed scan; 1 for incomplete/stale/ineligible membership or scan warnings; 130 for interruption; 2 for existing safe argument/storage errors. SIGINT listeners are removed in finally. JSON preserves the enrollment receipt and explicit status, not a human string. A post-capture membership read must match the exact committed/reused membership revision and count; a mismatch is reported as stale with no substituted snapshot.

## Findings and dependency boundary

Reviewed AGENTS.md, SPEC.md, IMPLEMENTATION.md, TODO.md, live issue5 and PR153. At planning time PR153 head is d14cce6647ebb8456af6f768405ad5d211e37074. Its owner is composing current main without reserving CLI/main.ts. Its five production modules and schema corrections are read-only dependencies for this child. PR154 is a separate report-only feature.

`enrollDirectory` validates complete before/after census, directory identity, exact scanner receipts and original-revision CAS. Its receipt intentionally says membershipCaptureChangesSourceAvailability:false, because normal scanner commits may restore unavailable source data. Membership store read owns a synchronous transaction and therefore cannot be nested in withReadOnlyStore. This CLI will not add a misleading read-only status mode by opening a writable database or weakening that transaction guard. A public snapshot after enrollment is obtained synchronously and admitted only if its revision matches the native receipt.

Shared SPEC/FINDINGS/IMPLEMENTATION/ACCEPTANCE files remain reserved by the prerequisite owner. This scoped document preserves the specification, source findings and implementation plan without overwriting those files. Current continuation uses one isolated container; no separate collaboration agent or runtime UUID is exposed, so independent sub-session review is not claimed. Independent maintainer review remains a publication/merge gate.

## Reviewed implementation plan

1. Add opt-in `--enroll-directory` within the existing scan command and lazily select the new CLI adapter. Verify: duplicate/value/mixed flags, excess arguments, zero/multiple roots and bad capture values fail before storage; old scan/help behavior changes only by additive documented option/help lines.
2. Implement validation, root preflight, abort/cleanup and exact native enrollment consumption in a new CLI module. Verify: actual one-directory scanner for both providers and capture modes; complete/partial/ineligible/stale/aborted result and exit mapping; no bootstrap on failed preflight; old successful source commits remain visible after later enrollment rejection.
3. Project bounded authenticated membership into JSON/human output. Verify: exact revision/count match, observed/not_observed/reappear, full JSON under 8 MiB, human <=32 KiB with explicit shown/omitted counts, no physical identity/seal/raw paths and no inferred deletion/moves.
4. Qualify and publish a stacked Draft. Verify: new focused tests, strict typecheck/build, supported full regression and script-disabled installed-package CLI, source/test blob equality and exact-head hosted checks. Retain any failed/skipped/not-run evidence. No prerequisite/main branch writes, automatic merge, release or broad P4 closure.

## Reserved delta and transport

Only new src/cli/directory-scan.ts, enrollment-only scan option/help/dispatch hunks in src/cli/main.ts, new tests/directory-scan.test.ts and tests/directory-scan-cli.test.ts, this scoped document and an optional scoped verification document. Existing tests, DB/scanner APIs, parser, reports, dependencies and permanent workflows are unchanged. Base is PR153 and merge order is prerequisite then this child; main composition belongs to the prerequisite owner.

Because container DNS cannot reach GitHub, a temporary branch-only read-permission snapshot workflow exports git-tracked prerequisite source and the authentic historical schema5 seed. It does not export credentials, .git or user inputs. It will be removed before Draft publication. Source publication uses connector Git objects/contents or a strictly hash-checked branch-only patch if required; no force pushes or upstream changes.

## Remaining independent work

Automatic directory deletion/move reconciliation requires explicit ownership and stale-source safeguards beyond an absence observation. CLI enrollment completes a user-accessible prerequisite, not that destructive/ambiguous follow-up. Real-user accuracy/performance, native OS/browser acceptance, licensing and package release remain separate.


## Maintainer historical-help specification — before test code

Actual154/main61652839e7a1f91f02d0a9d8e6f6bf1411ab6b10 and original156f790113be47683ae691439eb592e3410ee166313 compose at622d74402ff276c6b149c20f94a8e95ee5ac95a8. All469 incoming-main paths outside the original6 are unchanged. All6 original paths are manually reviewed. New75 and retained whole usage-timing36 PASS/0FAIL/0SKIP, strict typecheck/build and139 compiled-file/141 packed-file normal-registry installed artifact pass. These111 selected cases are not a full local run. Original author4635PASS/138conditional and this selected receipt are distinct.

An actual installed genuineD1 pre-enrollment binary at source d1b84f166eb33f11d5b7a22ca407dbf14226fd24 with real Commander15 context was invoked outside the checkout, alongside current built and actual installed candidate. All return0/empty stderr. Old versus current scan-help full stdout differs, and current built versus installed is exact. This is a separate executed help-boundary reproduction, not an executed failure count for nine conditional old suites. The exact intentional delta is one option block wrapping to two physical lines at default80 columns, followed by two literal explanatory lines (four physical lines / three logical additions). No old padding or any other bytes change.

Only a shared test helper, its unconditional genuine-help/negative-control suite and inert authenticated D1 scan-help fixture/provenance, plus scan-only callsite updates in nine independently identified retained conditional historical test files may change. The complete old stdout/status/stderr and all old named baseline conditions, original feature-specific insights/stats/top/open/report normalization, private DB/key/migration/refusal/replay controls and case names must remain. Production/scanner/schema/report/dependencies/workflows/shared maintained documents remain exact. None of the14 unavailable named historical freezes may be synthesized or aliased to D1; they remain NOT RUN. The inert D1 supplement qualifies only this narrow immediate-prerequisite help delta.

The helper must require genuine old help to contain no enrollment additions and current help to contain exactly one complete literal option block immediately before the existing help row, plus exactly one of each literal explanatory line at the final documented suffix. Remove only these exact bytes and compare the full remaining stdout and unchanged successful exit/empty stderr. Reject missing, duplicate, typo, wrong position or spacing, arbitrary extra help changes, changed old input, status/stderr drift and malformed receipts. Candidate built and actual normal-registry installed help must both pass the same boundary. No generalized line or whitespace normalization. Future158 retirement and160 directory-command help require separate exact-prefix contracts/plans; neither is permitted here.

SPEC is recorded now. Independent separate source/help findings and reviewed bounded implementation/concrete issue Verify with a separately registered developer/readback/GO are required before test implementation. Retain all original failure/skip/nonrun provenance. Final exact-source Foundation4+GitGuardian, actual-oldest/latest-main merge and actual-main4PASS remain gates for own155; broad5 stays open.
