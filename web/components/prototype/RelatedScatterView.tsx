"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { REPORT_PERIOD, type Snapshot } from "@/lib/prototype/data";
import { recordKindName } from "@/lib/prototype/graph-query";
import {
  analysisAxisLabel,
  analysisRowKind,
  formatAnalysisCell,
  formatAnalysisValue,
  hasCompleteCoordinates,
  runRelatedAnalysis,
  type AnalysisMeasure,
  type RelatedRow,
  type RelatedScatterChartSpec,
} from "@/lib/prototype/related-analysis";
import ScatterPlot, { plotAxis } from "./ScatterPlot";
import { Icon } from "./Icon";
import { recordColors } from "./graphColors";
import styles from "./chart.module.css";

function Breakdown({
  row,
  snapshot,
  spec,
  onSelect,
  onClose,
}: {
  row: RelatedRow;
  snapshot: Snapshot;
  spec: RelatedScatterChartSpec;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [row.id]);
  const query = spec.query;
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const memberKind = query.source.kind === "evidenceUse" ? "decision" : query.source.linkedKind;
  const axes = [
    { measure: query.x, cell: row.x },
    { measure: query.y, cell: row.y },
  ];
  const fields = [
    ...new Set(axes.map(({ measure }) => measure.field).filter((field) => field !== "recordId")),
  ];
  const sourceButtons = (ids: Iterable<string>) => (
    <div className={styles.relationSources}>
      {[...new Set(ids)].map((id) => {
        const source = sources.get(id);
        return (
          source && (
            <button type="button" key={id} onClick={() => onSelect(id)}>
              <Icon name="file" size={13} />
              {source.title}
            </button>
          )
        );
      })}
    </div>
  );

  function memberDetail(member: RelatedRow["members"][number], excluded: boolean) {
    const sourceIds = new Set(member.links.flatMap((link) => link.sourceIds));
    const values = excluded
      ? []
      : fields.map((field) => {
          const measure = axes.find((axis) => axis.measure.field === field)!.measure;
          const value = member.metrics[field];
          const sourceId =
            field === "revenue" ? member.metrics.revenueSourceId : member.metrics.aiSourceId;
          if (sourceId) sourceIds.add(sourceId);
          return { field, text: value === null ? "Unreported" : formatAnalysisValue(value, measure) };
        });
    return (
      <li key={member.id} className={styles.contributor}>
        <button type="button" className={styles.recordLink} onClick={() => onSelect(member.id)}>
          {member.title}
          <Icon name="arrow" size={14} />
        </button>
        {values.map(({ field, text }) => (
          <p key={field}>
            {field === "revenue" ? "Attributed revenue" : "Assessed AI influence"} ·{" "}
            <strong>{text}</strong>
          </p>
        ))}
        {member.links.map((link) => (
          <p key={link.edgeId} className={styles.originalLink}>
            {nodes.get(link.from)?.title ?? link.from} <strong>{link.label}</strong>{" "}
            {nodes.get(link.to)?.title ?? link.to}
          </p>
        ))}
        {sourceButtons(sourceIds)}
      </li>
    );
  }

  return (
    <section
      ref={section}
      className={styles.breakdown}
      data-testid="related-breakdown"
      aria-label="Records behind this point"
    >
      <header>
        <h3>
          <button type="button" className={styles.recordLink} onClick={() => onSelect(row.id)}>
            {row.title}
            <Icon name="arrow" size={14} />
          </button>
        </h3>
        <button
          type="button"
          className={styles.closeBreakdown}
          aria-label="Close group breakdown"
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      <dl className={styles.breakdownValues}>
        {axes.map(({ measure, cell }, i) => (
          <div key={i}>
            <dt>{analysisAxisLabel(measure, query.source)}</dt>
            <dd>
              {cell.status === "partial" && <strong>Full value unavailable. </strong>}
              {formatAnalysisCell(cell, measure)}
            </dd>
          </div>
        ))}
      </dl>
      <h4>
        {row.members.length} contributing {recordKindName(memberKind, row.members.length)}
      </h4>
      <ul>{row.members.map((member) => memberDetail(member, false))}</ul>
      {row.excludedMembers.length > 0 && (
        <details className={styles.excluded}>
          <summary>
            {row.excludedMembers.length} linked {recordKindName(memberKind, row.excludedMembers.length)}{" "}
            excluded from these measures
          </summary>
          <ul>{row.excludedMembers.map((member) => memberDetail(member, true))}</ul>
        </details>
      )}
      {!row.members.length && !row.excludedMembers.length && sourceButtons(row.sourceIds)}
    </section>
  );
}

