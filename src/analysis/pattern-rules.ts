import type { NormalizedEvent } from "../normalize/types.js";
import type { PatternContext, PositionedPatternEvent } from "./pattern-context.js";
import { isEdit, isLookup } from "./pattern-context.js";
import type { EditValidationAnalysis } from "./source-edit-validation.js";
import { freezeOwned, lexical } from "./pattern-intervals.js";
import type { PatternPeriod } from "./pattern-intervals.js";

export const PATTERN_RULES = ["retry-loop", "repeated-error", "context-churn", "validation-thrashing"] as const;
export type PatternRuleId = typeof PATTERN_RULES[number];
export type PatternWitness = Readonly<{ firstEventId: string; lastEventId: string; startMs: number; endMs: number; count: number }>;
export type PatternCandidate = Readonly<{
  id: string; ruleId: PatternRuleId; ruleVersion: "source-pattern-evidence-v1"; severity: "INFO" | "NOTICE";
  sessionIds: readonly string[]; occurrences: number; relatedCycleIds: readonly string[];
  evidenceEventIds: readonly string[]; includedEventIds: readonly string[];
  evidenceObservationIds: readonly string[]; windowWitnesses: readonly PatternWitness[];
  timedContributionN: number; untimedContributionEventIds: readonly string[];
  necessaryWorkCounterexample: string; investigativeAction: string; matchedExperiment: string; qualityGuardrail: string;
  avoidability: "unestablished"; rootCause: "unestablished"; improvement: "not_measured";
}>;
export type PatternRuleAssessment = Readonly<{
  ruleId: PatternRuleId; version: "source-pattern-evidence-v1";
  thresholds: Readonly<{ minimumOccurrences: number; windowMs: number | null; minimumSessions: number }>;
  status: "suppressed" | "not_evaluable" | "partial" | "candidates" | "no_candidate";
  eligibleEventN: number; missingEvidenceEventIds: readonly string[]; blockedSessionIds: readonly string[];
  candidateIds: readonly string[]; reasons: readonly string[];
}>;
export type PatternRuleResult = Readonly<{ assessments: readonly PatternRuleAssessment[]; candidates: readonly PatternCandidate[] }>;
const guidances: Record<PatternRuleId, readonly [string, string]> = {
  "retry-loop": ["Repeated attempts can be required while an external dependency recovers.", "Check the shared operation's prerequisites before the next narrowly scoped retry."],
  "repeated-error": ["The same error can arise independently in otherwise necessary work; exact identity is not root cause.", "Inspect common setup and bootstrap requirements for the affected streams."],
  "context-churn": ["Re-reading unchanged evidence can be necessary for review, verification or working-memory refresh.", "Try one concise module note or lookup entry point without forbidding necessary rereads."],
  "validation-thrashing": ["Repeated validation may be required by regression, security or release gates.", "Evaluate a targeted-first order only where the recorded validation scope supports it."],
};
const thresholds = (rule: PatternRuleId) => ({ minimumOccurrences: rule === "context-churn" ? 4 : 3,
  windowMs: rule === "repeated-error" ? null : rule === "validation-thrashing" ? 900_000 : 600_000,
  minimumSessions: rule === "repeated-error" ? 2 : 1 });

/** Coalesce overlapping qualifying windows, retaining a linear-size witness list. */
function episodes(rows: readonly PositionedPatternEvent[], n: number, windowMs: number) {
  const result: { first: number; last: number; witnesses: PatternWitness[] }[] = [];
  let left = 0;
  for (let right = 0; right < rows.length; right++) {
    const end = rows[right]!.interval.endMs;
    while (left < right && end - rows[left]!.interval.endMs > windowMs) left++;
    if (right - left + 1 < n) continue;
    const witness: PatternWitness = { firstEventId: rows[left]!.event.id, lastEventId: rows[right]!.event.id,
      startMs: rows[left]!.interval.endMs, endMs: end, count: right - left + 1 };
    const previous = result[result.length - 1];
    if (previous !== undefined && left <= previous.last) { previous.last = right; previous.witnesses.push(witness); }
    else result.push({ first: left, last: right, witnesses: [witness] });
  }
  return result;
}
function groupRows<T extends { event: NormalizedEvent }>(rows: readonly T[], key: (e: NormalizedEvent) => string) {
  const groups = new Map<string, T[]>();
  for (const x of rows) { const k = key(x.event), bucket = groups.get(k); if (bucket) bucket.push(x); else groups.set(k, [x]); }
  return [...groups.values()].sort((a, b) => lexical(a[0]!.event.id, b[0]!.event.id));
}

