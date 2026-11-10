import type { Snapshot } from "@/lib/prototype/data";
import { Icon } from "./Icon";
import { formatEventDate } from "./Timeline";
import styles from "./prototype.module.css";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function RecordDetail({
  snapshot,
  id,
  onSelect,
  onClose,
}: {
  snapshot: Snapshot;
  id: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const node = snapshot.nodes.find((n) => n.id === id);
  const source = snapshot.sources.find((s) => s.id === id);
  if (!node && !source) return null;
  const links = node ? snapshot.edges.filter((e) => e.from === id || e.to === id) : [];
  const metric = snapshot.metrics.find((m) => m.nodeId === id);
  const sourceIds = new Set([...(node?.sourceIds ?? []), metric?.aiSourceId, metric?.revenueSourceId]);
  const sources = snapshot.sources.filter((s) => sourceIds.has(s.id));
  const backLinks = source
    ? snapshot.nodes.filter(
        (n) =>
          n.sourceIds.includes(source.id) ||
          snapshot.metrics.some(
            (m) => m.nodeId === n.id && [m.aiSourceId, m.revenueSourceId].includes(source.id),
          ),
      )
    : [];
  return (
    <section className={styles.detail} aria-label="Record details" data-testid="record-detail">
      <header>
        <span>
          <Icon name={source ? "file" : "layers"} size={15} />
          {source ? "Source record" : (node?.typeLabel ?? node?.kind)} · {formatEventDate((source ?? node)!.date)}
        </span>
        <button aria-label="Close record details" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <h3>{(source ?? node)!.title}</h3>
      {source && (
        <>
          <p>{source.excerpt}</p>
          <p className={styles.byline}>{source.sourceRef ? "Source actor" : "Recorded by"} {source.author}</p>
          {source.sourceRef && <small>{source.sourceRef}</small>}
          {backLinks.length > 0 && <h4>Linked records</h4>}
          {backLinks.map((n) => (
            <button key={n.id} className={styles.detailLink} onClick={() => onSelect(n.id)}>
              {n.title}
              <Icon name="arrow" size={14} />
            </button>
          ))}
        </>
      )}
      {node && (
        <>
          <p>{node.summary}</p>
          {node.expressedBy && <p className={styles.byline}>Expressed by {node.expressedBy}</p>}
          <p className={styles.byline}>
            Recorded by {node.actor}
            {node.approver && <> · Approved by {node.approver}</>}
          </p>
          {node.approvalRationale && <><h4>Approval rationale</h4><p>{node.approvalRationale}</p></>}
          {node.context && <p className={styles.byline}>Context · {node.context}</p>}
          {node.basis === "inferred" && <p className={styles.byline}>Inferred from the source</p>}
          {metric && (
            <>
              <h4>Recorded measurements</h4>
              <dl className={styles.metrics}>
                <div>
                  <dt>Assessed AI influence</dt>
                  <dd>{metric.aiShare === null ? "Unreported" : metric.aiShare + "%"}</dd>
                </div>
                <div>
                  <dt>Attributed revenue</dt>
                  <dd>{metric.revenue === null ? "Unreported" : money.format(metric.revenue)}</dd>
                </div>
              </dl>
              {metric.aiRationale && <p className={styles.byline}>{metric.aiRationale}</p>}
            </>
          )}
          {!!sources.length && (
            <>
              <h4>Sources</h4>
              {sources.map((s) => (
                <details className={styles.source} key={s.id}>
                  <summary>
                    <Icon name="file" size={15} />
                    {s.title}
                  </summary>
                  <p>{s.excerpt}</p>
                  {s.sourceRef && <small className={styles.sourceRef}>{s.sourceRef}</small>}
                  <small>
                    {s.author} · {formatEventDate(s.date)}
                  </small>
                </details>
              ))}
            </>
          )}
          {!!links.length && (
            <>
              <h4>Related records</h4>
              {links.map((e) => {
                const target = snapshot.nodes.find((n) => n.id === (e.from === id ? e.to : e.from));
                if (!target) return null;
                const relationSources = e.sourceIds?.length
                  ? snapshot.sources.filter((s) => e.sourceIds!.includes(s.id))
                  : [];
                return (
                  <div key={e.id}>
                    <button className={styles.detailLink} onClick={() => onSelect(target.id)}>
                      <span>
                        {target.title}
                        <small>{e.label}{e.fromRole && e.toRole && ` · ${e.fromRole} → ${e.toRole}`}</small>
                      </span>
                      <Icon name="arrow" size={14} />
                    </button>
                    {relationSources.length > 0 && (
                      <details className={styles.source}>
                        <summary>Relationship sources ({relationSources.length})</summary>
                        {relationSources.map((s) => (
                          <button key={s.id} className={styles.detailLink} onClick={() => onSelect(s.id)}>
                            {s.title}<Icon name="file" size={13} />
                          </button>
                        ))}
                      </details>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}
    </section>
  );
}
