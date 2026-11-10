import { z } from "zod";
import type { RelatedAnalysisQuery } from "./related-analysis";
import { recordKinds, type RecordKind, type Snapshot, type ViewerEdge, type ViewerNode } from "./data";

export const evidenceRoles = ["supports", "contradicts", "informs", "observes"] as const;
export type EvidenceRole = (typeof evidenceRoles)[number];
export type EvidenceGroupRole = EvidenceRole | "used";

export const evidenceRoleLabels: Record<EvidenceRole, string> = {
  supports: "Explicit support",
  contradicts: "Contradiction",
  informs: "Citation or input",
  observes: "Observation",
};

export const evidenceQuerySchema = z.strictObject({
  kind: z.literal("evidenceUse"),
  evidenceIds: z.array(z.string().min(1).max(120)).max(100),
  roles: z.array(z.enum(evidenceRoles)).max(evidenceRoles.length),
});
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

export function selectedEvidenceRoles(query: EvidenceQuery): EvidenceRole[] {
  return evidenceRoles.filter((role) => !query.roles.length || query.roles.includes(role));
}

export const evidenceChartSchema = z.strictObject({
  type: z.literal("evidence"),
  title: z.string().min(1).max(120),
  query: evidenceQuerySchema,
});
export type EvidenceChartSpec = z.infer<typeof evidenceChartSchema>;

export const linkedCountQuerySchema = z.strictObject({
  kind: z.literal("linkedCount"),
  rowKind: z.enum(recordKinds),
  linkedKind: z.enum(recordKinds),
  rowIds: z.array(z.string().min(1).max(120)).max(100),
});
export type LinkedCountQuery = z.infer<typeof linkedCountQuerySchema>;
export type GraphQuery = EvidenceQuery | LinkedCountQuery | RelatedAnalysisQuery;
export const linkedCountChartSchema = z.strictObject({
  type: z.literal("linkedCount"),
  title: z.string().min(1).max(120),
  query: linkedCountQuerySchema,
});
export type LinkedCountChartSpec = z.infer<typeof linkedCountChartSchema>;

function validateRowIds(snapshot: Snapshot, kind: RecordKind, ids: string[]): string[] {
  const visible = new Set(snapshot.nodes.filter((node) => node.kind === kind).map((node) => node.id));
  if (ids.some((id) => !visible.has(id)))
    throw new Error("The query includes a record outside its scope.");
  return [...new Set(ids)];
}

export function validateLinkedCountQuery(snapshot: Snapshot, raw: unknown): LinkedCountQuery {
  const query = linkedCountQuerySchema.parse(raw);
  return { ...query, rowIds: validateRowIds(snapshot, query.rowKind, query.rowIds) };
}

/** Validate scopes at creation. A saved query can later be run at an earlier event. */
export function validateEvidenceQuery(snapshot: Snapshot, raw: unknown): EvidenceQuery {
  const query = evidenceQuerySchema.parse(raw);
  return {
    ...query,
    evidenceIds: validateRowIds(snapshot, "evidence", query.evidenceIds),
    roles: [...new Set(query.roles)],
  };
}

export type EvidenceUseLink = {
  edgeId: string;
  decisionId: string;
  role: EvidenceRole;
  label: string;
  from: string;
  to: string;
  sourceIds: string[];
};

export type EvidenceUseRow = {
  evidenceId: string;
  title: string;
  sourceIds: string[];
  counts: Record<EvidenceRole, number>;
  /** Distinct decisions in the selected support, contradiction, or citation/input roles. */
  useCount: number;
  /** Distinct linked decisions across selected roles, including observation when selected. */
  decisionCount: number;
  links: EvidenceUseLink[];
};

/** Resolve exactly the relationships counted by a total or role-specific drill-down. */
export function linksForEvidenceGroup(
  row: Pick<EvidenceUseRow, "links">,
  role: EvidenceGroupRole,
): EvidenceUseLink[] {
  return row.links.filter((link) => (role === "used" ? link.role !== "observes" : link.role === role));
}