/** Positive rules require their stored evidence. Missing identities are never synthesized from display strings. */
export function evaluatePatternRules(context: PatternContext, cycles: EditValidationAnalysis, period: PatternPeriod | null): PatternRuleResult {
  const candidates: PatternCandidate[] = [], assessments: PatternRuleAssessment[] = [];
  const native = context.native;
  const validationsBySession = new Map<string, string[]>();
  const cycleByValidation = new Map<string, string>();
  for (const cycle of cycles.cycles) {
    for (const id of cycle.validationEventIds) cycleByValidation.set(id, cycle.id);
    const rows = validationsBySession.get(cycle.sessionId);
    if (rows) rows.push(...cycle.validationEventIds); else validationsBySession.set(cycle.sessionId, [...cycle.validationEventIds]);
  }
  const partialSource = native.capabilities?.coverage !== "recognized_shapes" || (native.capabilities?.unsupportedRecords ?? 0) > 0
    || native.provenance.unresolvedEvents > 0;
  for (const rule of PATTERN_RULES) {
    const missing = new Set<string>(), blocked = new Set<string>(), reasons = new Set<string>(), eligible = new Set<string>();
    const ids: string[] = [];
    type EvidenceEvent = Readonly<{ event: NormalizedEvent; proofIds: readonly string[] }>;
    const emit = (rows: readonly EvidenceEvent[], included: readonly EvidenceEvent[], witnesses: readonly PatternWitness[]) => {
      const allIds = rows.map(x => x.event.id), id = `pattern-${candidates.length + 1}`, guidance = guidances[rule];
      candidates.push({ id, ruleId: rule, ruleVersion: "source-pattern-evidence-v1", severity: rule === "validation-thrashing" ? "INFO" : "NOTICE",
        sessionIds: [...new Set(rows.map(x => x.event.sessionId))].sort(lexical), occurrences: rows.length,
        relatedCycleIds: rule === "validation-thrashing" ? [...new Set(allIds.flatMap(id => { const cycle = cycleByValidation.get(id); return cycle === undefined ? [] : [cycle]; }))].sort(lexical) : [],
        evidenceEventIds: allIds, includedEventIds: included.map(x => x.event.id),
        timedContributionN: included.filter(x => context.positions.has(x.event.id)).length,
        untimedContributionEventIds: included.filter(x => !context.positions.has(x.event.id)).map(x => x.event.id),
        evidenceObservationIds: [...new Set(rows.flatMap(x => x.proofIds))].sort(lexical), windowWitnesses: [...witnesses],
        necessaryWorkCounterexample: guidance[0], investigativeAction: guidance[1],
        matchedExperiment: "Change one prerequisite or workflow choice; repeat comparable tasks and record counts, observed time and outcome, including no effect, worse results and incomparable trials.",
        qualityGuardrail: "Preserve required evidence, full regression/security/build gates and defect detection. Include follow-up retries and refetches; do not trade correctness for fewer calls.",
        avoidability: "unestablished", rootCause: "unestablished", improvement: "not_measured" });
      ids.push(id);
    };
    const emitEpisodes = (rows: readonly PositionedPatternEvent[], firstContributes: boolean, windowMs: number, minimum: number) => {
      for (const episode of episodes(rows, minimum, windowMs)) {
        const evidence = rows.slice(episode.first, episode.last + 1);
        emit(evidence, rule === "validation-thrashing" ? [] : firstContributes ? evidence : evidence.slice(1), episode.witnesses);
      }
    };
    if (native.suppressionReason !== null) reasons.add(native.suppressionReason);
    else if (rule === "repeated-error") {
      const population: EvidenceEvent[] = [];
      for (const e of context.admitted) {
        if (e.status !== "failed" || e.executionOutcome !== "error") continue;
        const p = context.positions.get(e.id);
        if (e.errorFingerprint === null) { missing.add(e.id); reasons.add("missing_error_identity"); continue; }
        // Without a query, missing timing must not erase a confirmed occurrence. With a query, population membership needs a start.
        if (period !== null) {
          if (p === undefined) { missing.add(e.id); reasons.add("unpositioned_query_population"); continue; }
          if (p.interval.startMs < period.startMs || p.interval.startMs >= period.endMs) continue;
        }
        if (p === undefined) { missing.add(e.id); reasons.add("untimed_confirmed_occurrence"); }
        population.push({ event: e, proofIds: context.proofIdsByEvent.get(e.id) ?? [] }); eligible.add(e.id);
      }
      population.sort((a, b) => lexical(a.event.id, b.event.id));
      for (const rows of groupRows(population, e => JSON.stringify([e.errorClass, e.errorFingerprint]))) {
        if (rows.length >= 3 && new Set(rows.map(x => x.event.sessionId)).size >= 2) emit(rows, rows, []);
      }
    } else {
      for (const session of context.sessions) {
        if (session.temporalReasons.length) { blocked.add(session.sessionId); for (const reason of session.temporalReasons) reasons.add(reason); continue; }
        if (rule === "retry-loop") {
          const attempts = session.ordered.filter(x => x.event.kind === "shell" || x.event.kind === "mcp");
          const known = attempts.filter(x => {
            if (x.event.operationKey === null || x.event.turnId === null) { missing.add(x.event.id); return false; }
            return true;
          });
          // An unassigned attempt could belong to any operation; do not bridge it with a convenient subset.
          if (known.length !== attempts.length) { reasons.add("missing_operation_or_turn_identity"); blocked.add(session.sessionId); continue; }
          for (const rows of groupRows(known, e => JSON.stringify([e.turnId, e.operationKey]))) {
            if (new Set(rows.map(x => JSON.stringify([x.event.kind, x.event.category, x.event.toolName]))).size !== 1) {
              for (const x of rows) missing.add(x.event.id); reasons.add("inconsistent_operation_class"); continue;
            }
            let run: PositionedPatternEvent[] = [], error: string | null = null;
            const flush = () => { emitEpisodes(run, true, 600_000, 3); run = []; error = null; };
            for (const x of rows) {
              const e = x.event;
              if (e.status !== "failed" || e.executionOutcome !== "error") { flush(); continue; }
              if (e.errorFingerprint === null) { flush(); missing.add(e.id); reasons.add("missing_error_identity"); continue; }
              const identity = JSON.stringify([e.errorClass, e.errorFingerprint]);
              if (error !== null && error !== identity) flush();
              error = identity; run.push(x); eligible.add(e.id);
            }
            flush();
          }
        } else if (rule === "context-churn") {
          let epoch = 0;
          const groups = new Map<string, PositionedPatternEvent[]>();
          for (const x of session.ordered) {
            const e = x.event;
            if (isEdit(e)) { epoch++; continue; }
            if (!isLookup(e)) continue;
            if (e.status !== "completed" || e.executionOutcome !== "success" || e.lookupKey === null
              || e.contentFingerprint === null || e.contentState !== "complete" || e.changeState !== "unchanged"
              || e.kind === "file_read" && e.lookupRange === null) {
              epoch++; missing.add(e.id); continue;
            }
            const key = JSON.stringify([epoch, e.turnId, e.lookupKey, e.lookupRange, e.contentFingerprint]);
            const rows = groups.get(key); if (rows) rows.push(x); else groups.set(key, [x]);
            eligible.add(e.id);
          }
          for (const rows of [...groups.values()].sort((a, b) => lexical(a[0]!.event.id, b[0]!.event.id))) emitEpisodes(rows, false, 600_000, 4);
          if (missing.size) reasons.add("missing_complete_unchanged_lookup_evidence");
        } else {
          const byId = new Map(session.ordered.map(x => [x.event.id, x]));
          const associated = validationsBySession.get(session.sessionId) ?? [];
          const known: PositionedPatternEvent[] = [];
          for (const id of associated) {
            const x = byId.get(id);
            if (x === undefined || x.event.validationScope === "unknown") { missing.add(id); continue; }
            known.push(x); eligible.add(id);
          }
          known.sort((a, b) => a.interval.endMs - b.interval.endMs || lexical(a.event.id, b.event.id));
          // Preserve turn contexts and actual scope classes; unlike timings, invocation count needs no pooled p95.
          for (const rows of groupRows(known, e => JSON.stringify([e.turnId, e.validationScope]))) emitEpisodes(rows, false, 900_000, 3);
          if (missing.size) reasons.add("missing_validation_scope");
        }
      }
    }
    if (partialSource) reasons.add("incomplete_source_population");
    const incomplete = missing.size > 0 || blocked.size > 0 || partialSource;
    const status = native.suppressionReason !== null ? "suppressed" : incomplete ? eligible.size ? "partial" : "not_evaluable" : ids.length ? "candidates" : "no_candidate";
    assessments.push({ ruleId: rule, version: "source-pattern-evidence-v1", thresholds: thresholds(rule), status,
      eligibleEventN: eligible.size, missingEvidenceEventIds: [...missing].sort(lexical), blockedSessionIds: [...blocked].sort(lexical),
      candidateIds: ids, reasons: [...reasons].sort(lexical) });
  }
  return freezeOwned({ assessments, candidates });
}
