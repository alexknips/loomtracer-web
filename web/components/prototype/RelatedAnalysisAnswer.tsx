import { useMemo } from "react";
import { events, type Snapshot } from "@/lib/prototype/data";
import {
  analysisAxisLabel,
  runRelatedAnalysis,
  formatAnalysisCell,
  type RelatedAnalysisQuery,
} from "@/lib/prototype/related-analysis";
import { formatEventDate } from "./Timeline";
import { Icon } from "./Icon";
import styles from "./prototype.module.css";

export default function RelatedAnalysisAnswer({
  snapshot,
  query,
  onRow,
}: {
  snapshot: Snapshot;
  query: RelatedAnalysisQuery;
  onRow: (id: string) => void;
}) {
  const rows = useMemo(() => runRelatedAnalysis(snapshot, query), [snapshot, query]);
  const event = events[snapshot.cutoff];
  return (
    <section className={styles.chatCounts} aria-label="Comparison at the playhead">
      <div className={styles.countsDate}>
        At the playhead · {formatEventDate(event.date)} · {snapshot.cutoff + 1}/{events.length}
      </div>
      {rows.length ? (
        rows.map((row) => (
          <button
            key={row.id}
            className={styles.comparisonRow}
            type="button"
            onClick={() => onRow(row.id)}
            aria-label={"Inspect " + row.title}
          >
            <strong>
              {row.title}
              <Icon name="arrow" size={14} />
            </strong>
            {(["x", "y"] as const).map((axis) => (
              <span key={axis}>
                <span>{analysisAxisLabel(query[axis], query.source)}</span>
                <b>{formatAnalysisCell(row[axis], query[axis])}</b>
              </span>
            ))}
          </button>
        ))
      ) : (
        <p>No matching records at this point in the timeline.</p>
      )}
    </section>
  );
}
