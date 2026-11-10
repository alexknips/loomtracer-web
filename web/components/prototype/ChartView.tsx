"use client";

import { useState } from "react";
import {
  REPORT_PERIOD,
  type ChartSpec,
  type DecisionMetric,
  type MetricChartSpec,
  type Snapshot,
  type ViewerNode,
} from "@/lib/prototype/data";
import styles from "./chart.module.css";
import ScatterPlot, { plotAxis } from "./ScatterPlot";
import LinkedCountView from "./LinkedCountView";
import RelatedScatterView from "./RelatedScatterView";
import EvidenceUseChart, { type EvidenceGroup } from "./EvidenceUseChart";

type Measure = "aiShare" | "revenue";
type Row = { node: ViewerNode; metric: DecisionMetric };
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const compactMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function format(value: number, key: Measure, compact = false) {
  return key === "aiShare" ? value + "%" : (compact ? compactMoney : money).format(value);
}

function axisName(key: Measure) {
  return key === "aiShare" ? "Assessed AI influence" : "Attributed revenue · USD";
}

function metricAxis(rows: Row[], key: Measure) {
  return plotAxis(
    rows.map(({ metric }) => metric[key]!),
    axisName(key),
    (value, compact) => format(value, key, compact),
    key === "aiShare" ? "percent" : "numeric",
  );
}

function BarPlot({
  rows,
  measure,
  selectedId,
  onSelect,
}: {
  rows: Row[];
  measure: Measure;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const max = metricAxis(rows, measure).ticks.at(-1)!;
  return (
    <div className={styles.bars} aria-label={`Decisions ranked by ${axisName(measure)}`}>
      <div className={styles.barAxis}>{axisName(measure)}</div>
      {rows.map(({ node, metric }) => {
        const value = metric[measure]!;
        return (
          <button
            type="button"
            key={node.id}
            className={styles.barRow}
            aria-pressed={node.id === selectedId}
            onClick={() => onSelect(node.id)}
          >
            <span className={styles.barLabel}>{node.title}</span>
            <span className={styles.barTrack}>
              <span style={{ width: (value / max) * 100 + "%" }} />
            </span>
            <span className={styles.barValue}>{format(value, measure)}</span>
          </button>
        );
      })}
    </div>
  );
}

export type ChartFocus = EvidenceGroup | { recordId: string };

type ChartViewProps = {
  snapshot: Snapshot;
  spec: ChartSpec;
  selectedId: string | null;
  onSelect: (id: string) => void;
  initialFocus?: ChartFocus;
};

export default function ChartView(props: ChartViewProps) {
  const focus = props.initialFocus;
  if (props.spec.type === "relatedScatter") {
    return (
      <RelatedScatterView
        {...props}
        spec={props.spec}
        initialRowId={focus && "recordId" in focus ? focus.recordId : undefined}
      />
    );
  }
  if (props.spec.type === "linkedCount")
    return (
      <LinkedCountView
        {...props}
        spec={props.spec}
        initialRowId={focus && "recordId" in focus ? focus.recordId : undefined}
      />
    );
  if (props.spec.type === "evidence")
    return (
      <EvidenceUseChart
        {...props}
        spec={props.spec}
        initialGroup={focus && "evidenceId" in focus ? focus : undefined}
      />
    );
  return <MetricChart {...props} spec={props.spec} />;
}

function MetricChart({
  snapshot,
  spec,
  selectedId,
  onSelect,
}: {
  snapshot: Snapshot;
  spec: MetricChartSpec;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const scatter = spec.type === "scatter";
  const x: Measure = spec.x === "aiShare" ? "aiShare" : "revenue";
  const y: Measure = spec.y === "aiShare" ? "aiShare" : "revenue";
  const scopedMetrics = snapshot.metrics.filter(
    (m) => !spec.decisionIds.length || spec.decisionIds.includes(m.nodeId),
  );
  const nodes = new Map(snapshot.nodes.map((item) => [item.id, item]));
  const rows: Row[] = [];
  for (const metric of scopedMetrics) {
    const node = nodes.get(metric.nodeId);
    if (node && metric[x] !== null && (!scatter || metric[y] !== null)) rows.push({ node, metric });
  }
  if (!scatter) rows.sort((a, b) => b.metric[x]! - a.metric[x]!);
  const usedSourceIds = new Set(
    rows.flatMap(({ metric }) => [
      x === "aiShare" ? metric.aiSourceId : metric.revenueSourceId,
      ...(scatter ? [y === "aiShare" ? metric.aiSourceId : metric.revenueSourceId] : []),
    ]),
  );
  const sources = snapshot.sources.filter((s) => usedSourceIds.has(s.id));
  const activeSource = sources.find((s) => s.id === sourceId);
  const plottedIds = new Set(rows.map((row) => row.node.id));
  const missing = scopedMetrics.filter((metric) => !plottedIds.has(metric.nodeId));
  return (
    <section className={styles.chart} aria-label={spec.title}>
      <header className={styles.header}>
        <div>
          <h2>{spec.title}</h2>
          <p>
            {scatter
              ? "Each point is one decision."
              : "Decisions ranked by " + axisName(x).toLowerCase() + "."}{" "}
            {rows.length} of {scopedMetrics.length} decisions plotted.
          </p>
        </div>
        <span className={styles.period}>
          {x === "revenue" || (scatter && y === "revenue") ? REPORT_PERIOD : "Assessment"}
        </span>
      </header>
      {rows.length > 0 ? (
        <>
          {scatter ? (
            <ScatterPlot
              data={rows.map(({ node, metric }) => ({
                id: node.id,
                title: node.title,
                summary: node.summary,
                x: metric[x]!,
                y: metric[y]!,
              }))}
              x={metricAxis(rows, x)}
              y={metricAxis(rows, y)}
              groupLabel="decisions"
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ) : (
            <BarPlot rows={rows} measure={x} selectedId={selectedId} onSelect={onSelect} />
          )}
        </>
      ) : (
        <div className={styles.empty}>
          No decisions have the required measurements at this point in the timeline.
        </div>
      )}
      {missing.length > 0 && (
        <details className={styles.missing}>
          <summary>
            {missing.length} {missing.length === 1 ? "decision lacks" : "decisions lack"} a reported
            value for {scatter ? "one or both axes" : "this measure"}.
          </summary>
          <ul>
            {missing.map((metric) => {
              const node = nodes.get(metric.nodeId)!;
              const absent = [...new Set(scatter ? [x, y] : [x])].filter(
                (measure) => metric[measure] === null,
              );
              return (
                <li key={node.id}>
                  <button type="button" onClick={() => onSelect(node.id)}>
                    {node.title}
                  </button>{" "}
                  · {absent.map(axisName).join(", ")}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {sources.length > 0 && (
        <div className={styles.sources}>
          <span>Source records</span>
          {sources.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => setSourceId(activeSource?.id === s.id ? null : s.id)}
              aria-expanded={activeSource?.id === s.id}
            >
              {s.title}
            </button>
          ))}
        </div>
      )}
      {activeSource && (
        <div className={styles.report}>
          <strong>{activeSource.title}</strong>
          <small>
            {activeSource.author} · {activeSource.date}
          </small>
          <p>{activeSource.excerpt}</p>
        </div>
      )}
    </section>
  );
}
