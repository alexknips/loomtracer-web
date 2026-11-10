import { useMemo } from "react";
import type { ViewerEvent } from "@/lib/prototype/data";
import { Icon } from "./Icon";
import styles from "./prototype.module.css";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});
export function formatEventDate(date: string) {
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? dateFormat.format(timestamp) : "Date unrecorded";
}

function timelineLabels(events: readonly ViewerEvent[], decisionIds: Set<string>) {
  const latest = events.length - 1;
  if (latest < 0) return [];
  const namedDecisions = events.some((event) => decisionIds.has(event.nodeId));
  const seen = new Set<string>();
  const labels: number[] = [];
  for (let index = 0; index < latest; index++) {
    const { nodeId } = events[index];
    if (namedDecisions && (!decisionIds.has(nodeId) || seen.has(nodeId))) continue;
    seen.add(nodeId);
    const previous = labels.at(-1);
    if (previous === undefined || index - previous >= latest * 0.22) labels.push(index);
  }
  if (labels.length > 1 && latest - labels[labels.length - 1] < latest * 0.14) labels.pop();
  labels.push(latest);
  return labels;
}

export default function Timeline({ events, decisionIds, cutoff, onChange }: {
  events: readonly ViewerEvent[];
  decisionIds: Set<string>;
  cutoff: number;
  onChange: (cutoff: number) => void;
}) {
  const latest = events.length - 1;
  const labels = useMemo(() => timelineLabels(events, decisionIds), [events, decisionIds]);
  const event = events[cutoff];
  const denominator = Math.max(1, latest);
  const percent = (cutoff / denominator) * 100;
  if (!event) return null;
  const readout = `${formatEventDate(event.date)} · ${event.label}`;
  // Keep every event reachable with the playhead; at high density draw only distinct tick marks.
  const stride = Math.max(1, Math.ceil(latest / 120));
  return (
    <section className={styles.timeline} aria-label="Project timeline">
      <div className={styles.timelineHeading}>
        <div className={styles.timelineTitle}>
          <Icon name="clock" size={17} />
          <h2>Project timeline</h2>
        </div>
        <button className={styles.latest} onClick={() => onChange(latest)} disabled={cutoff === latest}>
          <Icon name="latest" size={13} />
          Latest
        </button>
      </div>
      <div className={styles.timelineReadout} data-testid="event-readout">
        <time dateTime={event.date || undefined}>{formatEventDate(event.date)}</time>
        <span title={event.label}>{event.label}</span>
        <small>{cutoff + 1} / {events.length}</small>
      </div>
      <div className={styles.rail}>
        <div className={styles.railLine}>
          <div style={{ width: `${percent}%` }} />
          {events.map((e, i) => (i % stride === 0 || i === latest) && (
            <i key={e.id} className={i <= cutoff ? styles.pastTick : undefined}
              style={{ left: `${(100 * i) / denominator}%` }} />
          ))}
        </div>
        <input aria-label="History playhead" aria-valuetext={readout} type="range" min={0}
          max={latest} step={1} value={cutoff} disabled={latest === 0}
          onChange={(e) => onChange(Number(e.currentTarget.value))} />
      </div>
      <div className={styles.milestones}>
        {labels.map((index, i) => {
          const event = events[index];
          const at = index / denominator;
          const previous = labels[i - 1] ?? 0;
          const next = labels[i + 1] ?? latest;
          const leftRoom = ((index - previous) * 50) / denominator;
          const rightRoom = ((next - index) * 50) / denominator;
          // Each label stays inside the halfway points between neighboring ticks.
          const room = at === 1 ? leftRoom : at === 0 ? rightRoom : 2 * Math.min(leftRoom, rightRoom);
          const width = latest === 0 ? 100 : Math.max(0, Math.min(22, room - 1));
          return (
            <button key={event.id} title={event.label} onClick={() => onChange(index)}
              style={{ left: `${at * 100}%`, maxWidth: width + "%",
                transform: at === 1 ? "translateX(-100%)" : at === 0 ? "none" : "translateX(-50%)" }}>
              {event.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