// The same verb has a different subject when the two endpoints are reversed.
const evidenceToDecision = new Map<string, EvidenceRole>([
  ["supports", "supports"],
  ["contradicts", "contradicts"],
  ["refutes", "contradicts"],
  ["cited by", "informs"],
  ["informed", "informs"],
  ["informs", "informs"],
  ["prompted", "informs"],
  ["observed by", "observes"],
]);
const decisionToEvidence = new Map<string, EvidenceRole>([
  ["supported by", "supports"],
  ["contradicted by", "contradicts"],
  ["refuted by", "contradicts"],
  ["cites", "informs"],
  ["cited", "informs"],
  ["informed by", "informs"],
  ["prompted by", "informs"],
  ["observed", "observes"],
]);

type EdgeDirection = "outgoing" | "incoming";

export type LinkGrouping<Role extends string> = {
  rowKind: ViewerNode["kind"];
  linkedKind: ViewerNode["kind"];
  roles: readonly Role[];
  rowIds?: readonly string[];
  selectedRoles?: readonly Role[];
  includeLinkedSource?: boolean;
  classify: (edge: ViewerEdge, direction: EdgeDirection) => Role | undefined;
};

type CountedLink<Role extends string> = {
  edgeId: string;
  linkedId: string;
  role: Role;
  label: string;
  from: string;
  to: string;
  sourceIds: string[];
};

type LinkedRecordRow<Role extends string> = {
  recordId: string;
  title: string;
  sourceIds: string[];
  counts: Record<Role, number>;
  linkedCount: number;
  links: CountedLink<Role>[];
};
export type LinkedCountRow = LinkedRecordRow<"linked">;

/** The caller supplies a trusted relation vocabulary, never a user-supplied expression. */
export function countLinkedRecords<Role extends string>(
  snapshot: Snapshot,
  grouping: LinkGrouping<Role>,
): LinkedRecordRow<Role>[] {
  const visibleSources = new Set(snapshot.sources.map((source) => source.id));
  const rowIds = new Set(grouping.rowIds);
  const roleScope = new Set(
    grouping.roles.filter(
      (role) => !grouping.selectedRoles?.length || grouping.selectedRoles.includes(role),
    ),
  );
  const rows = new Map<string, LinkedRecordRow<Role>>();
  const linkedOrigins = new Map<string, string[]>();

  for (const node of snapshot.nodes) {
    const origins = (node.originSourceIds ?? (node.sourceId ? [node.sourceId] : [])).filter(id => visibleSources.has(id));
    if (node.kind === grouping.linkedKind) linkedOrigins.set(node.id, origins);
    if (node.kind !== grouping.rowKind || (rowIds.size && !rowIds.has(node.id))) continue;
    // A node may acquire measurement citations later. Only the originating source supports this row.
    const sourceIds = [...origins];
    rows.set(node.id, {
      recordId: node.id,
      title: node.title,
      sourceIds,
      counts: Object.fromEntries(grouping.roles.map((role) => [role, 0])) as Record<Role, number>,
      linkedCount: 0,
      links: [],
    });
  }

  function collect(edge: ViewerEdge, rowId: string, linkedId: string, direction: EdgeDirection) {
    const row = rows.get(rowId);
    if (!row || !linkedOrigins.has(linkedId)) return;
    const role = grouping.classify(edge, direction);
    if (!role || !roleScope.has(role)) return;
    const sourceIds = new Set(row.sourceIds);
    for (const id of edge.sourceIds ?? (edge.sourceId ? [edge.sourceId] : [])) {
      if (visibleSources.has(id)) sourceIds.add(id);
    }
    if (grouping.includeLinkedSource) {
      for (const id of linkedOrigins.get(linkedId)!) sourceIds.add(id);
    }
    row.links.push({
      edgeId: edge.id,
      linkedId,
      role,
      label: edge.label,
      from: edge.from,
      to: edge.to,
      sourceIds: [...sourceIds],
    });
  }

  for (const edge of snapshot.edges) {
    collect(edge, edge.from, edge.to, "outgoing");
    if (edge.from !== edge.to) collect(edge, edge.to, edge.from, "incoming");
  }

  for (const row of rows.values()) {
    row.linkedCount = new Set(row.links.map((link) => link.linkedId)).size;
    for (const role of roleScope) {
      row.counts[role] = new Set(
        row.links.filter((link) => link.role === role).map((link) => link.linkedId),
      ).size;
    }
    row.sourceIds = [...new Set([...row.sourceIds, ...row.links.flatMap((link) => link.sourceIds)])];
  }
  return [...rows.values()];
}

