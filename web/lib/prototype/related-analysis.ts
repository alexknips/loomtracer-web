import { z } from "zod";
import { REPORT_PERIOD, type Snapshot, type DecisionMetric, type RecordKind } from "./data";
import {
  evidenceQuerySchema,
  linkedCountQuerySchema,
  recordKindName,
  runEvidenceQuery,
  runLinkedCountQuery,
  selectedEvidenceRoles,
  validateEvidenceQuery,
  validateLinkedCountQuery,
  type EvidenceQuery,
  type EvidenceRole,
  type LinkedCountQuery,
} from "./graph-query";

export type AnalysisSource = EvidenceQuery | LinkedCountQuery;

export function analysisRowKind(source: AnalysisSource): RecordKind {
  return source.kind === "evidenceUse" ? "evidence" : source.rowKind;
}

/** Analytical rollups default to the same distinct membership as the evidence chart's Used by group. */
export function relatedEvidenceRoles(source: EvidenceQuery): EvidenceRole[] {
  return source.roles.length ? selectedEvidenceRoles(source) : ["supports", "contradicts", "informs"];
}
const analysisMeasureSchema = z.strictObject({
  operation: z.enum(["countDistinct", "sum", "mean"]),
  field: z.enum(["recordId", "revenue", "aiShare"]),
});
export type AnalysisMeasure = z.infer<typeof analysisMeasureSchema>;
export const relatedAnalysisQuerySchema = z.strictObject({
  kind: z.literal("relatedAnalysis"),
  source: z.union([evidenceQuerySchema, linkedCountQuerySchema]),
  x: analysisMeasureSchema,
  y: analysisMeasureSchema,
});
export type RelatedAnalysisQuery = z.infer<typeof relatedAnalysisQuerySchema>;
function measureError(query: RelatedAnalysisQuery): string | null {
  const linkedKind = query.source.kind === "evidenceUse" ? "decision" : query.source.linkedKind;
  for (const measure of [query.x, query.y]) {
    if ((measure.operation === "countDistinct") !== (measure.field === "recordId")) {
      return "Use recordId to count distinct related records or select a numeric field to sum or average.";
    }
    if (measure.field !== "recordId" && linkedKind !== "decision") {
      return "The requested metric is recorded on decisions.";
    }
    if (measure.field === "aiShare" && measure.operation === "sum") {
      return "Assessed influence is a percentage. Use a mean across decisions.";
    }
  }
  if (query.x.operation === query.y.operation && query.x.field === query.y.field) {
    return "Select two different measures for the axes.";
  }
  return null;
}

export const relatedScatterChartSchema = z
  .strictObject({
    type: z.literal("relatedScatter"),
    title: z.string().trim().min(1).max(120),
    query: relatedAnalysisQuerySchema,
  })
  .refine((chart) => !measureError(chart.query), "Unsupported axis combination");
export type RelatedScatterChartSpec = z.infer<typeof relatedScatterChartSchema>;

export function validateRelatedAnalysisQuery(snapshot: Snapshot, raw: unknown): RelatedAnalysisQuery {
  const parsed = relatedAnalysisQuerySchema.parse(raw);
  const error = measureError(parsed);
  if (error) throw new Error(error);
  const source =
    parsed.source.kind === "evidenceUse"
      ? validateEvidenceQuery(snapshot, parsed.source)
      : validateLinkedCountQuery(snapshot, parsed.source);
  return { ...parsed, source };
}

type MetricFields = Pick<DecisionMetric, "revenue" | "aiShare" | "revenueSourceId" | "aiSourceId">;
export type AnalysisLink = {
  edgeId: string;
  label: string;
  from: string;
  to: string;
  role: EvidenceRole | "linked" | "unclassified";
  sourceIds: string[];
};
export type RelatedMember = {
  id: string;
  title: string;
  links: AnalysisLink[];
  metrics: MetricFields;
};
export type AnalysisCell = {
  /** A partial value is calculated from reported members only and cannot supply a plotted coordinate. */
  value: number | null;
  status: "complete" | "partial" | "unreported" | "empty";
  includedIds: string[];
  missingIds: string[];
  sourceIds: string[];
};
export type RelatedRow = {
  id: string;
  title: string;
  sourceIds: string[];
  x: AnalysisCell;
  y: AnalysisCell;
  members: RelatedMember[];
  excludedMembers: RelatedMember[];
};

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function metricFields(metric: DecisionMetric | undefined, sources: Set<string>): MetricFields {
  const present = (value: number | null | undefined, id: string | null | undefined) =>
    Number.isFinite(value) && id && sources.has(id) ? id : null;
  const aiSourceId = present(metric?.aiShare, metric?.aiSourceId);
  const revenueSourceId = present(metric?.revenue, metric?.revenueSourceId);
  return {
    aiShare: aiSourceId ? (metric?.aiShare ?? null) : null,
    revenue: revenueSourceId ? (metric?.revenue ?? null) : null,
    aiSourceId,
    revenueSourceId,
  };
}

