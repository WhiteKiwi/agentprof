# Provider pattern evidence capture

## Specification draft — 2026-10-04

Continue the owner's remaining-development request. Existing PR139 supplies a unified report, PR142 supplies usage timestamps/daily tokens, and PR145 supplies explicit missing/moved/restored source lifecycle. Do not duplicate those features. This successor targets the remaining gap between ordinary provider tool results and the already implemented evidence-gated pattern engine.

Preserve old parser modes and their persisted bytes. An explicit opt-in mode may capture additional raw-free error/content/change evidence under new parser/checkpoint versions. Only recognized source fields may qualify evidence: a command name, successful process exit, textual claim, file mtime or neighboring event is not proof of complete content, an actual edit, or full validation scope. Missing/ambiguous/truncated/contradictory evidence must remain unknown. Exact error equality is not common root cause; repeated content is not unnecessary work.

Read/error content must be fingerprinted within the adapter boundary with the installation identity context. Never persist raw strings, paths, source snippets or arbitrary metadata. Do not execute log content. Checkpoint restore must preserve the new evidence exactly and reject cross-version state. Existing diagnostic thresholds, token accounting, old source modes, unrelated report layouts and source-lifecycle behavior remain unchanged.

## Pre-code findings and research gate

The current normalized event already has errorFingerprint/contentFingerprint/contentState/changeState/validationScope fields. Ordinary checkpoints deliberately restrict unsupported fields to null/unknown. Simply filling those fields without version-isolated codecs and storage admission would violate the existing contract. Inspect the actual adapters, canonicalization, ordinary synthetic fixtures and strict codecs before finalizing captured field shapes. Unsupported provider semantics are not invented to meet a feature count.

Base: PR145 d62bb48bcea4c6f9b9d503c0c2ac1e890da86afa (on PR142/137). PR143 is actively reviewing the earlier evidence/history/report batch; do not edit its branches or reserved earlier feature implementations. PR50 exploration and broad P4/P6 acceptance ownership remain untouched.

## Implementation plan and Verify

1. Inspect source contracts and record supported field shapes and a final narrow capture contract before implementation. **Verify:** fixture provenance, complete/truncated/unknown meaning, exact fingerprint inputs, version matrix, checkpoint and store invariants; preserve current limitations where fields are absent.
2. Implement opt-in versioned capture and checkpoint/storage/scan routing, then exercise existing pattern consumers. **Verify:** old modes byte-identical; normal positive/negative/error/non-error/oversized/conflicting/replayed records; every LF split restore; cross-version rejection; rescan/append/mode switch; no raw leakage; thresholds unchanged.
3. Add actual synthetic scan/store/deleted-input, built/installed and full supported-runtime qualification. **Verify:** exact values/identities, native admission and pattern outputs, malformed state refusal, unchanged token/lifecycle behavior, actual counts/failures/skips and exact final-head CI. Maintain Draft and leave independent review/current-main integration/merge open.

## Work boundary

Owner: this ChatGPT continuation. No exposed runtime UUID or independent development/review subagent is invented; independent maintainer review remains required. One active implementation issue only. Branch feat/provider-pattern-evidence; separate derivative of the released PR145 implementation, not edits to PR142/145 or PR143's review branch.

Proposed reservation: new capture helpers/tests, adapter/version/codec/storage validation changes strictly necessary for the new capture mode, scan-only routing and this scoped plan. Preserve schema, existing metric formulas, old tests except demonstrably obsolete future-version sentinels, package/dependency versions and existing Foundation workflow.

A temporary branch-only, contents-read-only workflow may package the fixed repository source and pinned Node/development tooling into a short-retention artifact so this cloud session can inspect and test it despite unavailable outbound DNS. It must exclude .git, credentials, environment files and real user logs; it is removed from the final change. No production release or user-machine access. Any later publication uses an explicit reviewed delta and non-force branch updates.

## Execution record

Specification recorded before code. Research and implementation are not yet claimed complete; no test PASS is asserted. Directory-wide durable source membership, unsupported validation-scope semantics, real-user calibration, native browser/macOS and release acceptance remain separately qualified, not silently marked complete.
