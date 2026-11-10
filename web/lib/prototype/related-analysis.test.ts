import { describe, expect, it } from "vitest";
import { events, getSnapshot } from "./data";
import {
  analysisAxisLabel,
  formatAnalysisCell,
  formatRelatedAnswer,
  hasCompleteCoordinates,
  relatedCitations,
  relatedScatterChartSchema,
  runRelatedAnalysis,
  validateRelatedAnalysisQuery,
  type RelatedAnalysisQuery,
} from "./related-analysis";

const usageRevenue: RelatedAnalysisQuery = {
  kind: "relatedAnalysis",
  source: { kind: "evidenceUse", evidenceIds: [], roles: [] },
  x: { operation: "countDistinct", field: "recordId" },
  y: { operation: "sum", field: "revenue" },
};

describe("related-record analysis", () => {
  it("aggregates decision-attributed USD once per using decision and discloses partial, zero and excluded observers", () => {
    const rows = runRelatedAnalysis(getSnapshot(), usageRevenue);
    const [interviews, study, feedback] = rows;
    expect(rows.map((r) => r.x.value)).toEqual([2, 2, 1]);
    expect(interviews.y).toMatchObject({
      value: 84000,
      status: "partial",
      missingIds: ["pricing-review"],
      includedIds: ["team-plan"],
    });
    expect(study.y).toMatchObject({ value: 132000, status: "complete", missingIds: [] });
    expect(feedback.y).toMatchObject({ value: 0, status: "complete", includedIds: ["seat-floor"] });
    expect(feedback.excludedMembers.map((m) => [m.id, m.links[0].role])).toEqual([
      ["pilot-cohort", "observes"],
    ]);
    expect(feedback.y.sourceIds).toContain("q3-attribution");
    expect(feedback.y.sourceIds).toContain("seat-minimum");
    expect(feedback.y.sourceIds).not.toContain("pilot-roster");
    expect(feedback.sourceIds).toContain("pilot-roster");
    expect(rows.filter(hasCompleteCoordinates).map((r) => r.id)).toEqual([
      "usage-study",
      "seat-feedback",
    ]);
    expect(formatAnalysisCell(interviews.y, usageRevenue.y)).toBe(
      "$84,000 known subtotal (1 of 2 measured)",
    );
    expect(formatRelatedAnswer(rows, usageRevenue)).toContain("missing Open the pricing review");
    expect(relatedCitations(rows)).toContain("q3-attribution");
    expect(relatedCitations(rows)).not.toContain("influence-review");
  });

  it("preserves relationship direction and deduplicates members across duplicate claims and multiple eligible roles", () => {
    const snap = getSnapshot();
    const original = snap.edges.find((e) => e.id === "usage-study.usage-meter")!;
    snap.edges.push(
      { ...original, id: "repeat" },
      { ...original, id: "reverse", from: original.to, to: original.from, label: "informed by" },
      { ...original, id: "wrong-way", from: original.to, to: original.from, label: "supports" },
      { ...original, id: "unknown-label", to: "migration-credit", label: "nearby" },
    );
    const study = runRelatedAnalysis(snap, usageRevenue).find((row) => row.id === "usage-study")!;
    expect(study.x.value).toBe(2);
    expect(study.y.value).toBe(132000);
    expect(study.members.find((m) => m.id === "usage-meter")!.links.map((l) => l.edgeId)).toEqual([
      original.id,
      "repeat",
      "reverse",
    ]);
    expect(study.excludedMembers.map((m) => [m.id, m.links[0].role])).toEqual([
      ["migration-credit", "unclassified"],
    ]);
  });

  it("handles explicit observation scope and mathematically empty aggregates independently of missing metrics", () => {
    const observations: RelatedAnalysisQuery = {
      ...usageRevenue,
      source: { kind: "evidenceUse", evidenceIds: [], roles: ["observes"] },
    };
    const rows = runRelatedAnalysis(getSnapshot(), observations);
    expect(rows.map((r) => [r.x.value, r.y.value, r.y.status])).toEqual([
      [0, 0, "complete"],
      [0, 0, "complete"],
      [1, null, "unreported"],
    ]);
    const means = runRelatedAnalysis(getSnapshot(), {
      ...observations,
      y: { operation: "mean", field: "revenue" },
    });
    expect(means[0].y).toMatchObject({ status: "empty", value: null });
    expect(hasCompleteCoordinates(means[0])).toBe(false);
    expect(means[2].y.missingIds).toEqual(["pilot-cohort"]);
    expect(analysisAxisLabel(usageRevenue.x, observations.source)).toBe("Distinct linked decisions");
  });

  it("replays values, visible exclusions and citations at the exact playhead", () => {
    const cutoff = events.findIndex((event) => event.id === "influence-review");
    const previous = runRelatedAnalysis(getSnapshot(cutoff), usageRevenue);
    expect(previous.every((row) => row.y.status === "unreported" && row.y.value === null)).toBe(true);
    expect(previous.some(hasCompleteCoordinates)).toBe(false);
    expect(relatedCitations(previous)).not.toContain("q3-attribution");
    const scope: RelatedAnalysisQuery = {
      ...usageRevenue,
      source: { kind: "evidenceUse", roles: [], evidenceIds: ["seat-feedback"] },
    };
    expect(runRelatedAnalysis(getSnapshot(0), scope)).toEqual([]);
    const observed = runRelatedAnalysis(
      getSnapshot(events.findIndex((event) => event.id === "pilot-interviews")),
      scope,
    )[0];
    expect(observed.y).toMatchObject({ value: 0, status: "complete" });
    expect(relatedCitations([observed])).not.toContain("seat-minimum");
    expect(relatedCitations([observed])).not.toContain("q3-attribution");
  });

  it("uses the same plan for outcomes vs mean assessed influence and revenue, including swapped axes", () => {
    const source = {
      kind: "linkedCount",
      rowKind: "outcome",
      linkedKind: "decision",
      rowIds: ["pilot-conversion"],
    } as const;
    const query = validateRelatedAnalysisQuery(getSnapshot(), {
      kind: "relatedAnalysis",
      source,
      x: { operation: "mean", field: "aiShare" },
      y: { operation: "mean", field: "revenue" },
    });
    const [pilot] = runRelatedAnalysis(getSnapshot(), query);
    expect(pilot.x).toMatchObject({
      value: 27.5,
      status: "complete",
      includedIds: ["team-plan", "pilot-cohort"],
    });
    expect(pilot.y).toMatchObject({ value: 84000, status: "partial", missingIds: ["pilot-cohort"] });
    expect(pilot.members.flatMap((m) => m.links.map((l) => l.label))).toEqual([
      "observed",
      "observed through",
    ]);
    const [reversed] = runRelatedAnalysis(getSnapshot(), { ...query, x: query.y, y: query.x });
    expect(reversed.x).toEqual(pilot.y);
    expect(reversed.y).toEqual(pilot.x);
  });

  it("validates available row scope, stored measure types and meaningful operations", () => {
    expect(
      relatedScatterChartSchema.safeParse({
        type: "relatedScatter",
        title: "Comparison",
        query: usageRevenue,
      }).success,
    ).toBe(true);
    const current = getSnapshot();
    for (const invalid of [
      { ...usageRevenue, x: { operation: "countDistinct", field: "aiShare" } },
      { ...usageRevenue, y: { operation: "sum", field: "aiShare" } },
      { ...usageRevenue, y: usageRevenue.x },
      {
        ...usageRevenue,
        source: { kind: "linkedCount", rowKind: "decision", linkedKind: "outcome", rowIds: [] },
      },
      { ...usageRevenue, source: { kind: "evidenceUse", evidenceIds: ["usage-meter"], roles: [] } },
      { ...usageRevenue, y: { operation: "eval", field: "revenue" } },
    ])
      expect(() => validateRelatedAnalysisQuery(current, invalid)).toThrow();
    expect(() =>
      validateRelatedAnalysisQuery(getSnapshot(0), {
        ...usageRevenue,
        source: { kind: "evidenceUse", evidenceIds: ["usage-study"], roles: [] },
      }),
    ).toThrow();
  });
});
