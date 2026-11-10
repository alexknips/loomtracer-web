import { describe, expect, it } from "vitest";
import { events, getSnapshot } from "./data";
import { outputSchema, prepareQuestion, questionSchema, validateAnswer } from "./chat";
import { formatAnalysisAt } from "./analysis";
import { chartReviewTask, completeChartReview } from "./chart-review";
import {
  relatedCitations,
  relatedEvidenceRoles,
  runRelatedAnalysis,
  type RelatedAnalysisQuery,
} from "./related-analysis";
import { askCodex, codexArgs, sessionIsIsolated } from "./codex";
import {
  evidenceCitations,
  formatEvidenceAnswer,
  formatLinkedCountAnswer,
  linkedCountCitations,
  runEvidenceQuery,
  runLinkedCountQuery,
  type EvidenceQuery,
  type LinkedCountQuery,
} from "./graph-query";

const chart = {
  type: "scatter",
  title: "AI influence and Q3 revenue",
  x: "aiShare",
  y: "revenue",
  decisionIds: [],
};
const answer = {
  answer: "The team plan has the highest attributed revenue.",
  citations: ["team-plan", "q3-attribution"],
  chart,
};
const evidenceQuestion =
  "Plot a graph showing evidence, how often it's cited/used, whether it's used to support or contradict.";
const outcomeQuestion = "Plot how many recorded outcomes are linked to each decision.";
const outcomes: LinkedCountQuery = {
  kind: "linkedCount",
  rowKind: "decision",
  linkedKind: "outcome",
  rowIds: [],
};
const allEvidence: EvidenceQuery = { kind: "evidenceUse", evidenceIds: [], roles: [] };
const compositeQuestion =
  "Plot how many decisions used each piece of evidence against the total revenue attributed to those decisions.";
const useAndRevenue: RelatedAnalysisQuery = {
  kind: "relatedAnalysis",
  source: { ...allEvidence, roles: ["supports", "contradicts", "informs"] },
  x: { operation: "countDistinct", field: "recordId" },
  y: { operation: "sum", field: "revenue" },
};
const alternateQuestion =
  "For each recorded outcome, plot the mean assessed AI contribution of its directly linked decisions against the sum of their attributed revenue.";
const outcomeMeasures: RelatedAnalysisQuery = {
  kind: "relatedAnalysis",
  source: { kind: "linkedCount", rowKind: "outcome", linkedKind: "decision", rowIds: [] },
  x: { operation: "mean", field: "aiShare" },
  y: { operation: "sum", field: "revenue" },
};
function evidencePlan(query: EvidenceQuery, chartTitle: string | null) {
  return { answer: "99 uses", citations: ["invented"], chart: null, evidence: { query, chartTitle } };
}