export default function RelatedScatterView({
  spec,
  snapshot,
  initialRowId,
  onSelect,
}: {
  spec: RelatedScatterChartSpec;
  snapshot: Snapshot;
  initialRowId?: string;
  onSelect: (id: string) => void;
}) {
  const { query } = spec;
  const rows = useMemo(() => runRelatedAnalysis(snapshot, query), [snapshot, query]);
  const [active, setActive] = useState<string | null>(initialRowId ?? null);
  const host = useRef<HTMLElement>(null);
  const activeRow = rows.find((row) => row.id === active);
  if (active && !activeRow) setActive(null);
  const rowKind = analysisRowKind(query.source);
  const memberKind = query.source.kind === "evidenceUse" ? "decision" : query.source.linkedKind;
  const hasRevenue = query.x.field === "revenue" || query.y.field === "revenue";
  const complete = rows.filter(hasCompleteCoordinates);
  const missing = rows.filter((row) => !hasCompleteCoordinates(row));
  const records = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const data = complete.map((row) => ({
    id: row.id,
    title: row.title,
    summary: records.get(row.id)?.summary ?? "",
    x: row.x.value!,
    y: row.y.value!,
  }));
  function axis(measure: AnalysisMeasure, values: number[]) {
    const scale =
      measure.field === "recordId" ? "count" : measure.field === "aiShare" ? "percent" : "numeric";
    return plotAxis(
      values,
      analysisAxisLabel(measure, query.source),
      (v, compact) => formatAnalysisValue(v, measure, compact),
      scale,
    );
  }
  function close() {
    if (!active) return;
    const id = CSS.escape(active);
    setActive(null);
    host.current
      ?.querySelector<SVGGElement | HTMLButtonElement>(`[data-point="${id}"], [data-unplotted="${id}"]`)
      ?.focus();
  }
  return (
    <section ref={host} className={styles.chart} aria-label={spec.title} data-testid="related-scatter">
      <header className={styles.header}>
        <div>
          <h2>{spec.title}</h2>
          <p>
            {data.length} of {rows.length} {recordKindName(rowKind, rows.length)} plotted.{" "}
            {hasRevenue
              ? "Revenue is attributed to decisions, which can appear in multiple groups."
              : `Each point summarizes distinct linked ${recordKindName(memberKind, 2)}. A linked record can appear in more than one group.`}
          </p>
        </div>
        {hasRevenue && <span className={styles.period}>{REPORT_PERIOD}</span>}
      </header>
      {data.length > 0 ? (
        <ScatterPlot
          data={data}
          x={axis(
            query.x,
            data.map((point) => point.x),
          )}
          y={axis(
            query.y,
            data.map((point) => point.y),
          )}
          color={recordColors[rowKind]}
          groupLabel={recordKindName(rowKind, 2)}
          hasFootnote={missing.length > 0}
          selectedId={active}
          onSelect={setActive}
        />
      ) : (
        <p className={styles.empty}>
          {rows.length
            ? "No groups have complete values for both axes at this point in the timeline."
            : `No matching ${recordKindName(rowKind, 2)} are visible at this point in the timeline.`}
        </p>
      )}
      {missing.length > 0 && (
        <div className={styles.unplotted} data-plot-footnote aria-label="Groups with incomplete values">
          <h3>Unplotted {recordKindName(rowKind, missing.length)}</h3>
          <ul>
            {missing.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.recordLink}
                  aria-expanded={active === row.id}
                  data-testid={`unplotted-${row.id}`}
                  data-unplotted={row.id}
                  onClick={() => setActive(row.id)}
                >
                  {row.title}
                  <Icon name="arrow" size={14} />
                </button>
                {[
                  { cell: row.x, measure: query.x },
                  { cell: row.y, measure: query.y },
                ]
                  .filter(({ cell }) => cell.status !== "complete")
                  .map(({ cell, measure }) => (
                    <p key={analysisAxisLabel(measure, query.source)}>
                      {analysisAxisLabel(measure, query.source)} · {formatAnalysisCell(cell, measure)}
                    </p>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {activeRow && (
        <Breakdown row={activeRow} snapshot={snapshot} spec={spec} onSelect={onSelect} onClose={close} />
      )}
    </section>
  );
}