function aggregate(members: RelatedMember[], measure: AnalysisMeasure): AnalysisCell {
  const includedIds: string[] = [];
  const missingIds: string[] = [];
  const sourceIds = new Set<string>();
  let sum = 0;
  for (const member of members) {
    for (const link of member.links) for (const id of link.sourceIds) sourceIds.add(id);
    if (measure.field === "recordId") {
      includedIds.push(member.id);
      continue;
    }
    const value = member.metrics[measure.field];
    const report =
      measure.field === "revenue" ? member.metrics.revenueSourceId : member.metrics.aiSourceId;
    if (value === null || !report) {
      missingIds.push(member.id);
    } else {
      sum += value;
      includedIds.push(member.id);
      sourceIds.add(report);
    }
  }
  const ids = { includedIds, missingIds, sourceIds: [...sourceIds] };
  if (measure.operation === "countDistinct")
    return { ...ids, value: includedIds.length, status: "complete" };
  if (!members.length) {
    return measure.operation === "sum"
      ? { ...ids, value: 0, status: "complete" }
      : { ...ids, value: null, status: "empty" };
  }
  if (!includedIds.length) return { ...ids, value: null, status: "unreported" };
  return {
    ...ids,
    value: measure.operation === "sum" ? sum : sum / includedIds.length,
    status: missingIds.length ? "partial" : "complete",
  };
}

/** Replay the supplied snapshot. Reusing a saved scope earlier in time cannot reveal a future record. */
export function runRelatedAnalysis(snapshot: Snapshot, query: RelatedAnalysisQuery): RelatedRow[] {
  const { source } = query;
  const directSource: LinkedCountQuery =
    source.kind === "linkedCount"
      ? source
      : {
          kind: "linkedCount",
          rowKind: "evidence",
          linkedKind: "decision",
          rowIds: source.evidenceIds,
        };
  const rows = runLinkedCountQuery(snapshot, directSource);
  // The evidence vocabulary owns direction and role semantics. Raw adjacency alone does not imply use.
  const evidenceRolesByEdge = new Map<string, EvidenceRole>();
  const roleScope = source.kind === "evidenceUse" ? new Set(relatedEvidenceRoles(source)) : null;
  if (source.kind === "evidenceUse") {
    for (const row of runEvidenceQuery(snapshot, { ...source, roles: [] })) {
      for (const link of row.links) evidenceRolesByEdge.set(link.edgeId, link.role);
    }
  }
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const visibleSources = new Set(snapshot.sources.map((record) => record.id));
  const metrics = new Map(
    snapshot.metrics.map((metric) => [metric.nodeId, metricFields(metric, visibleSources)]),
  );
  const unmeasured = metricFields(undefined, visibleSources);

  return rows.map((row) => {
    const included = new Map<string, RelatedMember>();
    const excluded = new Map<string, RelatedMember>();
    for (const link of row.links) {
      const classified = evidenceRolesByEdge.get(link.edgeId);
      const qualifies = !roleScope || (classified !== undefined && roleScope.has(classified));
      const members = qualifies ? included : excluded;
      let member = members.get(link.linkedId);
      if (!member) {
        member = {
          id: link.linkedId,
          title: nodes.get(link.linkedId)!.title,
          metrics: metrics.get(link.linkedId) ?? unmeasured,
          links: [],
        };
        members.set(member.id, member);
      }
      member.links.push({
        edgeId: link.edgeId,
        label: link.label,
        from: link.from,
        to: link.to,
        role: roleScope ? (classified ?? "unclassified") : "linked",
        sourceIds: link.sourceIds,
      });
    }
    const members = [...included.values()];
    // Multiple relationships to one decision still contribute its measure exactly once.
    const excludedMembers = [...excluded.values()].filter((m) => !included.has(m.id));
    const x = aggregate(members, query.x);
    const y = aggregate(members, query.y);
    const origin = nodes.get(row.recordId)?.sourceId;
    const excludedSources = excludedMembers.flatMap((m) => m.links.flatMap((link) => link.sourceIds));
    return {
      id: row.recordId,
      title: row.title,
      members,
      excludedMembers,
      x,
      y,
      sourceIds: distinct([
        ...(origin && visibleSources.has(origin) ? [origin] : []),
        ...x.sourceIds,
        ...y.sourceIds,
        ...excludedSources,
      ]),
    };
  });
}

