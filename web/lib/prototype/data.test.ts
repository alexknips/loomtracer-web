import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChartView from "../../components/prototype/ChartView";
import { events, getSnapshot, type ChartSpec, type Snapshot } from "./data";

describe("pricing project cutoff", () => {
  it("shows an initial root, clamps the timeline, and ends on the latest report", () => {
    const root = getSnapshot(0);
    expect(root.nodes.map((item) => item.id)).toEqual(["pricing-review"]);
    expect(root.edges).toEqual([]);
    expect(getSnapshot(-1)).toEqual(root);
    expect(getSnapshot(events.length + 1)).toEqual(getSnapshot());
    expect(events.at(-1)?.id).toBe("q3-attribution");
  });

  it("keeps all reachable graph and metric references within the selected snapshot", () => {
    const latest = getSnapshot();
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(new Set(latest.nodes.map((n) => n.id)).size).toBe(latest.nodes.length);
    for (const [index, event] of events.entries()) {
      const snapshot = getSnapshot(index);
      const sourceIds = new Set(snapshot.sources.map((s) => s.id));
      const nodeIds = new Set(snapshot.nodes.map((n) => n.id));
      expect(snapshot.sources.at(-1)?.id).toBe(event.id);
      expect(nodeIds.has(event.nodeId)).toBe(true);
      expect(snapshot.sources.length).toBe(index + 1);
      for (const edge of snapshot.edges) {
        expect(nodeIds.has(edge.from) && nodeIds.has(edge.to)).toBe(true);
      }
      for (const node of snapshot.nodes) {
        expect(node.position).toEqual(latest.nodes.find((n) => n.id === node.id)?.position);
        expect(node.sourceIds.every((id) => sourceIds.has(id))).toBe(true);
        expect(snapshot.edges.filter((edge) => edge.tree && edge.to === node.id)).toHaveLength(
          node.id === "pricing-review" ? 0 : 1,
        );
      }
      for (const metric of snapshot.metrics) {
        expect(nodeIds.has(metric.nodeId)).toBe(true);
        expect(metric.aiShare === null).toBe(metric.aiSourceId === null);
        expect(metric.revenue === null).toBe(metric.revenueSourceId === null);
        expect(metric.aiSourceId === null || sourceIds.has(metric.aiSourceId)).toBe(true);
        expect(metric.revenueSourceId === null || sourceIds.has(metric.revenueSourceId)).toBe(true);
      }
      if (index) expect(event.date >= events[index - 1].date).toBe(true);
    }
    expect(latest.edges.some((e) => !e.tree)).toBe(true);
  });

  it("exposes each measurement and its evidence at the exact reporting event", () => {
    const index = events.findIndex((event) => event.id === "influence-review");
    const afterAssessment = getSnapshot(index);
    expect(getSnapshot(index - 1).metrics.every((m) => m.aiShare === null && m.revenue === null)).toBe(
      true,
    );
    expect(afterAssessment.metrics.find((m) => m.nodeId === "team-plan")).toMatchObject({
      aiShare: 45,
      revenue: null,
      aiSourceId: "influence-review",
      revenueSourceId: null,
    });
    expect(afterAssessment.sources.some((s) => s.id === "q3-attribution")).toBe(false);
    const final = getSnapshot().metrics;
    expect(final.find((m) => m.nodeId === "team-plan")).toMatchObject({
      aiShare: 45,
      revenue: 84000,
      revenueSourceId: "q3-attribution",
    });
    expect(final.find((m) => m.nodeId === "seat-floor")?.revenue).toBe(0);
    expect(final.find((m) => m.nodeId === "rollout-gate")?.revenue).toBeNull();
    expect(final.filter((m) => m.aiShare !== null && m.revenue !== null)).toHaveLength(5);
    expect(final.reduce((sum, m) => sum + (m.revenue ?? 0), 0)).toBe(212000);
    expect(afterAssessment.metrics.find((m) => m.nodeId === "team-plan")?.aiRationale).toContain(
      "twelve bundles",
    );
    expect(getSnapshot(index - 1).metrics.every((m) => m.aiRationale === null)).toBe(true);
  });
});

describe("chart measurements", () => {
  function chartMarkup(snapshot: Snapshot, spec: ChartSpec) {
    return renderToStaticMarkup(
      createElement(ChartView, { snapshot, spec, selectedId: null, onSelect: () => {} }),
    );
  }

  const scatter: ChartSpec = {
    type: "scatter",
    title: "Revenue and influence",
    x: "aiShare",
    y: "revenue",
    decisionIds: [],
  };
  it("plots measured zero, reports omitted rows and exposes the corresponding source reports", () => {
    const markup = chartMarkup(getSnapshot(), scatter);
    expect(markup).toContain(
      "Remove the seat minimum, Assessed AI influence 20%, Attributed revenue · USD $0",
    );
    expect(markup).toContain("5 of 8 decisions plotted");
    expect(markup).toContain("Decision influence assessment");
    expect(markup).toContain("Q3 revenue attribution report");
    expect(markup).toContain("Stage the public rollout");
    expect(markup).not.toContain('aria-label="Stage the public rollout, Assessed AI influence');
  });

  it("recomputes from the cutoff, including absent report titles and future metric values", () => {
    const cutoff = events.findIndex((e) => e.id === "influence-review");
    const markup = chartMarkup(getSnapshot(cutoff), scatter);
    expect(markup).toContain("0 of 8 decisions plotted");
    expect(markup).not.toContain("Q3 revenue attribution report");
    expect(markup).not.toContain("84,000");
    const ranking = chartMarkup(getSnapshot(cutoff), {
      ...scatter,
      type: "bar",
      x: "aiShare",
      y: "decision",
    });
    expect(ranking).toContain("7 of 8 decisions plotted");
    expect(ranking.indexOf("Meter excess usage")).toBeLessThan(ranking.indexOf("Launch the team plan"));
  });

  it("plots hundreds of decisions without duplicating them into a legend or hundreds of tab stops", () => {
    const snapshot = getSnapshot();
    const example = snapshot.nodes.find((entry) => entry.id === "team-plan")!;
    const metric = snapshot.metrics.find((entry) => entry.nodeId === example.id)!;
    const nodes = Array.from({ length: 300 }, (_, i) => ({ ...example, id: "test-" + i, title: "Decision " + i }));
    const metrics = nodes.map((entry, i) => ({ ...metric, nodeId: entry.id, aiShare: i % 101, revenue: i * 300 }));
    const markup = chartMarkup({ ...snapshot, nodes, metrics }, scatter);
    expect(markup).toContain("300 of 300 decisions plotted");
    expect(markup.match(/data-point="/g)).toHaveLength(300);
    expect(markup.match(/tabindex="0"/gi)).toHaveLength(1);
    expect(markup).not.toContain("Plotted decisions");
    expect(markup).toContain("$100K");
  });

  it("respects swapped axes and decision subsets", () => {
    const markup = chartMarkup(getSnapshot(), {
      ...scatter,
      x: "revenue",
      y: "aiShare",
      decisionIds: ["annual-billing"],
    });
    expect(markup).toContain("1 of 1 decisions plotted");
    expect(markup).toContain(
      "Offer annual billing, Attributed revenue · USD $62,000, Assessed AI influence 25%",
    );
    expect(markup).not.toContain("Launch the team plan");
  });
});
