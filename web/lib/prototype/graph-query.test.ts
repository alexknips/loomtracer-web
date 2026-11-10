import { describe, expect, it } from "vitest";
import { events, getSnapshot, type ViewerEdge } from "./data";
import {
  countLinkedRecords,
  evidenceChartSchema,
  evidenceCitations,
  formatEvidenceAnswer,
  formatLinkedCountAnswer,
  linkedCountChartSchema,
  linkedCountCitations,
  linksForEvidenceGroup,
  runEvidenceQuery,
  runLinkedCountQuery,
  selectedEvidenceRoles,
  validateEvidenceQuery,
  validateLinkedCountQuery,
  type EvidenceQuery,
  type LinkedCountQuery,
} from "./graph-query";

const all: EvidenceQuery = { kind: "evidenceUse", roles: [], evidenceIds: [] };
const stances: EvidenceQuery = { ...all, roles: ["supports", "contradicts"] };

describe("evidence use query", () => {
  it("finds shared evidence in either direction, keeps records distinct and retains their direct sources", () => {
    const rows = runEvidenceQuery(getSnapshot(), all);
    expect(rows.map((row) => [row.evidenceId, row.counts, row.decisionCount])).toEqual([
      ["buyer-interviews", { supports: 0, contradicts: 0, informs: 2, observes: 0 }, 2],
      ["usage-study", { supports: 1, contradicts: 0, informs: 1, observes: 0 }, 2],
      ["seat-feedback", { supports: 1, contradicts: 0, informs: 0, observes: 1 }, 2],
    ]);
    expect(rows.map((row) => row.useCount)).toEqual([2, 2, 1]);
    const seat = rows.find((row) => row.evidenceId === "seat-feedback")!;
    expect(linksForEvidenceGroup(seat, "used").map((link) => link.decisionId)).toEqual(["seat-floor"]);
    expect(linksForEvidenceGroup(seat, "observes").map((link) => link.decisionId)).toEqual([
      "pilot-cohort",
    ]);
    const buyer = rows[0];
    expect(buyer.links.map((link) => [link.from, link.to, link.label, link.sourceIds])).toEqual([
      ["pricing-review", "buyer-interviews", "informed by", ["interviews"]],
      ["buyer-interviews", "team-plan", "cited by", ["interviews", "team-approval"]],
    ]);
    expect(evidenceCitations(rows)).toContain("interviews");
    expect(evidenceCitations(rows)).toContain("buyer-interviews");
    expect(evidenceCitations(rows)).not.toContain("q3-attribution");
    expect(evidenceCitations(rows)).not.toContain("influence-review");
  });

  it("counts explicit stances only, includes every visible evidence row, and keeps the neutral links out", () => {
    const rows = runEvidenceQuery(getSnapshot(), stances);
    expect(
      rows.map((row) => [
        row.evidenceId,
        row.counts.supports,
        row.counts.contradicts,
        row.decisionCount,
      ]),
    ).toEqual([
      ["buyer-interviews", 0, 0, 0],
      ["usage-study", 1, 0, 1],
      ["seat-feedback", 1, 0, 1],
    ]);
    expect(rows[0].sourceIds).toEqual(["interviews"]);
    expect(formatEvidenceAnswer(rows, stances)).toContain(
      "Usage concentrates in ten percent — used by 1 decision in the selected roles. It explicitly supported 1 decision and explicitly contradicted 0 decisions.",
    );
    expect(formatEvidenceAnswer(rows, stances)).not.toContain("observed by");
    expect(formatEvidenceAnswer(runEvidenceQuery(getSnapshot(), all), all)).toContain(
      "was observed by 1 decision",
    );
  });

  it("recomputes counts and provenance at every reporting cutoff and intersects a saved scope locally", () => {
    const scope: EvidenceQuery = { ...all, evidenceIds: ["buyer-interviews", "seat-feedback"] };
    const expected: [string, number, number[]][] = [
      ["pricing-brief", 0, []],
      ["interviews", 1, [1]],
      ["team-approval", 1, [2]],
      ["pilot-interviews", 2, [2, 1]],
      ["seat-minimum", 2, [2, 2]],
    ];
    for (const [event, n, counts] of expected) {
      const current = getSnapshot(events.findIndex((entry) => entry.id === event));
      const rows = runEvidenceQuery(current, scope);
      expect(rows).toHaveLength(n);
      expect(rows.map((r) => r.decisionCount)).toEqual(counts);
      const visible = new Set([...current.nodes, ...current.sources].map((node) => node.id));
      expect(evidenceCitations(rows).every((id) => visible.has(id))).toBe(true);
    }
    expect(formatEvidenceAnswer([], all)).toMatch(/No matching evidence/);
    const observations: EvidenceQuery = { ...all, roles: ["observes"], evidenceIds: ["seat-feedback"] };
    const observationText = formatEvidenceAnswer(
      runEvidenceQuery(getSnapshot(), observations),
      observations,
    );
    expect(observationText).toContain("was observed by 1 decision");
    expect(observationText).not.toContain("used by");
  });

  it("recognizes direct and reciprocal contradictions, deduplicates decisions per category, and rejects unknown semantics", () => {
    const snapshot = getSnapshot();
    const typed = (
      id: string,
      from: string,
      to: string,
      label: string,
      sourceId?: string,
    ): ViewerEdge => ({
      id,
      from,
      to,
      label,
      sourceId,
      tree: false,
      date: "2026-10-05",
    });
    snapshot.edges = [
      typed("c1", "buyer-interviews", "team-plan", "contradicts", "team-approval"),
      typed("c2", "team-plan", "buyer-interviews", "contradicted by", "team-approval"),
      typed("s1", "buyer-interviews", "team-plan", "supports", "not-visible"),
      typed("i1", "buyer-interviews", "pilot-cohort", "prompted"),
      typed("wrong-verb-direction", "pilot-cohort", "buyer-interviews", "supports"),
      typed("unknown", "buyer-interviews", "annual-billing", "recorded alongside"),
      typed("source-only", "team-approval", "team-plan", "supports"),
      typed("other-kind", "buyer-interviews", "annual-25", "contradicts"),
      typed("decisions-only", "pilot-cohort", "rollout-gate", "informed"),
    ];
    const [row] = runEvidenceQuery(snapshot, { ...all, evidenceIds: ["buyer-interviews"] });
    expect(row.counts).toEqual({ supports: 1, contradicts: 1, informs: 1, observes: 0 });
    expect(row.decisionCount).toBe(2);
    expect(row.useCount).toBe(2);
    expect(row.links.map((link) => link.edgeId)).toEqual(["c1", "c2", "s1", "i1"]);
    expect(row.links[2].sourceIds).toEqual(["interviews"]);
    expect(row.links[3].sourceIds).toEqual(["interviews"]);
    expect(row.sourceIds).toEqual(["interviews", "team-approval"]);
  });

  it("validates the proposal scope and permitted query vocabulary independently of deterministic rendering", () => {
    const current = getSnapshot(3);
    const parsed = validateEvidenceQuery(current, {
      ...all,
      evidenceIds: ["buyer-interviews", "buyer-interviews"],
      roles: ["observes", "supports", "supports"],
    });
    expect(parsed.evidenceIds).toEqual(["buyer-interviews"]);
    expect(selectedEvidenceRoles(parsed)).toEqual(["supports", "observes"]);
    for (const evidenceId of ["usage-study", "team-plan", "not-there"]) {
      expect(() => validateEvidenceQuery(current, { ...all, evidenceIds: [evidenceId] })).toThrow();
    }
    for (const query of [
      { ...all, roles: ["rationale"] },
      { ...all, kind: "sql" },
      { ...all, expression: "anything" },
    ]) {
      expect(evidenceChartSchema.safeParse({ type: "evidence", title: "Counts", query }).success).toBe(
        false,
      );
    }
  });
});

