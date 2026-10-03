# Provider pattern evidence — reviewed capture contract

## Decision before implementation — 2026-10-04

Refs #146 / PR147; extends P5-PROVIDER-PATTERN-EVIDENCE.md. Inspecting the actual adapters/codecs confirmed that error identity and complete content must be separate. The normalizer already accepts an explicit bounded error message without claiming complete output. Ordinary checkpoints currently forbid those identities. Existing patterns require exact native admission and never infer missing validation scope.

### Opt-in / compatibility

`scan --pattern-evidence` selects Codex3 or Claude4 and includes the existing usage-timestamp capture. Legacy default Codex1/Claude2 and `--usage-timing` Codex2/Claude3 remain byte-compatible. SDK capture options add an explicit boolean patternEvidence. New checkpoints carry an explicit evidence-policy version and exact new safe fields; old/new codecs cannot be interchanged by merely changing parserVersion. No DB schema/dependency changes. Rescanning without the option intentionally returns to the selected old mode through existing CAS/full-reparse rules. Explicit reconcile supports the same mode; fresh report commands do not implicitly enable it.

### Error identity

Capture a keyed, provider/class-specific identity of the exact observed error text, never a guessed root cause or complete process transcript. Admit only existing confirmed terminal error classification: Claude tool_result is_error=true, Codex MCP isError=true, or existing Codex semantic process-exit failure. No-match, change-detected, unknown, pending, cancelled and contradictory metadata remain non-errors. Preserve text-block boundaries; do not strip variable details or group unrelated errors using a fuzzy signature. Missing/empty/nontext/oversized (>64KiB UTF-8)/known-truncated content yields null. No complete content fingerprint is manufactured to enable an error signature. A new explanatory limitation describes exact observed error equality rather than proven identical causes.

### Claude structured file evidence

Only recognized ordinary 2.x versioned records with exactly one paired tool result may contribute structured root toolUseResult metadata. Deferred results retain only hashed evidence. A source-declared file path is hashed in the same project context and must match the actual Read/Edit/Write call before application.

- Text Read: require `type:text`, file.filePath/content/startLine/numLines/totalLines, finite consistent line bounds and complete counted text for that *returned range*. Reject truncation/non-text/oversize/malformed values. Preserve the explicit range, corresponding lookup identity and content hash. Complete returned range is not complete whole-file history. Reading alone does not establish changeState=unchanged; Context Churn stays unavailable when unchanged evidence is absent.
- Edit/Write: require a structurally valid, nonempty structuredPatch with exact old/new line counts and an observable differing addition/deletion, successful paired native completion, matching file identity and no conflict/background/truncation. Preserve only changeState=changed. Successful exit or human-readable success text alone does not establish a change.
- Validation scope remains unknown. Test/build command names and command arguments do not prove whole-project validation. No ordinary full-scope support is claimed.

Conflicting/reordered/replayed metadata must invalidate or preserve evidence under the existing deterministic authority rules; new root evidence participates in replay digests. New codecs enforce event/result/link consistency, exact keys, HMAC domains, bounded ranges and null/unknown invariants. Captured strings are never kept in checkpoints, output or diagnostics.

## Source evidence and limitations

Primary protocol: Anthropic tool-result documentation defines is_error and text/content blocks, and MCP defines isError with error content. These establish explicit error reporting, not complete command output: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools and https://modelcontextprotocol.io/specification/2025-06-18/server/tools . Claude hooks documentation distinguishes structured tool outputs from serialized model-visible results: https://code.claude.com/docs/en/hooks . Upstream reproducible issue40858 documents ordinary Edit failures as string results and successful structuredPatch/filePath/originalFile shape: https://github.com/anthropics/claude-code/issues/40858 . Read structure is a shape-qualified interface, not a universal provider guarantee; existing source parsing and synthetic controls must reject unfamiliar variants. No raw external transcript is copied into this repository.

OpenAI upstream command output has multiple persisted representations; do not treat truncated function_call_output as the entire process transcript. Existing command-status/transport admission remains authoritative, and new signatures explicitly concern only the observed text. No new FileChange event type or native admission expansion is introduced by this patch.

## Concrete verification

1. Pure extraction: exact keyed expected outputs; provider/code separation; string vs blocks; empty/whitespace/nontext/truncated/oversized/accessor/proxy/malformed metadata; Read line/path bounds and patch line counts; no raw retention.
2. Adapters/codecs: ordinary Codex/Claude positive errors, non-error negatives, reordered/conflicting results and single-result restriction; old modes deep-equal baseline; every LF checkpoint restore and old/new cross-version rejection; re-signed invalid evidence consistency rejection.
3. Real storage/CLI: full/unchanged/append/mode switches, both providers, native pattern consumers and raw-deleted queries, explicit lifecycle compatibility, option validation before bootstrap; full strict type/build/new tests, installed artifact and genuine historical seed in hosted Foundation. Record actual failures/NOT RUN rather than weaken gates.

The initial broader provider-evidence plan is narrowed to these source-supported fields. Unchanged-read proof, ordinary full-validation scope, directory-wide manifest, empirical usefulness and current-main integration remain uncompleted, not silently classified as QA.
