import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { formatDuration } from "../design/components.mjs";

describe("design duration formatting", () => {
  it.each([
    [119.9999, "2m"],
    [179.9999, "3m"],
    [3599.9999, "60m"],
    [3659.9999, "61m"],
    [119.9994, "1m 59.999s"],
    [3599.9994, "59m 59.999s"],
    [119.4999, "1m 59.5s"],
    [119.5, "1m 59.5s"],
    [60.0004, "1m"],
    [60.0006, "1m 0.001s"],
    [60, "1m"],
    [120, "2m"],
    [3600, "60m"],
    [95, "1m 35s"],
    [0, "0s"],
    [0.0001, "0.0001s"],
    [59.9999, "59.9999s"],
  ])("formats %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it.each([null, undefined])("keeps %s unknown", value => {
    expect(formatDuration(value)).toBe("Unknown");
  });

  it.each([-1, NaN, Infinity, -Infinity, "0", false, {}, []])("rejects invalid duration %s", value => {
    expect(() => formatDuration(value)).toThrow(TypeError);
  });
});

type Listener = () => void;
class SpecimenNode {
  hidden = false;
  open = false;
  value = "";
  textContent = "";
  href = "";
  src = "";
  dataset: Record<string, string> = {};
  readonly listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  dispatch(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  focus() {}
}

// This deliberately small DOM seam executes the actual progressive-enhancement
// script. It verifies event/state logic only, not rendering or native printing.
function specimen() {
  const ids = ["favicon", "brand-mark", "theme", "evidence-filter", "empty-results", "filter-status", "reset-filter", "sample-action", "action-status", "sample-label", "label-error", "print-report"];
  const nodes = new Map(ids.map(id => [id, new SpecimenNode()]));
  const node = (id: string) => {
    const element = nodes.get(id);
    if (!element) throw new Error(`Unexpected fixture element: ${id}`);
    return element;
  };
  const insights = ["direct", "observed", "unknown"].map(evidence => {
    const element = new SpecimenNode();
    element.dataset.evidence = evidence;
    return element;
  });
  const details = [false, true, false, true].map(open => Object.assign(new SpecimenNode(), { open }));
  const events = new SpecimenNode();
  node("evidence-filter").value = "all";
  node("empty-results").hidden = true;
  node("filter-status").textContent = "Showing 3 of 3 examples";
  runInNewContext(readFileSync(new URL("../design/showcase.mjs", import.meta.url), "utf8"), {
    document: {
      documentElement: { dataset: {} },
      querySelector: (selector: string) => node(selector.slice(1)),
      querySelectorAll: (selector: string) => {
        if (selector === ".ap-insight") return insights;
        if (selector === "details") return details;
        if (selector === "[data-open-evidence]") return [];
        throw new Error(`Unexpected fixture selector: ${selector}`);
      },
    },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { hash: "" },
    addEventListener: events.addEventListener.bind(events),
    print: () => { throw new Error("State tests must not invoke native printing"); },
  }, { timeout: 1000 });
  return {
    node,
    details,
    events,
    select(value: string) {
      node("evidence-filter").value = value;
      node("evidence-filter").dispatch("change");
    },
    state() {
      return {
        filter: node("evidence-filter").value,
        hiddenInsights: insights.map(insight => insight.hidden),
        emptyHidden: node("empty-results").hidden,
        status: node("filter-status").textContent,
        openDetails: details.map(detail => detail.open),
      };
    },
  };
}

describe("design print state", () => {
  it.each([
    ["all", 3],
    ["direct", 1],
    ["estimated", 0],
  ] as const)("restores the %s filter and disclosures after repeated print events", (filter, count) => {
    const view = specimen();
    view.select(filter);
    const before = view.state();
    expect(before.status).toBe(`Showing ${count} of 3 examples`);
    expect(before.emptyHidden).toBe(count !== 0);

    view.events.dispatch("beforeprint");
    expect(view.state()).toEqual({ ...before, emptyHidden: true, openDetails: [true, true, true, true] });
    view.events.dispatch("beforeprint");
    expect(view.state()).toEqual({ ...before, emptyHidden: true, openDetails: [true, true, true, true] });
    view.events.dispatch("afterprint");
    expect(view.state()).toEqual(before);
    view.events.dispatch("afterprint");
    expect(view.state()).toEqual(before);
  });

  it("leaves the screen unchanged when afterprint arrives without beforeprint", () => {
    const view = specimen();
    view.select("estimated");
    const before = view.state();
    view.events.dispatch("afterprint");
    expect(view.state()).toEqual(before);
  });

  it("restores a cancelled print and captures fresh state for the next print", () => {
    const view = specimen();
    view.select("estimated");
    const cancelled = view.state();
    view.events.dispatch("beforeprint");
    expect(view.node("empty-results").hidden).toBe(true);
    // Cancellation reports afterprint too; no PDF or native print call is needed.
    view.events.dispatch("afterprint");
    expect(view.state()).toEqual(cancelled);

    view.select("direct");
    view.details.forEach((details, index) => { details.open = index % 2 === 0; });
    const next = view.state();
    view.events.dispatch("afterprint");
    expect(view.state()).toEqual(next);
    view.events.dispatch("beforeprint");
    expect(view.state()).toEqual({ ...next, emptyHidden: true, openDetails: [true, true, true, true] });
    view.events.dispatch("afterprint");
    expect(view.state()).toEqual(next);
  });

  it("marks the empty-filter notice screen-only, including without print events", () => {
    const template = readFileSync(new URL("../design/showcase.template.html", import.meta.url), "utf8");
    const emptyNotice = template.match(/<div\b[^>]*\bid="empty-results"[^>]*>/)?.[0];
    expect(emptyNotice).toBeDefined();
    expect(emptyNotice).toMatch(/class="[^"]*\bap-no-print\b[^"]*"/);
    const css = readFileSync(new URL("../design/components.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media print\s*\{[\s\S]*\.ap-no-print[^{}]*\{\s*display: none !important;/);
    expect(css).toMatch(/@media print\s*\{[\s\S]*\.ap-insight\[hidden\]\s*\{\s*display: block !important;/);
  });
});
