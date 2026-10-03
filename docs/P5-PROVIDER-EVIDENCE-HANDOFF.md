# Provider pattern evidence — publication handoff

Refs #146 / PR147. Source commit: `29067161e189dfe879776ca490148a0cc718472a`, fixed parent feature PR145 `d62bb48bcea4c6f9b9d503c0c2ac1e890da86afa`. This is a Draft, not a main merge or package release.

## Published behavior

```sh
agentprof scan --codex-root ./codex-logs --claude-root ./claude-logs --pattern-evidence
agentprof patterns --source FULL_SOURCE_ID --output patterns.html
```

The new explicit capture selects Codex3/Claude4 and includes usage timestamps. Default Codex1/Claude2 and usage-only Codex2/Claude3 retain prior output/checkpoint bytes. SDK capture accepts patternEvidence:true. Explicit-file reconcile accepts the mode; fresh report flows do not silently opt in.

Confirmed ordinary errors retain an installation-keyed identity of their exact observed text, not an assertion of complete output, identical root cause or avoidable work. Empty, non-text, oversized, known-truncated, contradictory and non-error results do not manufacture error evidence. No-match/change-detected semantics remain intact.

Recognized single-result Claude2.x structured Read metadata may preserve a matching file identity, exact complete returned range and keyed content identity. This is not whole-file completeness or an unchanged-state proof. A successful, path-matched, fully counted nonempty structuredPatch may preserve a reported changed state. The private checkpoint keeps only a separate keyed patch identity, not the patch text; different valid patches conflict even with identical visible success text. No test command implies full-validation scope.

Codecs require exact version/policy markers, safe field vocabularies and event/result identity consistency. Re-labeled timestamp-only checkpoints, invented complete content/full scope and mismatched path/range/error identities are rejected. New captures resume from complete JSONL boundaries, preserve changed-file CAS behavior and continue to support explicit missing/restored source lifecycle.

## Executed source checks

- Local Node24.21.0/Linux strict typecheck and build PASS.
- New tests126/126 PASS, no new skips: extraction47 + adapters35 + signed checkpoint guards28 + actual store/CLI15 + installed1.
- Available local full suite3,112 PASS/0 FAIL/68 inherited conditional skips. One separate mandatory genuine pre-resume seed test was explicitly NOT RUN locally and is not included in those68 skips. Hosted Foundation supplies the exact historical seed unchanged.
- Independent fixed-parent build comparison20 combinations (10 existing provider fixtures × default/timing modes): every ingest batch, public snapshot, private retained state and exact serialized checkpoint bytes equal the parent.
- Actual scripts-disabled installed tarball runs both providers and raw-deleted patterns JSON/human/HTML with unchanged private bytes. Local network limitation and exact pinned loopback dependency mirror are disclosed in P5-PROVIDER-EVIDENCE-QUALIFICATION.md; not called fresh public-registry testing.
- Existing artifact verifier94 files PASS, published:false.

## Mechanical publication verification

[Run37143071574](https://github.com/WhiteKiwi/agentprof/actions/runs/37143071574) completed/success. It checked the expected parent and unchanged branch head, decoded only reviewed data, verified all30 old/final file hashes and exact changed-path allowlist, then ran strict typecheck/build and all126 new tests plus the existing10 storage cases before a non-force same-branch commit. It removed all11 temporary data fragments and both temporary workflows. No .git/credentials/user logs were included in the manifest or artifact. The existing Foundation workflow was not modified.

Reviewed manifest SHA256: `b9f420854d5cb884ff619d17c7400f415e40d282fadd8d52013f8add63e0d0d8`. Temporary staging-fragment mistakes were corrected before the publication job; its exact aggregate hash verification passed before any source application. No partial or placeholder fragment was applied to source.

This connector documentation commit triggers unchanged hosted Foundation on the complete published source. Its final results are pending at this receipt and will be recorded on PR147/issue146 after observation. Do not infer hosted success from local success or call the GitHub synthetic test merge an actual main merge.

## Ownership / remaining work

Independent maintainer review, parent-first composition with latest main and PR143's ongoing integration remain required. No independent development/review subagent was available or is claimed. Preserve PR50 exploration and broad5/7 acceptance.

Directory-wide automatic membership/deletion/move reconciliation remains separate from PR145's explicit-file lifecycle. Unchanged-read proof and generic full-validation scope remain unavailable unless the source proves them. Empirical provider qualification, representative performance/false-positive calibration, browser/macOS and release acceptance are not substituted by synthetic controls. Do not close broad parents or claim all remaining development is complete.
