import type { PatternContext, PositionedPatternEvent } from "./pattern-context.js";
import { isEdit, isValidation } from "./pattern-context.js";
import { freezeOwned, lexical } from "./pattern-intervals.js";

export type EditValidationCycle = Readonly<{
  id: string; sessionId: string; turnId: string | null;
  editEventIds: readonly string[]; validationEventIds: readonly string[];
  firstValidationEventId: string; firstResult: "success" | "failure";
  firstValidationScope: "full" | "targeted" | "incremental" | "unknown";
  firstValidationAt: string; resolved: boolean; successfulValidationEventId: string | null;
  evidenceObservationIds: readonly string[]; changedFiles: null; changedLines: null;
}>;
export type EditValidationAnalysis = Readonly<{
  association: "ordered_same_stream_context_not_causal";
  partitions: readonly Readonly<{
    sessionId: string; status: "evaluated" | "unavailable"; reasons: readonly string[];
    cycleN: number | null; firstPassN: number | null; firstTerminalN: number | null;
    firstPassValidationRate: number | null; scopeKnownN: number | null; fullScopeN: number | null;
    fullValidationRatio: number | null; withoutObservedEditN: number | null; awaitingValidationEditN: number | null;
  }>[];
  cycles: readonly EditValidationCycle[];
}>;

type PendingCycle = { edits: PositionedPatternEvent[]; validations: PositionedPatternEvent[] };
/** Temporal association only. Any opaque/ambiguous stream stays unavailable rather than implying no intervening edit. */
export function analyzeEditValidation(context: PatternContext): EditValidationAnalysis {
  const cycles: EditValidationCycle[] = [], partitions: EditValidationAnalysis["partitions"][number][] = [];
  for (const session of context.sessions) {
    if (session.temporalReasons.length) {
      partitions.push({ sessionId: session.sessionId, status: "unavailable", reasons: [...session.temporalReasons],
        cycleN: null, firstPassN: null, firstTerminalN: null, firstPassValidationRate: null,
        scopeKnownN: null, fullScopeN: null, fullValidationRatio: null, withoutObservedEditN: null, awaitingValidationEditN: null });
      continue;
    }
    let edits: PositionedPatternEvent[] = [], active: PendingCycle | null = null, turn: string | null | undefined;
    let withoutEdit = 0, awaiting = 0;
    const local: EditValidationCycle[] = [];
    const flush = () => {
      if (active === null) return;
      const first = active.validations[0]!, success = active.validations.find(x => x.event.status === "completed" && x.event.executionOutcome === "success");
      const all = [...active.edits, ...active.validations];
      local.push({ id: `cycle-${cycles.length + local.length + 1}`, sessionId: session.sessionId, turnId: first.event.turnId,
        editEventIds: active.edits.map(x => x.event.id), validationEventIds: active.validations.map(x => x.event.id),
        firstValidationEventId: first.event.id, firstResult: first.event.status === "completed" ? "success" : "failure",
        firstValidationScope: first.event.validationScope, firstValidationAt: first.event.endAt!,
        resolved: success !== undefined, successfulValidationEventId: success?.event.id ?? null,
        evidenceObservationIds: [...new Set(all.flatMap(x => x.proofIds))].sort(lexical), changedFiles: null, changedLines: null });
      active = null;
    };
    for (const x of session.ordered) {
      const e = x.event;
      if (turn !== undefined && turn !== e.turnId) { flush(); awaiting += edits.length; edits = []; }
      turn = e.turnId;
      if (isEdit(e)) { flush(); edits.push(x); continue; }
      if (!isValidation(e)) continue;
      if (!(e.status === "completed" && e.executionOutcome === "success" || e.status === "failed" && e.executionOutcome === "error")) {
        flush(); awaiting += edits.length; edits = []; withoutEdit++; continue;
      }
      if (edits.length) { active = { edits, validations: [x] }; edits = []; }
      else if (active !== null && e.operationKey !== null && active.validations[0]!.event.operationKey === e.operationKey) active.validations.push(x);
      else { flush(); withoutEdit++; }
    }
    flush(); awaiting += edits.length;
    const firstPass = local.filter(c => c.firstResult === "success").length;
    const scopeKnown = local.filter(c => c.firstValidationScope !== "unknown").length;
    const full = local.filter(c => c.firstValidationScope === "full").length;
    cycles.push(...local);
    partitions.push({ sessionId: session.sessionId, status: "evaluated", reasons: [], cycleN: local.length,
      firstPassN: firstPass, firstTerminalN: local.length, firstPassValidationRate: local.length ? firstPass / local.length : null,
      scopeKnownN: scopeKnown, fullScopeN: full, fullValidationRatio: scopeKnown ? full / scopeKnown : null,
      withoutObservedEditN: withoutEdit, awaitingValidationEditN: awaiting });
  }
  return freezeOwned({ association: "ordered_same_stream_context_not_causal", partitions, cycles });
}
