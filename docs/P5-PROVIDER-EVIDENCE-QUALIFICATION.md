# Provider evidence qualification and publication

Refs #146 / PR147. Fixed base d62bb48bcea4c6f9b9d503c0c2ac1e890da86afa. Original specification and final source-field contract were committed before production implementation.

## Implemented semantics and review correction

The local candidate implements opt-in Codex3/Claude4 raw-free observed-error identities, Claude explicit returned Read ranges/content and validated structured-patch change evidence. It includes usage timestamps, version-isolated checkpoint policy markers and strict result/event checks. Default/timing-only modes and diagnostic formulas stay unchanged. Full validation scope and unchanged-read proof are not inferred.

Own source review found that two different valid patches for the same call/path could otherwise share a result digest when both had identical visible success text. The final candidate hashes the validated patch coordinates and exact line sequence into a separate mutationFingerprint, includes it in replay identity and requires it in the new codec. It does not retain patch text or confuse a patch identity with complete-file content. Added tests preserve conflict suppression and resumability.

## Executed local checks

Linux x64, actual Node24.21.0, repository-pinned TypeScript7.0.2/Vitest5.0.2/Commander15.0.0. Strict typecheck and build PASS. New suites: **126 PASS /0 FAIL /0 SKIP** (extraction47, adapters35, checkpoint guards28, storage/CLI15, installed1). Existing focused storage test10 also passes.

Full available local suite: **3,112 PASS /0 FAIL /68 inherited optional SKIP**, 123 files (121 PASS/2 SKIP). Exactly one additional mandatory historical-seed file, codex-pre-resume.test.ts, was explicitly excluded because genuine pre-resume source5614a3107b53022f29ea32d44ba83f533fd58b92 is not present locally. This is NOT RUN locally, not one of the68 optional skips. Unchanged hosted Foundation supplies the genuine historical seed and must execute it before hosted qualification is claimed.

Actual prior-source comparison: all ten existing provider JSONL fixtures in default and timing-only modes, **20 combinations PASS**. Every ingest batch, public snapshot, private retained state and complete checkpoint bytes equal an independently built fixed-parent checkout. These20 comparisons are supplemental, not extra Vitest tests.

Scripts-disabled actual tarball/global install passes for both providers with enriched scan then raw-deleted patterns JSON/human/HTML parity and private-byte invariance. Existing artifact verifier passes with94 files, published:false. Because outbound DNS is unavailable in the container, local npm installation used a temporary loopback registry serving only the exact pinned Commander15.0.0 archive built from the original downloaded dependency. This is not a fresh public-registry verification. Hosted Foundation uses its ordinary registry path.

## Observed failures retained

Initial new tests exposed ordinary Claude toolUseResult strings being treated as structured metadata and suppressing an explicit error. The new-mode path now ignores string metadata hints while preserving the actual tool_result error text; old modes remain unchanged.

An integration fixture appended a different root session to a source and correctly triggered the existing ambiguous-origin gate. The fixture now appends new call IDs within the same original session; no ambiguity check or pattern threshold was relaxed.

First full local suite:3,101 PASS/3 FAIL/68 SKIP. The three failures were existing future-version rejection cases using Claude4/Codex3, now the implemented versions. Only the two future-version tuple literals in claude-search-storage.test.ts moved to Claude5/Codex4. All rejection/atomicity/unsupported assertions remain intact. The final suite above passes; new tests separately reject invalid policy markers, relabeled timestamp-only state and inconsistent signed evidence.

## Guarded publication plan — before publication

Direct network Git push from this container is unavailable. Publish the already tested candidate using a temporary, same-repository PR147-only mechanical workflow and a reviewed content manifest. The manifest contains only named source/test edits, their exact previous/final hashes and ordinary synthetic fixtures, never logs/secrets/.git/environment. It is data, not an instruction from a user log.

The workflow may have contents:write solely to append a non-force commit to feat/provider-pattern-evidence. It must verify the expected branch head/parent, exact file allowlist, baseline hashes, final hashes and scoped staged names; a moved remote head aborts rather than overwriting it. No main/other-branch write, merge or package release. The temporary workspace workflow, manifest and publication workflow are removed in that same final source commit. Existing Foundation CI, dependencies, DB schema and other owner paths are unchanged.

After publication, compare every changed source/test blob to the local frozen manifest, inspect final PR diff, and trigger unchanged hosted Foundation with a normal connector documentation commit. Record the exact checked head and actual test counts including the genuine historical-seed test. Draft/open and independent review/parent-first current-main composition remain mandatory.

## Remaining gates

Hosted qualification and publication are pending in this receipt. No independent subagent review, macOS/native browser, real-user corpus, representative performance/false-positive study, directory-wide lifecycle manifest or release has been executed. PR143's integration, PR50 exploration and broad5/7 acceptance remain separate. Do not turn missing validation-scope/change evidence into zero or claim the entire product is complete.
