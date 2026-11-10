import { useMemo } from "react";
import { recordKindName } from "@/lib/prototype/graph-query";
import type { ChartSpec, RecordKind, Snapshot } from "@/lib/prototype/data";
import styles from "./prototype.module.css";

const charts: ChartSpec[] = [
  {
    type: "relatedScatter",
    title: "Evidence use vs. attributed revenue",
    query: {
      kind: "relatedAnalysis",
      source: { kind: "evidenceUse", evidenceIds: [], roles: [] },
      x: { operation: "countDistinct", field: "recordId" },
      y: { operation: "sum", field: "revenue" },
    },
  },
  {
    type: "evidence",
    title: "Evidence use by relationship",
    query: { kind: "evidenceUse", evidenceIds: [], roles: [] },
  },
  {
    type: "linkedCount",
    title: "Recorded outcomes per decision",
    query: { kind: "linkedCount", rowKind: "decision", linkedKind: "outcome", rowIds: [] },
  },
  {
    type: "scatter",
    title: "AI influence vs. attributed revenue",
    x: "aiShare",
    y: "revenue",
    decisionIds: [],
  },
];

/** Rows and measures come from recorded direct neighbors at the playhead. */
function relationshipCharts(snapshot: Snapshot): ChartSpec[] {
  const kinds = new Map(snapshot.nodes.map((node) => [node.id, node.kind]));
  const pairs = new Map<string, ChartSpec>();
  function add(rowKind: RecordKind, linkedKind: RecordKind) {
    const key = rowKind + "/" + linkedKind;
    if (!pairs.has(key)) pairs.set(key, {
      type: "linkedCount",
      title: "Linked " + recordKindName(linkedKind, 2) + " per " + recordKindName(rowKind, 1),
      query: { kind: "linkedCount", rowKind, linkedKind, rowIds: [] },
    });
  }
  for (const edge of snapshot.edges) {
    const from = kinds.get(edge.from), to = kinds.get(edge.to);
    if (from && to && edge.from !== edge.to) {
      add(from, to);
      add(to, from);
    }
  }
  return [...pairs.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function ChartExamples({ snapshot, onOpen }: { snapshot?: Snapshot; onOpen: (chart: ChartSpec) => void }) {
  const options = useMemo(() => snapshot ? relationshipCharts(snapshot) : charts, [snapshot]);
  if (!options.length) return null;
  return (
    <select
      className={styles.chartPicker}
      aria-label={snapshot ? "Open a relationship chart" : "Open an example chart"}
      value=""
      onChange={(event) => {
        const chart = options.find((item) => item.title === event.target.value);
        if (chart) onOpen(chart);
      }}
    >
      <option value="" disabled>Charts</option>
      {options.map((chart) => <option key={chart.title} value={chart.title}>{chart.title}</option>)}
    </select>
  );
}
