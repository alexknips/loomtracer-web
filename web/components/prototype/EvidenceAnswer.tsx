import { events, type Snapshot } from "@/lib/prototype/data";
import {
  evidenceRoleLabels,
  runEvidenceQuery,
  selectedEvidenceRoles,
  type EvidenceQuery,
  type EvidenceGroupRole,
} from "@/lib/prototype/graph-query";
import { formatEventDate } from "./Timeline";
import styles from "./prototype.module.css";

type Props = {
  snapshot: Snapshot;
  query: EvidenceQuery;
  onGroup: (evidenceId: string, role: EvidenceGroupRole) => void;
};

export default function EvidenceAnswer({ snapshot, query, onGroup }: Props) {
  const rows = runEvidenceQuery(snapshot, query);
  const roles = selectedEvidenceRoles(query);
  const event = events[snapshot.cutoff];

  return (
    <section className={styles.chatCounts} aria-label="Evidence counts at the playhead">
      <div className={styles.countsDate}>
        At the playhead · {formatEventDate(event.date)} · {snapshot.cutoff + 1}/{events.length}
      </div>
      {rows.length ? (
        <>
          <p>Distinct decisions linked to each evidence record. Select a count to see its decisions.</p>
          {rows.map((row) => (
            <div key={row.evidenceId} className={styles.countRow}>
              <div className={styles.countTitle}>
                <strong>{row.title}</strong>
                {roles.some((role) => role !== "observes") && (
                  <button
                    type="button"
                    aria-label={`${row.title}, used by ${row.useCount} ${row.useCount === 1 ? "decision" : "decisions"}`}
                    onClick={() => onGroup(row.evidenceId, "used")}
                  >
                    Used by {row.useCount} {row.useCount === 1 ? "decision" : "decisions"}
                  </button>
                )}
              </div>
              <div className={styles.countButtons}>
                {roles.map((role) => (
                  <button
                    type="button"
                    key={role}
                    aria-label={`${row.title}, ${evidenceRoleLabels[role]}: ${row.counts[role]}`}
                    onClick={() => onGroup(row.evidenceId, role)}
                  >
                    <span>{evidenceRoleLabels[role]}</span>
                    <b>{row.counts[role]}</b>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      ) : (
        <p>No matching evidence records at this point in the timeline.</p>
      )}
    </section>
  );
}