describe("graph assistant", () => {
  it("withholds future nodes, sources, chart metrics and prior turns after rewinding", () => {
    const { prompt } = prepareQuestion({
      question: "What did they know?",
      cutoff: 0,
      selectedId: "team-plan",
      history: [
        { role: "assistant", text: "later secret", cutoff: events.length - 1 },
        { role: "user", text: "earlier question", cutoff: 0 },
      ],
    });
    expect(prompt).toContain("earlier question");
    expect(prompt).not.toMatch(/later secret|q3-attribution|team-plan|84000/);
    expect(JSON.parse(prompt).selectedId).toBeNull();
  });

  it("rejects caller-supplied records and chart values, hidden citations, and invented axes", () => {
    expect(questionSchema.safeParse({ question: "Why?", cutoff: 0, records: [] }).success).toBe(false);
    expect(() => validateAnswer(JSON.stringify(answer), getSnapshot(0))).toThrow();
    expect(() =>
      validateAnswer(JSON.stringify({ ...answer, chart: { ...chart, y: "conversion" } }), getSnapshot()),
    ).toThrow();
    expect(() =>
      validateAnswer(
        JSON.stringify({ ...answer, chart: { ...chart, points: [[50, 100]] } }),
        getSnapshot(),
      ),
    ).toThrow();
    expect(() =>
      validateAnswer(
        JSON.stringify({ ...answer, chart: { ...chart, decisionIds: ["pilot-cohort"] } }),
        getSnapshot(),
      ),
    ).toThrow();
    expect(
      validateAnswer(
        JSON.stringify({ ...answer, chart: { ...chart, decisionIds: ["seat-floor"] } }),
        getSnapshot(),
      ).chart,
    ).toMatchObject({ decisionIds: ["seat-floor"] });
  });

  it("accepts source citations, valid numeric axes and revenue ranking", () => {
    expect(validateAnswer(JSON.stringify(answer), getSnapshot())).toEqual(answer);
    const ranked = { ...chart, type: "bar", x: "revenue", y: "decision" };
    expect(validateAnswer(JSON.stringify({ ...answer, chart: ranked }), getSnapshot()).chart).toEqual(
      ranked,
    );
  });

  it("resolves evidence figures, citations and text through the same query in both presentations", () => {
    const snapshot = getSnapshot();
    const rows = runEvidenceQuery(snapshot, allEvidence);
    const plotted = validateAnswer(
      JSON.stringify(evidencePlan(allEvidence, "Use of evidence")),
      snapshot,
    );
    const text = validateAnswer(JSON.stringify(evidencePlan(allEvidence, null)), snapshot);
    expect(plotted).toEqual({
      query: allEvidence,
      answer: formatEvidenceAnswer(rows, allEvidence),
      citations: evidenceCitations(rows),
      chart: { type: "evidence", title: "Use of evidence", query: allEvidence },
    });
    expect(text).toEqual({ ...plotted, chart: null });
    expect(plotted.answer).not.toContain("99 uses");
    expect(plotted.citations).not.toContain("invented");
  });

  it("accepts an empty visible evidence result and refuses hidden, unknown, or non-evidence IDs", () => {
    const empty = validateAnswer(
      JSON.stringify(evidencePlan(allEvidence, "Use of evidence")),
      getSnapshot(0),
    );
    expect(empty.chart?.type).toBe("evidence");
    expect(empty.citations).toEqual([]);
    for (const evidenceId of ["buyer-interviews", "pricing-review", "invented"]) {
      const raw = evidencePlan({ ...allEvidence, evidenceIds: [evidenceId] }, null);
      expect(() => validateAnswer(JSON.stringify(raw), getSnapshot(0))).toThrow();
    }
  });

  it("keeps explicit role filters and rejects invented roles or competing chart requests", () => {
    const query: EvidenceQuery = {
      kind: "evidenceUse",
      evidenceIds: ["usage-study"],
      roles: ["supports"],
    };
    const raw = evidencePlan(query, null);
    const snapshot = getSnapshot();
    const onlySupport = validateAnswer(JSON.stringify(raw), snapshot);
    expect(onlySupport.answer).toBe(formatEvidenceAnswer(runEvidenceQuery(snapshot, query), query));
    const invalid = { ...raw, evidence: { query: { ...query, roles: ["caused"] }, chartTitle: null } };
    expect(() => validateAnswer(JSON.stringify(invalid), snapshot)).toThrow();
    expect(() => validateAnswer(JSON.stringify({ ...raw, chart }), snapshot)).toThrow();
  });

  it("uses distinct recorded neighbors for text or charts and refuses conflicting plans", () => {
    const snapshot = getSnapshot();
    const rows = runLinkedCountQuery(snapshot, outcomes);
    const raw = {
      answer: "A guessed total of 99.",
      citations: ["made-up"],
      chart: null,
      linked: { query: outcomes, chartTitle: "Recorded outcomes per decision" },
    };
    const result = validateAnswer(JSON.stringify(raw), snapshot);
    expect(result).toEqual({
      query: outcomes,
      answer: formatLinkedCountAnswer(rows, outcomes),
      citations: linkedCountCitations(rows),
      chart: { type: "linkedCount", title: raw.linked.chartTitle, query: outcomes },
    });
    const text = validateAnswer(
      JSON.stringify({ ...raw, linked: { query: outcomes, chartTitle: null } }),
      snapshot,
    );
    expect(text).toEqual({ ...result, chart: null });
    expect(() =>
      validateAnswer(JSON.stringify({ ...raw, ...evidencePlan(allEvidence, null) }), snapshot),
    ).toThrow();
    expect(() => validateAnswer(JSON.stringify({ ...raw, chart }), snapshot)).toThrow();
  });

  it("uses one analysis slot for model proposals and resolves related measurements at the cutoff", () => {
    expect(Object.keys(outputSchema.properties ?? {})).toEqual([
      "answer",
      "citations",
      "chart",
      "analysis",
    ]);
    expect(JSON.stringify(outputSchema)).not.toContain('"oneOf"');
    const snapshot = getSnapshot();
    const raw = {
      answer: "All three points have known total revenue of $999,999.",
      citations: ["fabricated"],
      chart: null,
      analysis: { query: useAndRevenue, chartTitle: "Decision use and revenue" },
    };
    const result = validateAnswer(JSON.stringify(raw), snapshot);
    const rows = runRelatedAnalysis(snapshot, useAndRevenue);
    expect(result).toEqual({
      answer: formatAnalysisAt(snapshot, useAndRevenue),
      citations: relatedCitations(rows),
      query: useAndRevenue,
      chart: { type: "relatedScatter", title: raw.analysis.chartTitle, query: useAndRevenue },
    });
    expect(result.answer).toContain("$132,000");
    expect(result.answer).toContain("$84,000 known subtotal");
    expect(result.answer).not.toContain("999,999");
    expect(formatAnalysisAt(getSnapshot(8), useAndRevenue)).not.toContain("$132,000");
    const text = validateAnswer(
      JSON.stringify({ ...raw, analysis: { query: useAndRevenue, chartTitle: null } }),
      snapshot,
    );
    expect(text).toEqual({ ...result, chart: null });
    expect(() =>
      validateAnswer(
        JSON.stringify({ ...raw, evidence: { query: allEvidence, chartTitle: null } }),
        snapshot,
      ),
    ).toThrow();
    expect(() =>
      validateAnswer(
        JSON.stringify({ ...raw, analysis: { ...raw.analysis, points: [[2, 999999]] } }),
        snapshot,
      ),
    ).toThrow();
  });

  it("selects other supported row kinds and measures through the same model proposal", () => {
    const snapshot = getSnapshot();
    const result = validateAnswer(
      JSON.stringify({
        answer: "",
        chart: null,
        citations: [],
        analysis: { query: outcomeMeasures, chartTitle: "Outcome-linked decisions" },
      }),
      snapshot,
    );
    expect(result.chart).toEqual({
      type: "relatedScatter",
      title: "Outcome-linked decisions",
      query: outcomeMeasures,
    });
    expect(result.answer).toBe(formatAnalysisAt(snapshot, outcomeMeasures));
    const invalid = { ...outcomeMeasures, y: { operation: "sum", field: "aiShare" } };
    expect(() =>
      validateAnswer(
        JSON.stringify({
          answer: "",
          chart: null,
          citations: [],
          analysis: { query: invalid, chartTitle: "Invalid" },
        }),
        snapshot,
      ),
    ).toThrow();
  });

  it("accepts account instructions and refuses project-specific instruction files", () => {
    expect(sessionIsIsolated([], "/user/.codex")).toBe(true);
    expect(sessionIsIsolated(["/user/.codex/AGENTS.md"], "/user/.codex")).toBe(true);
    expect(sessionIsIsolated(["/repo/AGENTS.md"], "/user/.codex")).toBe(false);
    const args = codexArgs("/tmp/fixture");
    for (const feature of [
      "shell_tool",
      "apps",
      "plugins",
      "hooks",
      "browser_use",
      "multi_agent",
      "memories",
    ]) {
      expect(args[args.indexOf(feature) - 1]).toBe("--disable");
    }
    expect(args).toContain("stdio://");
    expect(args).toContain('web_search="disabled"');
  });
});

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1")(
  "composes a distinct count and total revenue for evidence without inventing coordinates",
  async () => {
    const { prompt, snapshot } = prepareQuestion({
      question: compositeQuestion,
      cutoff: events.length - 1,
    });
    const reply = validateAnswer(await askCodex(prompt, new AbortController().signal), snapshot);
    expect(reply.chart).toMatchObject({ type: "relatedScatter" });
    const query = reply.query;
    if (query?.kind !== "relatedAnalysis" || query.source.kind !== "evidenceUse")
      throw new Error("Wrong grouping");
    expect(query.x).toEqual(useAndRevenue.x);
    expect(query.y).toEqual(useAndRevenue.y);
    expect(query.source.evidenceIds).toEqual([]);
    expect(new Set(relatedEvidenceRoles(query.source))).toEqual(
      new Set(["supports", "contradicts", "informs"]),
    );
    const rows = runRelatedAnalysis(snapshot, query);
    expect(rows.find((row) => row.id === "seat-feedback")?.x.value).toBe(1);
    expect(rows.find((row) => row.id === "usage-study")?.y.value).toBe(132000);
    expect(rows.find((row) => row.id === "buyer-interviews")?.y.status).toBe("partial");
    expect(reply.answer).toBe(formatAnalysisAt(snapshot, query));
  },
  100_000,
);

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1")(
  "uses the same analysis vocabulary for a different group and numeric measure",
  async () => {
    const { prompt, snapshot } = prepareQuestion({
      question: alternateQuestion,
      cutoff: events.length - 1,
    });
    const reply = validateAnswer(await askCodex(prompt, new AbortController().signal), snapshot);
    expect(reply.chart).toMatchObject({ type: "relatedScatter", query: outcomeMeasures });
    expect(reply.answer).toBe(formatAnalysisAt(snapshot, outcomeMeasures));
  },
  100_000,
);

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1").each([
  {
    question: "For each evidence record, graph the number of decisions it helped shape alongside the combined revenue allocated to those decisions.",
    firstField: "recordId",
  },
  {
    question: "Give each piece of evidence one point. Put the total revenue from decisions that relied on it on the horizontal axis, and the number of those decisions on the vertical axis.",
    firstField: "revenue",
  },
])("repairs a count-only draft after independently interpreting $question", async ({ question, firstField }) => {
  const { prompt, snapshot } = prepareQuestion({ question, cutoff: events.length - 1 });
  const draft = validateAnswer(JSON.stringify(evidencePlan(allEvidence, "Evidence use by relationship")), snapshot);
  const rawReview = await askCodex(prompt, new AbortController().signal, chartReviewTask);
  const answer = completeChartReview(rawReview, draft, snapshot);
  expect(answer.chart?.type).toBe("relatedScatter");
  const query = answer.query;
  if (query?.kind !== "relatedAnalysis" || query.source.kind !== "evidenceUse") throw new Error("Wrong comparison");
  expect(new Set(relatedEvidenceRoles(query.source))).toEqual(new Set(["supports", "contradicts", "informs"]));
  expect(query.x.field).toBe(firstField);
  const measures = [query.x, query.y];
  expect(measures).toEqual(expect.arrayContaining([useAndRevenue.x, useAndRevenue.y]));
  expect(answer.answer).toContain("$132,000");
  expect(answer.answer).toContain("$84,000 known subtotal");
}, 100_000);

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1")(
  "plots the recorded outcomes linked to each decision from the user's wording",
  async () => {
    const { prompt, snapshot } = prepareQuestion({
      question: outcomeQuestion,
      cutoff: events.length - 1,
    });
    const reply = validateAnswer(await askCodex(prompt, new AbortController().signal), snapshot);
    const rows = runLinkedCountQuery(snapshot, outcomes);
    expect(reply.query).toEqual(outcomes);
    expect(reply.chart).toMatchObject({ type: "linkedCount", query: outcomes });
    expect(reply.answer).toBe(formatLinkedCountAnswer(rows, outcomes));
    expect(reply.citations).toEqual(linkedCountCitations(rows));
  },
  100_000,
);

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1")(
  "answers through the isolated signed-in Codex session",
  async () => {
    const { prompt, snapshot } = prepareQuestion({
      question:
        "Plot each decision by AI contribution versus Q3 revenue, and identify the highest revenue decision with sources.",
      history: [],
      cutoff: events.length - 1,
    });
    const reply = validateAnswer(await askCodex(prompt, new AbortController().signal), snapshot);
    expect(reply.chart?.type).toBe("scatter");
    expect(reply.citations.length).toBeGreaterThan(0);
    expect(reply.answer.toLowerCase()).toMatch(/team.plan/);
  },
  100_000,
);

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1")(
  "recognizes a free-form request to plot how often evidence is cited and how it is used",
  async () => {
    const { prompt, snapshot } = prepareQuestion({
      question: evidenceQuestion,
      cutoff: events.length - 1,
    });
    const reply = validateAnswer(await askCodex(prompt, new AbortController().signal), snapshot);
    expect(reply.query).toEqual(allEvidence);
    expect(reply.chart).toMatchObject({ type: "evidence", query: allEvidence });
    expect(reply.answer).toBe(
      formatEvidenceAnswer(runEvidenceQuery(snapshot, allEvidence), allEvidence),
    );
  },
  100_000,
);

it.skipIf(process.env.PROTOTYPE_CHAT_LIVE !== "1")(
  "recognizes a text-only question about how often evidence was cited",
  async () => {
    const { prompt, snapshot } = prepareQuestion({
      question: "How often is each evidence record cited or used by a decision?",
      cutoff: events.length - 1,
    });
    const reply = validateAnswer(await askCodex(prompt, new AbortController().signal), snapshot);
    expect(reply.query).toEqual(allEvidence);
    expect(reply.chart).toBeNull();
    expect(reply.answer).toBe(
      formatEvidenceAnswer(runEvidenceQuery(snapshot, allEvidence), allEvidence),
    );
  },
  100_000,
);
