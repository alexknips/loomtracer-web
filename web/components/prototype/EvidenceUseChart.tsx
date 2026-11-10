"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import type { EvidenceChartSpec, Snapshot } from "@/lib/prototype/data";
import {
  evidenceRoleLabels,
  linksForEvidenceGroup,
  runEvidenceQuery,
  selectedEvidenceRoles,
  type EvidenceGroupRole,
  type EvidenceUseRow,
} from "@/lib/prototype/graph-query";
import { Icon } from "./Icon";
import { evidenceRoleColors } from "./graphColors";
import styles from "./evidence-use.module.css";

export type EvidenceGroup = { evidenceId: string; role: EvidenceGroupRole };

function countDecisions(count: number) {
  return `${count} distinct ${count === 1 ? "decision" : "decisions"}`;
}

function Drilldown({
  id,
  row,
  role,
  snapshot,
  selectedId,
  onSelect,
  onClose,
}: {
  id: string;
  row: EvidenceUseRow;
  role: EvidenceGroup["role"];
  snapshot: Snapshot;
  selectedId: string | null;
  onSelect: (recordId: string) => void;
  onClose: () => void;
}) {
  const section = useRef<HTMLElement>(null);
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const members = new Map<string, EvidenceUseRow["links"]>();
  for (const link of linksForEvidenceGroup(row, role)) {
    const group = members.get(link.decisionId);
    if (group) group.push(link);
    else members.set(link.decisionId, [link]);
  }
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [row.evidenceId, role]);

  return (
    <section
      className={styles.drill}
      id={id}
      ref={section}
      aria-label="Decisions behind this count"
      data-testid="evidence-drilldown"
    >
      <header>
        <div>
          <h3>
            {role === "used" ? "Recorded uses" : evidenceRoleLabels[role]} · {row.title}
          </h3>
          <p>{countDecisions(members.size)}</p>
        </div>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="Close evidence drilldown"
        >
          <Icon name="close" size={16} />
        </button>
      </header>
      {members.size === 0 ? (
        <p className={styles.emptyGroup}>
          No decisions have this recorded relationship at this point in the timeline.
        </p>
      ) : (
        <ul className={styles.members}>
          {[...members].map(([decisionId, links]) => {
            const decision = nodes.get(decisionId);
            if (!decision) return null;
            return (
              <li key={decisionId}>
                <button
                  type="button"
                  className={styles.memberTitle}
                  aria-pressed={selectedId === decisionId}
                  onClick={() => onSelect(decisionId)}
                >
                  {decision.title}
                  <Icon name="arrow" size={15} />
                </button>
                {links.map((link) => (
                  <div key={link.edgeId} className={styles.relationship}>
                    <p>
                      {nodes.get(link.from)?.title ?? link.from} <strong>{link.label}</strong>{" "}
                      {nodes.get(link.to)?.title ?? link.to}
                    </p>
                    <div className={styles.sources}>
                      {[...new Set(link.sourceIds)].map((sourceId) => {
                        const source = sources.get(sourceId);
                        return (
                          source && (
                            <button key={sourceId} type="button" onClick={() => onSelect(sourceId)}>
                              <Icon name="file" size={13} />
                              {source.title}
                            </button>
                          )
                        );
                      })}
                    </div>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function EvidenceUseChart({
  snapshot,
  spec,
  selectedId,
  onSelect,
  initialGroup,
}: {
  snapshot: Snapshot;
  spec: EvidenceChartSpec;
  selectedId: string | null;
  onSelect: (id: string) => void;
  initialGroup?: EvidenceGroup | null;
}) {
  const rows = useMemo(() => runEvidenceQuery(snapshot, spec.query), [snapshot, spec.query]);
  const roles = selectedEvidenceRoles(spec.query);
  const observationOnly = roles.length === 1 && roles[0] === "observes";
  const [selection, setSelection] = useState<EvidenceGroup | null>(() => initialGroup ?? null);
  const validSelection =
    selection &&
    rows.some((row) => row.evidenceId === selection.evidenceId) &&
    (selection.role === "used" ? !observationOnly : roles.includes(selection.role));
  // Retain zero-count groups while their record is visible. A removed record stays dismissed if the user scrubs forward.
  if (selection && !validSelection) setSelection(null);
  const current = validSelection ? selection : null;
  const maxCount = Math.max(1, ...rows.flatMap((row) => roles.map((role) => row.counts[role])));
  const drillId = useId();
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  return (
    <section className={styles.chart} aria-label={spec.title} data-testid="evidence-use-chart">
      <header className={styles.heading}>
        <h2>{spec.title}</h2>
        <p>
          {observationOnly
            ? "Each bar counts distinct decisions linked to an observation."
            : "Use totals count distinct decisions citing a record as support, contradiction, or input within the roles shown."}
        </p>
      </header>
      {rows.length === 0 ? (
        <p className={styles.empty}>
          No matching evidence records are visible at this point in the timeline.
        </p>
      ) : (
        <div className={styles.rows}>
          {rows.map((row) => {
            const activeRole = current?.evidenceId === row.evidenceId ? current.role : null;
            function toggle(group: EvidenceGroup["role"], trigger: HTMLButtonElement) {
              lastTrigger.current = trigger;
              setSelection(activeRole === group ? null : { evidenceId: row.evidenceId, role: group });
            }
            return (
              <div key={row.evidenceId} className={styles.row}>
                <div className={styles.rowHeading}>
                  <button
                    type="button"
                    onClick={() => onSelect(row.evidenceId)}
                    aria-pressed={selectedId === row.evidenceId}
                  >
                    {row.title}
                    <Icon name="arrow" size={14} />
                  </button>
                  {!observationOnly && (
                    <button
                      type="button"
                      className={styles.total}
                      ref={activeRole === "used" ? lastTrigger : undefined}
                      data-testid={`evidence-group-${row.evidenceId}-used`}
                      aria-label={`${row.title}: Used by ${row.useCount} ${row.useCount === 1 ? "decision" : "decisions"}`}
                      aria-expanded={activeRole === "used"}
                      aria-controls={activeRole === "used" ? drillId : undefined}
                      onClick={(event) => toggle("used", event.currentTarget)}
                    >
                      Used by {row.useCount} {row.useCount === 1 ? "decision" : "decisions"}
                    </button>
                  )}
                </div>
                <div role="group" aria-label={`Uses of ${row.title}`} className={styles.group}>
                  {roles.map((role) => {
                    const count = row.counts[role],
                      active = activeRole === role;
                    return (
                      <button
                        type="button"
                        key={role}
                        className={styles.bar}
                        ref={active ? lastTrigger : undefined}
                        style={{ "--role-color": evidenceRoleColors[role] } as CSSProperties}
                        data-testid={`evidence-group-${row.evidenceId}-${role}`}
                        aria-label={`${row.title}: ${evidenceRoleLabels[role]}, ${countDecisions(count)}`}
                        aria-expanded={active}
                        aria-controls={active ? drillId : undefined}
                        onClick={(event) => toggle(role, event.currentTarget)}
                      >
                        <span className={styles.role}>{evidenceRoleLabels[role]}</span>
                        <span className={styles.track} aria-hidden="true">
                          <span style={{ width: `${(100 * count) / maxCount}%` }} />
                        </span>
                        <span className={styles.number}>{count}</span>
                      </button>
                    );
                  })}
                </div>
                {activeRole && (
                  <Drilldown
                    id={drillId}
                    row={row}
                    role={activeRole}
                    snapshot={snapshot}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onClose={() => {
                      setSelection(null);
                      lastTrigger.current?.focus();
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
