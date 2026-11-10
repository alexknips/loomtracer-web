import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/prototype/chat/route";
import { askCodex, ChatUnavailable } from "./codex";
import { events, getSnapshot } from "./data";
import { summarizeAnalysisAt } from "./analysis";
import type { RelatedAnalysisQuery } from "./related-analysis";
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

vi.mock("./codex", async (original) => {
  const real = await original<typeof import("./codex")>();
  return { ...real, askCodex: vi.fn() };
});
const question = { question: "What did we know?", cutoff: 0 };
const count = { description: "Distinct related records", operation: "countDistinct", field: "recordId" };
const request = (
  body: unknown,
  extraHeaders: Record<string, string> = {},
  url = "http://localhost:3000/api/prototype/chat",
) =>
  new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NEUROFILAMENT_PUBLIC_ONLY", "false");
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
describe("local graph chat endpoint", () => {
  it.each(["VERCEL", "NEUROFILAMENT_PUBLIC_ONLY"])("never starts a desktop assistant on %s, even for a loopback request", async key => {
    vi.stubEnv(key, "true");
    expect((await POST(request(question))).status).toBe(403);
    expect(askCodex).not.toHaveBeenCalled();
  });
  it("uses a server-owned snapshot and validates cited IDs before returning an answer", async () => {
    vi.mocked(askCodex).mockResolvedValue(
      JSON.stringify({ answer: "Maya opened the review.", citations: ["pricing-brief"], chart: null }),
    );
    const response = await POST(request(question));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ citations: ["pricing-brief"] });
    expect(vi.mocked(askCodex).mock.calls[0][0]).not.toContain("84000");
    vi.mocked(askCodex).mockResolvedValue(
      JSON.stringify({ answer: "An unknown claim.", citations: ["q3-attribution"], chart: null }),
    );
    expect((await POST(request(question))).status).toBe(502);
  });
  it("refuses remote hosts, cross-origin questions and oversized data before opening Codex", async () => {
    expect((await POST(request(question, { Origin: "https://example.org" }))).status).toBe(403);
    expect((await POST(request(question, { Host: "example.org" }))).status).toBe(403);
    expect((await POST(request({ ...question, question: "x".repeat(60_000) }))).status).toBe(400);
    expect(askCodex).not.toHaveBeenCalled();
  });
  it("returns the repeatable query alongside source-backed figures for text-only questions", async () => {
    const query: EvidenceQuery = { kind: "evidenceUse", evidenceIds: [], roles: [] };
    vi.mocked(askCodex)
      .mockResolvedValueOnce(
        JSON.stringify({
          answer: "The model guessed 123.",
          citations: [],
          chart: null,
          evidence: { query, chartTitle: null },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ chartRequested: false, source: query, quantities: [count] }),
      );
    const cutoff = events.length - 1;
    const rows = runEvidenceQuery(getSnapshot(cutoff), query);
    const response = await POST(
      request({ cutoff, question: "How often is each piece of evidence used?" }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      query,
      answer: formatEvidenceAnswer(rows, query),
      citations: evidenceCitations(rows),
      chart: null,
    });
  });
  it("returns a distinct unavailable state that can be retried", async () => {
    vi.mocked(askCodex).mockRejectedValue(new ChatUnavailable("Check your Codex sign-in."));
    const response = await POST(request(question));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Check your Codex sign-in." });
  });

  it("resolves both measures of a related scatterplot from the same graph snapshot", async () => {
    const query: RelatedAnalysisQuery = {
      kind: "relatedAnalysis",
      source: { kind: "evidenceUse", evidenceIds: [], roles: ["supports", "contradicts", "informs"] },
      x: { operation: "countDistinct", field: "recordId" },
      y: { operation: "sum", field: "revenue" },
    };
    vi.mocked(askCodex).mockResolvedValue(
      JSON.stringify({
        answer: "$123,456",
        citations: ["made-up"],
        chart: null,
        analysis: { query, chartTitle: "Use and revenue" },
      }),
    );
    const cutoff = events.length - 1;
    const response = await POST(
      request({
        question:
          "Plot how many decisions used each piece of evidence against the total revenue attributed to those decisions.",
        cutoff,
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...summarizeAnalysisAt(getSnapshot(cutoff), query),
      query,
      chart: { type: "relatedScatter", title: "Use and revenue", query },
    });
    expect(askCodex).toHaveBeenCalledTimes(1);
  });

  it("repairs a valid but incomplete count chart using an independent reading of both requested axes", async () => {
    const draft = { kind: "evidenceUse", evidenceIds: [], roles: [] };
    const source = { ...draft, roles: ["supports", "contradicts", "informs"] };
    vi.mocked(askCodex)
      .mockResolvedValueOnce(
        JSON.stringify({
          answer: "",
          citations: [],
          chart: null,
          analysis: { query: draft, chartTitle: "Evidence use by relationship" },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          source,
          chartRequested: true,
          quantities: [
            count,
            { description: "Total attributed revenue", operation: "sum", field: "revenue" },
          ],
        }),
      );
    const body = await (
      await POST(
        request({
          question:
            "Compare how many decisions used each evidence record with all the revenue from those decisions.",
          cutoff: events.length - 1,
        }),
      )
    ).json();
    expect(body.chart).toMatchObject({
      type: "relatedScatter",
      query: {
        source,
        x: { operation: "countDistinct", field: "recordId" },
        y: { operation: "sum", field: "revenue" },
      },
    });
    expect(body.chart.title).not.toBe("Evidence use by relationship");
    expect(body.answer).toContain("$132,000");
    const calls = vi.mocked(askCodex).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[1][0]).toBe(calls[0][0]);
    expect(calls[1][0]).not.toContain("Evidence use by relationship");
    expect(calls[1][2]?.schema).toHaveProperty("properties.quantities");
  });

  it("explains an unsupported second measure without showing a partial chart", async () => {
    const source = { kind: "linkedCount", rowKind: "outcome", linkedKind: "decision", rowIds: [] };
    vi.mocked(askCodex)
      .mockResolvedValueOnce(
        JSON.stringify({
          answer: "",
          citations: [],
          chart: null,
          analysis: { query: source, chartTitle: "Count" },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          source,
          chartRequested: true,
          quantities: [
            count,
            { description: "customer churn", operation: "unavailable", field: "unavailable" },
          ],
        }),
      );
    const body = await (
      await POST(
        request({
          question: "Compare decision counts and customer churn per outcome.",
          cutoff: events.length - 1,
        }),
      )
    ).json();
    expect(body.chart).toBeNull();
    expect(body.answer).toContain("customer churn");
  });

  it("resolves an outcomes-per-decision chart from the recorded cutoff", async () => {
    const query: LinkedCountQuery = {
      kind: "linkedCount",
      rowKind: "decision",
      linkedKind: "outcome",
      rowIds: [],
    };
    const title = "Recorded outcomes per decision";
    vi.mocked(askCodex)
      .mockResolvedValueOnce(
        JSON.stringify({
          answer: "",
          chart: null,
          citations: [],
          evidence: null,
          linked: { query, chartTitle: title },
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({ chartRequested: true, source: query, quantities: [count] }),
      );
    const cutoff = events.findIndex((event) => event.id === "conversion-report");
    const rows = runLinkedCountQuery(getSnapshot(cutoff), query);
    const response = await POST(
      request({ cutoff, question: "Plot how many recorded outcomes are linked to each decision." }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      query,
      answer: formatLinkedCountAnswer(rows, query),
      citations: linkedCountCitations(rows),
      chart: { type: "linkedCount", title, query },
    });
    expect(body.citations).toContain("conversion-report");
    expect(body.citations).not.toContain("invoice-audit");
  });
});