/** Count direct neighbors only. Multiple relationship claims to one neighbor remain available for inspection. */
export function runLinkedCountQuery(snapshot: Snapshot, query: LinkedCountQuery): LinkedCountRow[] {
  return countLinkedRecords(snapshot, {
    rowKind: query.rowKind,
    linkedKind: query.linkedKind,
    rowIds: query.rowIds,
    roles: ["linked"] as const,
    includeLinkedSource: true,
    classify: (edge) => (edge.from !== edge.to ? "linked" : undefined),
  });
}

export function recordKindName(kind: RecordKind, count: number): string {
  if (kind === "entry") return count === 1 ? "entry" : "entries";
  const label = kind === "evidence" ? "evidence record" : kind === "external" ? "external reference" : kind;
  return count === 1 ? label : label + "s";
}

export function formatLinkedCountAnswer(rows: LinkedCountRow[], query: LinkedCountQuery): string {
  if (!rows.length)
    return `No matching ${recordKindName(query.rowKind, 0)} are visible at this point in the timeline.`;
  const lines = rows.map(
    (row) => `${row.title} — ${row.linkedCount} ${recordKindName(query.linkedKind, row.linkedCount)}.`,
  );
  return [
    `Each row counts distinct recorded ${recordKindName(query.linkedKind, 0)} directly linked to that ${recordKindName(query.rowKind, 1)}.`,
    ...lines,
  ].join("\n");
}

export function linkedCountCitations(rows: LinkedCountRow[]): string[] {
  return [
    ...new Set(
      rows.flatMap((row) => [row.recordId, ...row.links.map((link) => link.linkedId), ...row.sourceIds]),
    ),
  ];
}

/** Counts unique decisions per relationship. Evidence with no matching links has a recorded count of zero. */
export function runEvidenceQuery(snapshot: Snapshot, query: EvidenceQuery): EvidenceUseRow[] {
  const grouped = countLinkedRecords(snapshot, {
    rowKind: "evidence",
    linkedKind: "decision",
    roles: evidenceRoles,
    rowIds: query.evidenceIds,
    selectedRoles: selectedEvidenceRoles(query),
    classify: (edge, direction) =>
      (direction === "outgoing" ? evidenceToDecision : decisionToEvidence).get(edge.label),
  });
  return grouped.map((row) => {
    const links = row.links.map(({ linkedId, ...link }) => ({ ...link, decisionId: linkedId }));
    const used = linksForEvidenceGroup({ links }, "used");
    return {
      evidenceId: row.recordId,
      title: row.title,
      sourceIds: row.sourceIds,
      counts: row.counts,
      decisionCount: row.linkedCount,
      useCount: new Set(used.map((link) => link.decisionId)).size,
      links,
    };
  });
}

const verbs: Record<EvidenceRole, string> = {
  supports: "explicitly supported",
  contradicts: "explicitly contradicted",
  informs: "informed or was cited by",
  observes: "was observed by",
};

export function formatEvidenceAnswer(rows: EvidenceUseRow[], query: EvidenceQuery): string {
  if (!rows.length) return "No matching evidence records are visible at this point in the timeline.";
  const roles = selectedEvidenceRoles(query);
  const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });
  const lines = rows.map((row) => {
    const counts = roles.map((role) => {
      const count = row.counts[role];
      return verbs[role] + " " + count + (count === 1 ? " decision" : " decisions");
    });
    const usage = roles.some((role) => role !== "observes")
      ? "used by " +
        row.useCount +
        (row.useCount === 1 ? " decision" : " decisions") +
        " in the selected roles. It "
      : "";
    return row.title + " — " + usage + list.format(counts) + ".";
  });
  return [
    "Each count is the number of distinct decisions with that recorded relationship.",
    ...lines,
  ].join("\n");
}

export function evidenceCitations(rows: EvidenceUseRow[]): string[] {
  return [...new Set(rows.flatMap((row) => [row.evidenceId, ...row.sourceIds]))];
}
