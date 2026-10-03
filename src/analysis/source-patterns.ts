import type { StoredSource } from "../db/source-store.js";
import { analyzeSourceFailures } from "./source-failures.js";
import { buildPatternContext } from "./pattern-context.js";
import { analyzeEditValidation } from "./source-edit-validation.js";
import { evaluatePatternRules } from "./pattern-rules.js";
import { freezeOwned, lexical, measurePatternIntervals, TIMED_PATTERN_RULES, validatePatternPeriod } from "./pattern-intervals.js";
import type { PatternMembership, PatternPeriod, TimedPatternRule } from "./pattern-intervals.js";

/** One validated stored source generation. No input log access, state changes or provider-support promotion. */
export function analyzeSourcePatterns(source: StoredSource, period: PatternPeriod | null = null) {
  validatePatternPeriod(period);
  const native = analyzeSourceFailures(source), context = buildPatternContext(source, native);
  const editValidation = analyzeEditValidation(context), rules = evaluatePatternRules(context, editValidation, period);
  const membership: Record<TimedPatternRule, string[]> = { "retry-loop": [], "repeated-error": [], "context-churn": [] };
  for (const rule of TIMED_PATTERN_RULES) membership[rule] = [...new Set(rules.candidates.filter(c => c.ruleId === rule).flatMap(c => c.includedEventIds))].sort(lexical);
  const measured = native.suppressionReason === null
    ? measurePatternIntervals([...context.positions.values()].map(x => x.interval), membership satisfies PatternMembership, period) : null;
  const temporalIncomplete = context.sessions.some(s => s.temporalReasons.length > 0);
  const incomplete = native.assessment === "partial" || temporalIncomplete || context.positionExclusions.length > 0
    || rules.assessments.some(r => ["suppressed", "not_evaluable", "partial"].includes(r.status));
  const memberSets = new Map(TIMED_PATTERN_RULES.map(rule => [rule, new Set(membership[rule])]));
  const time = measured === null ? null : measured.map(p => {
    const perRule = { ...p.perRuleMs };
    for (const rule of TIMED_PATTERN_RULES) {
      const assessment = rules.assessments.find(r => r.ruleId === rule)!;
      if (["suppressed", "not_evaluable", "partial"].includes(assessment.status)
        && !p.contributingEventIds.some(id => memberSets.get(rule)!.has(id))) perRule[rule] = null;
    }
    return { ...p, perRuleMs: perRule,
      patternAssociatedMs: incomplete && p.contributingEventIds.length === 0 ? null : p.patternAssociatedMs,
      multipleRulesMs: incomplete ? null : p.multipleRulesMs,
      ruleOverlapExcessMs: incomplete ? null : p.ruleOverlapExcessMs,
      qualifiedSubsetOnly: incomplete };
  });
  return freezeOwned({ schema: "agentprof.source-patterns/v1" as const, scope: "source_prefix" as const,
    sourceId: source.sourceId, provider: source.provider, parserVersion: source.parserVersion, revision: source.revision,
    completedOffset: source.completedOffset, observedSize: source.observedSize, availability: source.availability,
    persistedScope: source.persistedScope, observationWindow: { unit: "source_bytes" as const, startInclusive: 0 as const, endExclusive: source.completedOffset },
    queryPeriod: period === null ? null : { startAt: new Date(period.startMs).toISOString(), endAt: new Date(period.endMs).toISOString(), bounds: "[start,end)" as const },
    sourceFreshnessChecked: false as const, crossSourceReconciled: false as const, aggregationReady: false as const,
    assessment: native.suppressionReason !== null ? "suppressed" : incomplete ? "partial" : "evaluated",
    suppressionReason: native.suppressionReason,
    coverage: { storedEventN: source.events.length, nativeTerminalN: native.suppressionReason === null ? native.eligibility.admittedTerminalCalls : null,
      positionedN: context.positions.size, positionExclusions: context.positionExclusions,
      unresolvedProvenanceN: native.provenance.unresolvedEvents },
    editValidation, rules: rules.assessments, candidates: rules.candidates, timePartitions: time,
    patternTimeMeaning: incomplete ? "observed_qualified_subset_not_full_total" : "observed_qualified_patterns_not_proven_avoidable",
    omittedDiagnoses: ["slow-tool: use existing insights", "exploration-thrashing: tracked separately in #50"],
    limitations: [
      "Four evidence-gated rule kernels, not completion of all six P5 diagnoses or empirical provider qualification.",
      "Ordinary adapters may lack error identity, complete content/change proof or validation scope; missing evidence is not efficient work.",
      "Edit-to-validation links are ordered observations in a stream context, not causal proof or changed-file/test coverage.",
      "Detected Waste means observed pattern-associated intervals, not avoidability, saved time or productivity.",
      "Time partitions never combine different sessions/scopes/evidence. Rule overlap excess is multiplicity-weighted, not concurrent wall time.",
      "Query bounds clip interval contributions; retry/context/validation qualification uses stored observation windows. Repeated Error uses the query population.",
      "Cycle counts and first-pass ratios describe the stored prefix, not a query-period population. No raw identities or input paths are exposed.",
    ],
  });
}
export type SourcePatternAnalysis = ReturnType<typeof analyzeSourcePatterns>;
