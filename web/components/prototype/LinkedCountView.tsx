"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { events, type Snapshot } from "@/lib/prototype/data";
import {
  recordKindName,
  runLinkedCountQuery,
  type LinkedCountQuery,
  type LinkedCountRow,
  type LinkedCountChartSpec,
} from "@/lib/prototype/graph-query";
import { Icon } from "./Icon";
import { recordColors } from "./graphColors";
import { formatEventDate } from "./Timeline";
import styles from "./linked-count.module.css";
import shell from "./prototype.module.css";

function countText(query: LinkedCountQuery, count: number) {
  return count + " linked " + recordKindName(query.linkedKind, count);
}

function Members({
  row,
  snapshot,
  onSelect,
  onClose,
  id,
}: {
  row: LinkedCountRow;
  snapshot: Snapshot;
  onSelect: (id: string) => void;
  onClose: () => void;
  id: string;
}) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [row.recordId]);
  const records = new Map(snapshot.nodes.map((record) => [record.id, record]));
  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const members = new Map<string, LinkedCountRow["links"]>();
  for (const link of row.links) {
    const existing = members.get(link.linkedId);
    if (existing) existing.push(link);
    else members.set(link.linkedId, [link]);
  }
  return (
    <section ref={section} className={styles.details} id={id} aria-label="Records behind this count">
      <header>
        <h3>{row.title}</h3>
        <button type="button" aria-label="Close linked records" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>
      {!members.size && (
        <p>No matching relationships have been recorded at this point in the timeline.</p>
      )}
      {[...members].map(([linkedId, links]) => (
        <div key={linkedId} className={styles.member}>
          <button type="button" className={styles.record} onClick={() => onSelect(linkedId)}>
            {records.get(linkedId)?.title}
            <Icon name="arrow" size={15} />
          </button>
          {links.map((link) => (
            <div key={link.edgeId}>
              <p>
                {records.get(link.from)?.title} <strong>{link.label}</strong>{" "}
                {records.get(link.to)?.title}
              </p>
              <div className={styles.sources}>
                {link.sourceIds.map((id) => {
                  const source = sources.get(id);
                  return (
                    source && (
                      <button key={id} onClick={() => onSelect(id)}>
                        <Icon name="file" size={13} />
                        {source.title}
                      </button>
                    )
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function LinkedCountAnswer({
  snapshot,
  query,
  onRow,
}: {
  snapshot: Snapshot;
  query: LinkedCountQuery;
  onRow: (id: string) => void;
}) {
  const rows = useMemo(() => runLinkedCountQuery(snapshot, query), [snapshot, query]);
  return (
    <section aria-label="Linked counts at the playhead" className={shell.chatCounts}>
      <div className={shell.countsDate}>
        At the playhead · {formatEventDate(events[snapshot.cutoff].date)} · {snapshot.cutoff + 1}/
        {events.length}
      </div>
      <p>
        Distinct {recordKindName(query.linkedKind, 2)} linked to each {recordKindName(query.rowKind, 1)}.
      </p>
      {rows.length ? (
        rows.map((row) => (
          <button
            key={row.recordId}
            className={styles.chatRow}
            type="button"
            onClick={() => onRow(row.recordId)}
            aria-label={row.title + ": " + countText(query, row.linkedCount)}
          >
            <span>{row.title}</span>
            <b>{row.linkedCount}</b>
          </button>
        ))
      ) : (
        <p>No matching {recordKindName(query.rowKind, 2)} at this point in the timeline.</p>
      )}
    </section>
  );
}

export default function LinkedCountView({
  snapshot,
  spec,
  onSelect,
  initialRowId,
}: {
  snapshot: Snapshot;
  spec: LinkedCountChartSpec;
  onSelect: (id: string) => void;
  initialRowId?: string;
}) {
  const query = spec.query;
  const rows = useMemo(() => runLinkedCountQuery(snapshot, query), [snapshot, query]);
  const [active, setActive] = useState<string | null>(initialRowId ?? null);
  // Once a row disappears from history, it stays closed when the timeline moves forward again.
  if (active && !rows.some((row) => row.recordId === active)) setActive(null);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const max = Math.max(1, ...rows.map((row) => row.linkedCount));
  return (
    <section
      className={styles.chart}
      aria-label={spec.title}
      style={{ "--bar-color": recordColors[query.linkedKind] } as CSSProperties}
    >
      <header>
        <h2>{spec.title}</h2>
        <p>
          Distinct {recordKindName(query.linkedKind, 2)} linked to each{" "}
          {recordKindName(query.rowKind, 1)}. Select a count to see the records.
        </p>
      </header>
      {rows.length ? (
        <div className={styles.rows}>
          {rows.map((row) => (
            <div key={row.recordId}>
              <button
                ref={active === row.recordId ? trigger : undefined}
                type="button"
                className={styles.bar}
                aria-label={row.title + ": " + countText(query, row.linkedCount)}
                aria-expanded={active === row.recordId}
                aria-controls={active === row.recordId ? panelId : undefined}
                onClick={(e) => {
                  trigger.current = e.currentTarget;
                  setActive(active === row.recordId ? null : row.recordId);
                }}
              >
                <span>{row.title}</span>
                <span className={styles.track} aria-hidden="true">
                  <i style={{ width: (100 * row.linkedCount) / max + "%" }} />
                </span>
                <b>{row.linkedCount}</b>
              </button>
              {active === row.recordId && (
                <Members
                  id={panelId}
                  row={row}
                  snapshot={snapshot}
                  onSelect={onSelect}
                  onClose={() => {
                    setActive(null);
                    trigger.current?.focus();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p>No matching {recordKindName(query.rowKind, 2)} at this point in the timeline.</p>
      )}
    </section>
  );
}
