import { describe, expect, it } from "vitest";
import type { NormalizedEvent } from "../src/normalize/types.js";
import { analyzeSourcePatterns } from "../src/analysis/source-patterns.js";
import { event, id, source } from "./recovery-fixture.js";

const failure = (name: string, start: number, end: number, extra: Partial<NormalizedEvent> = {}) =>
  event(name, start, end, { errorClass: "process_exit", errorFingerprint: id("error", "failure"), ...extra });
const rule = (a: ReturnType<typeof analyzeSourcePatterns>, name: string) => a.rules.find(r => r.ruleId === name)!;

describe("strict occurrence and turn proofs", () => {
  it("does not accept a missing structured turn proof as the event's claimed turn", () => {
    const s = source([failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000)]);
    const first = s.events[0]!.id;
    const broken = { ...s, evidence: { ...s.evidence!, observations: s.evidence!.observations.map(o => o.eventId === first ? { ...o, turnId: null } : o) } };
    const a = analyzeSourcePatterns(broken);
    expect(rule(a, "retry-loop").candidateIds).toEqual([]);
    expect(a.coverage.positionExclusions).toContainEqual({ eventId: first, reason: "contradictory_turn_proof" });
  });
  it("requires proved interval positioning to select an explicit Repeated Error query population", () => {
    const es = [failure("a", 0, 1000), failure("b", 2000, 3000), failure("c", 4000, 5000,
      { sessionId: id("session", "second"), intervalScope: "unknown", intervalTimingEvidence: "unknown" })];
    const a = analyzeSourcePatterns(source(es), { startMs: 0, endMs: 6000 });
    expect(rule(a, "repeated-error").candidateIds).toEqual([]);
    expect(rule(a, "repeated-error").reasons).toContain("unpositioned_query_population");
  });
});