describe("count linked records by role", () => {
  it("uses the same traversal to find observed outcomes per decision", () => {
    const rows = countLinkedRecords(getSnapshot(), {
      rowKind: "decision",
      linkedKind: "outcome",
      roles: ["tracked"] as const,
      rowIds: ["pilot-cohort", "team-plan", "usage-meter"],
      classify: (edge, direction) =>
        direction === "outgoing" && ["observed", "observed through"].includes(edge.label)
          ? "tracked"
          : undefined,
    });
    expect(rows.map((row) => [row.recordId, row.counts.tracked])).toEqual([
      ["team-plan", 1],
      ["usage-meter", 0],
      ["pilot-cohort", 1],
    ]);
    const pilot = rows.find((row) => row.recordId === "pilot-cohort")!;
    expect(pilot.links.map((link) => [link.linkedId, link.edgeId, link.sourceIds])).toEqual([
      ["pilot-conversion", "pilot-cohort.pilot-conversion", ["pilot-roster", "conversion-report"]],
    ]);
    expect(pilot.sourceIds).not.toContain("influence-review");
  });
});

describe("linked record count query", () => {
  const query: LinkedCountQuery = {
    kind: "linkedCount",
    rowKind: "decision",
    linkedKind: "outcome",
    rowIds: [],
  };

  it("retains zeroes for every visible decision and the shared outcome behind two separate rows", () => {
    const snapshot = getSnapshot();
    const rows = runLinkedCountQuery(snapshot, query);
    expect(Object.fromEntries(rows.map((row) => [row.recordId, row.linkedCount]))).toEqual({
      "pricing-review": 0,
      "team-plan": 1,
      "usage-meter": 0,
      "annual-billing": 1,
      "pilot-cohort": 1,
      "seat-floor": 0,
      "rollout-gate": 1,
      "migration-credit": 0,
    });
    expect(rows.find((row) => row.recordId === "pilot-cohort")?.links).toMatchObject([
      {
        linkedId: "pilot-conversion",
        label: "observed through",
        from: "pilot-cohort",
        to: "pilot-conversion",
        edgeId: "pilot-cohort.pilot-conversion",
        sourceIds: ["pilot-roster", "conversion-report"],
      },
    ]);
    expect(linkedCountCitations(rows)).toEqual(
      expect.arrayContaining(["pilot-conversion", "conversion-report"]),
    );
    expect(linkedCountCitations(rows)).not.toContain("q3-attribution");
    expect(formatLinkedCountAnswer(rows, query)).toContain("Meter excess usage — 0 outcomes.");
  });

  it("recomputes from the requested event, even when there are no outcomes yet", () => {
    const conversion = events.findIndex((event) => event.id === "conversion-report");
    const before = runLinkedCountQuery(getSnapshot(conversion - 1), query);
    expect(before).toHaveLength(8);
    expect(before.every((row) => row.linkedCount === 0)).toBe(true);
    expect(linkedCountCitations(before)).not.toContain("conversion-report");
    const after = runLinkedCountQuery(getSnapshot(conversion), query);
    expect(after.filter((row) => row.linkedCount).map((row) => row.recordId)).toEqual([
      "team-plan",
      "pilot-cohort",
    ]);
    expect(linkedCountCitations(after)).not.toContain("invoice-audit");
  });

  it("preserves contributing edges and both record origins without counting parallel or reverse edges twice", () => {
    const snapshot = getSnapshot();
    const parallel: ViewerEdge = {
      id: "second-source",
      from: "pilot-conversion",
      to: "team-plan",
      tree: false,
      date: "2026-09-10",
      label: "reported for",
      sourceId: "invoice-audit",
    };
    const [row] = runLinkedCountQuery(
      { ...snapshot, edges: [...snapshot.edges, parallel] },
      {
        ...query,
        rowIds: ["team-plan"],
      },
    );
    expect(row.linkedCount).toBe(1);
    expect(row.links.map((link) => link.edgeId)).toEqual([
      "team-plan.pilot-conversion",
      "second-source",
    ]);
    expect(row.links[1].sourceIds).toEqual(
      expect.arrayContaining(["team-approval", "conversion-report", "invoice-audit"]),
    );
  });

  it("accepts other record kinds, limits rows to the scope, and rejects unknown scopes and expressions", () => {
    const snapshot = getSnapshot();
    const reversed = validateLinkedCountQuery(snapshot, {
      ...query,
      rowKind: "outcome",
      linkedKind: "decision",
      rowIds: ["pilot-conversion", "pilot-conversion"],
    });
    expect(reversed.rowIds).toEqual(["pilot-conversion"]);
    const [row] = runLinkedCountQuery(snapshot, reversed);
    expect(row.linkedCount).toBe(2);
    expect(row.links.map((link) => link.linkedId)).toEqual(["team-plan", "pilot-cohort"]);
    const [team] = runLinkedCountQuery(snapshot, {
      ...query,
      linkedKind: "alternative",
      rowIds: ["team-plan"],
    });
    expect(team.linkedCount).toBe(2);
    expect(team.links.map((link) => link.linkedId)).toEqual(["flat-seat", "unlimited-usage"]);
    expect(runLinkedCountQuery(getSnapshot(0), reversed)).toEqual([]);
    expect(() => validateLinkedCountQuery(getSnapshot(0), reversed)).toThrow();
    expect(() =>
      validateLinkedCountQuery(snapshot, { ...query, rowIds: ["pilot-conversion"] }),
    ).toThrow();
    expect(
      linkedCountChartSchema.safeParse({
        type: "linkedCount",
        title: "Count",
        query: { ...query, expression: "COUNT(*)" },
      }).success,
    ).toBe(false);
    expect(
      linkedCountChartSchema.safeParse({
        type: "linkedCount",
        title: "Count",
        query: { ...query, linkedKind: "revenue" },
      }).success,
    ).toBe(false);
  });
});