export function hasCompleteCoordinates(row: RelatedRow): boolean {
  return (
    row.x.status === "complete" &&
    row.y.status === "complete" &&
    row.x.value !== null &&
    row.y.value !== null
  );
}

export function analysisAxisLabel(measure: AnalysisMeasure, source: AnalysisSource): string {
  if (measure.field === "recordId") {
    if (source.kind === "evidenceUse" && !relatedEvidenceRoles(source).includes("observes")) {
      return "Distinct decisions using evidence";
    }
    return (
      "Distinct linked " +
      recordKindName(source.kind === "evidenceUse" ? "decision" : source.linkedKind, 0)
    );
  }
  const operation = measure.operation === "mean" ? "Mean" : "Total";
  return measure.field === "revenue"
    ? operation + " attributed revenue (USD)"
    : operation + " assessed AI influence";
}

const dollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const shortDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function formatAnalysisValue(
  value: number | null,
  measure: AnalysisMeasure,
  compact = false,
): string {
  if (value === null) return "Unreported";
  if (measure.field === "revenue") return (compact ? shortDollars : dollars).format(value);
  return number.format(value) + (measure.field === "aiShare" ? "%" : "");
}

export function formatAnalysisCell(cell: AnalysisCell, measure: AnalysisMeasure): string {
  if (cell.status === "empty") return "Unavailable (no related records)";
  const coverage =
    cell.includedIds.length + " of " + (cell.includedIds.length + cell.missingIds.length) + " measured";
  if (cell.status === "unreported") return "Unreported (" + coverage + ")";
  const value = formatAnalysisValue(cell.value, measure);
  if (cell.status === "partial") {
    const name = measure.operation === "sum" ? "known subtotal" : "mean of reported values";
    return value + " " + name + " (" + coverage + ")";
  }
  return value;
}

function describeCell(cell: AnalysisCell, measure: AnalysisMeasure, row: RelatedRow): string {
  const missing = row.members.filter((m) => cell.missingIds.includes(m.id)).map((m) => m.title);
  return formatAnalysisCell(cell, measure) + (missing.length ? " — missing " + missing.join(", ") : "");
}

export function formatRelatedAnswer(rows: RelatedRow[], query: RelatedAnalysisQuery): string {
  if (!rows.length) return "No records match the row scope at this point in the timeline.";
  const lines = rows.map((row) => {
    const axes = [
      analysisAxisLabel(query.x, query.source) + " " + describeCell(row.x, query.x, row),
      analysisAxisLabel(query.y, query.source) + " " + describeCell(row.y, query.y, row),
    ];
    const excluded = row.excludedMembers.map(
      (m) => m.title + " (" + distinct(m.links.map((l) => l.label)).join(", ") + ")",
    );
    const coverage = hasCompleteCoordinates(row)
      ? ""
      : " Incomplete measurements keep this row off the plot.";
    return (
      row.title +
      " — " +
      axes.join(", ") +
      "." +
      coverage +
      (excluded.length ? " The selected relationship roles exclude " + excluded.join(", ") + "." : "")
    );
  });
  const hasRevenue = query.x.field === "revenue" || query.y.field === "revenue";
  const note = hasRevenue
    ? REPORT_PERIOD +
      " revenue is attributed to decisions. A decision can be linked to more than one row."
    : "A related record contributes at most once per row.";
  return [note, ...lines].join("\n");
}

export function relatedCitations(rows: RelatedRow[]): string[] {
  return distinct(
    rows.flatMap((row) => [
      row.id,
      ...row.members.map((m) => m.id),
      ...row.excludedMembers.map((m) => m.id),
      ...row.sourceIds,
    ]),
  );
}
