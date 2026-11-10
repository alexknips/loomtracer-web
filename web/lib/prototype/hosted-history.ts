import { getView, relationLinks, type CommitmentReceipt, type Connection, type Entry, type ReasoningBundle, type SourceMessage } from "@reasoning";
import type { RecordKind, Snapshot, ViewerEdge, ViewerEvent, ViewerHistory, ViewerNode, ViewerSource } from "./data";

type Timed<T> = { at: number; value: T };

const kindNames: Record<string, RecordKind | undefined> = {
  decision: "decision", option: "alternative", alternative: "alternative", evidence: "evidence", outcome: "outcome",
};

function category(entry: Entry): { kind: RecordKind; typeLabel: string } {
  const legacy = entry.labels.find(label => label.startsWith("legacy-type:"))?.slice("legacy-type:".length);
  // Labels and named roles describe what was recorded. A proposal, question or
  // observation is still an entry; an adoption link alone is not an approval.
  const typeLabel = legacy || entry.labels.find(label => Object.hasOwn(kindNames, label.toLowerCase())) || entry.labels[0] || "Entry";
  return { kind: Object.hasOwn(kindNames, typeLabel.toLowerCase()) ? kindNames[typeLabel.toLowerCase()]! : "entry", typeLabel };
}

function headline(text: string): string {
  const line = text.trim().split(/\r?\n/, 1)[0];
  return line.length > 112 ? line.slice(0, 109).trimEnd() + "…" : line;
}

function legacyField(source: SourceMessage | undefined, key: string) {
  const payload = source?.provenance?.payload;
  const value = payload && typeof payload === "object" && !Array.isArray(payload) ? payload[key] : null;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const directedVerbs: Partial<Record<Connection["relation"], string>> = {
  answers: "answered by", responds_to: "responded to by", challenges: "challenged by",
  adopts: "adopted by", revises: "revised by", withdraws: "withdrawn by", compares: "compared by",
};

function relationName(relation: string) {
  return relation.replace(/^legacy:/, "").replace(/_/g, " ");
}

// Partition and lay out the finished topology once. A scrub only changes visibility.
// Relative roles determine link direction. A primary forest is chosen for the 2D
// tree; all remaining links, including cycles and other parents, are preserved.
function positionNodes(nodes: ViewerNode[], edges: ViewerEdge[]) {
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  const root = new Map(nodes.map(node => [node.id, node.id]));
  function find(id: string) {
    let parent = root.get(id)!;
    while (parent !== id) {
      root.set(id, root.get(parent)!);
      id = parent;
      parent = root.get(id)!;
    }
    return id;
  }
  const hasParent = new Set<string>();
  for (const edge of edges) {
    neighbors.get(edge.from)!.add(edge.to);
    neighbors.get(edge.to)!.add(edge.from);
    const from = find(edge.from), to = find(edge.to);
    if (from !== to && !hasParent.has(edge.to)) {
      edge.tree = true;
      hasParent.add(edge.to);
      root.set(to, from);
    }
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const components: string[][][] = [];
  const visited = new Set<string>();
  for (const node of [...nodes].sort((a, b) => neighbors.get(b.id)!.size - neighbors.get(a.id)!.size)) {
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    const layers: string[][] = [[node.id]];
    for (let i = 0; i < layers.length; i++) {
      const next: string[] = [];
      for (const id of layers[i]) {
        for (const neighbor of neighbors.get(id)!) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          next.push(neighbor);
        }
      }
      if (next.length) layers.push(next);
    }
    components.push(layers);
  }
  const sizes = components.map(layers => Math.max(26, Math.sqrt(layers.flat().length) * 28));
  // Rows pack disconnected components independently, including isolated entries.
  const rowLimit = Math.max(2 * sizes.reduce((largest, size) => Math.max(largest, size), 0), Math.sqrt(sizes.reduce((a, r) => a + (2 * r + 18) ** 2, 0)));
  let x = 0, y = 0, height = 0;
  components.forEach((layers, i) => {
    const size = sizes[i], side = 2 * size + 18;
    if (x && x + side > rowLimit) { x = 0; y += height; height = 0; }
    layers.forEach((layer, depth) => {
      const radius = size * Math.sqrt(depth / Math.max(1, layers.length - 1));
      layer.forEach((id, index) => {
        const angle = 2 * Math.PI * index / layer.length + depth * 1.15;
        const z = layer.length > 1 ? 0.30 * radius * Math.sin(index * 2.4 + depth) : 0.15 * radius * Math.cos(depth);
        byId.get(id)!.position = [x + size + radius * Math.cos(angle), y + size + radius * Math.sin(angle), z];
      });
    });
    x += side; height = Math.max(height, side);
  });
}

/** An authenticated bundle at a fixed extraction revision, indexed by source order. */
export function createHostedHistory(bundle: ReasoningBundle, runId?: string, verifiedCommitments: CommitmentReceipt[] = []): ViewerHistory {
  const view = bundle.runs.length ? getView(bundle, runId) : undefined;
  const runs = new Map(bundle.runs.map(run => [run.id, run]));
  const lineage = [];
  for (let run = view?.run; run; run = run.parentId ? runs.get(run.parentId) : undefined) lineage.push(run);
  lineage.reverse();
  const coverage = new Set(lineage.flatMap(run => run.sourceMessageIds));
  const sources = bundle.sources.filter(s => s.active && (!view || (coverage.has(s.id) && s.order <= view.cutoff)))
    .sort((a, b) => a.order - b.order);
  const sourceById = new Map(sources.map(s => [s.id, s]));
  const actors = new Map(bundle.actors.map(a => [a.id, a.name]));
  const contexts = new Map(bundle.contexts.map(c => [c.id, c.title]));
  const introduction = new Map<string, number>();
  for (const run of lineage) {
    for (const id of [...run.addedEntryIds, ...run.addedConnectionIds]) {
      if (!introduction.has(id)) introduction.set(id, run.sourceCutoff);
    }
  }

  const eventsAt = new Map<number, ViewerEvent>();
  const sourceRecords: Timed<ViewerSource>[] = sources.map(s => {
    const date = s.occurredAt ?? s.loggedAt ?? "";
    const original = s.provenance?.originalRecord;
    const title = legacyField(s, "title") ?? legacyField(s, "name") ?? (original ? original.table + " · " + original.id : headline(s.content) || s.originalId);
    eventsAt.set(s.order, { id: "source:" + s.id, date, label: title, nodeId: "" });
    const recorder = s.provenance?.recordedBy ?? s.actorId;
    return { at: s.order, value: { id: s.id, title, excerpt: s.content, sourceRef: s.sourceRef, date, author: actors.get(recorder) ?? recorder } };
  });
  function info(record: Entry | Connection) {
    const p = record.provenance;
    const sourceIds = [...new Set(p.sourceSpans.map(span => span.messageId))];
    const origin = sourceIds.length ? sourceById.get(sourceIds[0]) : undefined;
    const at = sourceIds.length ? sourceIds.reduce((last, id) => Math.max(last, sourceById.get(id)!.order), 0) : introduction.get(record.id)!;
    const date = p.occurredAt ?? origin?.occurredAt ?? origin?.loggedAt ?? p.recordedAt;
    const excerpt = p.sourceSpans.map(span => sourceById.get(span.messageId)!.content.slice(span.start, span.end)).join("\n[…]\n");
    const node = {
      id: record.id, date, actor: actors.get(p.recordedBy) ?? p.recordedBy,
      expressedBy: p.expressedBy ? actors.get(p.expressedBy) ?? p.expressedBy : undefined,
      basis: p.basis, context: contexts.get(record.contextId), sourceIds, originSourceIds: sourceIds, sourceId: origin?.id,
    };
    return { at, origin, excerpt, node };
  }

  const records = new Map<string, Timed<ViewerNode>>();
  const links: Timed<ViewerEdge>[] = [];
  const external = new Map(bundle.externalEntryRefs.map(ref => [ref.id, ref]));
  function addNode(at: number, node: Omit<ViewerNode, "position">) {
    records.set(node.id, { at, value: { ...node, position: [0, 0, 0] } });
  }
  for (const entry of view?.entries ?? []) {
    const { node, at, origin, excerpt } = info(entry);
    const content = entry.content ?? excerpt;
    const title = entry.summary?.trim() || legacyField(origin, "title") || headline(content) || entry.id;
    const summary = legacyField(origin, "summary") ?? legacyField(origin, "body") ?? content;
    addNode(at, { ...node, ...category(entry), title, summary, labels: entry.labels });
  }
  for (const connection of [...(view?.connections ?? []), ...(view?.externalConnections ?? [])]) {
    const { node, at: sourceOrder, excerpt } = info(connection);
    const parts = relationLinks(connection);
    const participantIds = [...connection.participants.map(p => p.entryId), ...(connection.rationaleEntryId ? [connection.rationaleEntryId] : [])];
    const at = participantIds.reduce((last, id) => Math.max(last, external.has(id) ? 0 : records.get(id)!.at), sourceOrder);
    for (const id of participantIds) {
      const ref = external.get(id);
      if (!ref) continue;
      const previous = records.get(id);
      if (previous && previous.at <= at) continue;
      addNode(at, { id, kind: "external", typeLabel: "External reference", title: ref.originalId,
        summary: "Referenced project: " + (ref.namespace.projectId ?? "unknown") + "\nEntry: " + ref.entryId,
        actor: "Unknown", date: "", sourceIds: [] });
    }
    const name = relationName(connection.relation);
    const edge = { connectionId: connection.id, relation: connection.relation, tree: false, date: node.date, sourceId: node.sourceId, sourceIds: node.sourceIds };
    const input = parts.find(link => link.target === connection.id), output = parts.find(link => link.source === connection.id);
    if (parts.length === 2 && input && output && !connection.rationaleEntryId) {
      links.push({ at, value: { ...edge, id: connection.id, from: input.source, to: output.target,
        fromRole: input.role, toRole: output.role, label: directedVerbs[connection.relation] ?? name } });
    } else {
      addNode(at, { ...node, kind: "connection", typeLabel: "Connection", title: name, summary: excerpt });
      for (const part of parts) links.push({ at, value: { ...edge, id: JSON.stringify([connection.id, part.id]), from: part.source, to: part.target, label: part.role } });
    }
    // A source-less relationship can be introduced without any source at the run cutoff.
    if (!eventsAt.has(at)) eventsAt.set(at, { id: "cutoff:" + at, date: node.date, label: name, nodeId: "" });
  }

  for (const { at, value } of records.values()) {
    const event = eventsAt.get(at);
    if (!event) eventsAt.set(at, { id: "cutoff:" + at, label: value.title, date: value.date, nodeId: value.id });
    else if (!event.nodeId && value.kind !== "external") { event.nodeId = value.id; event.label = value.title; }
  }
  const ordered = [...eventsAt.entries()].sort(([a], [b]) => a - b);
  const events = ordered.map(([, event]) => event);
  const all = [...records.values()];
  positionNodes(all.map(record => record.value), links.map(link => link.value));

  // Imported receipts and extraction roles cannot grant approval. The verified
  // server response is current-state information and is only shown at Latest.
  const superseded = new Set(verifiedCommitments.map(r => r.priorReceiptId));
  const approvals = new Map(verifiedCommitments.filter(r => r.action !== "withdraw" && !superseded.has(r.id)).map(r => [r.entryId, r]));
  const latest = Math.max(0, events.length - 1);
  function getSnapshot(requested = latest): Snapshot {
    const cutoff = Number.isFinite(requested) ? Math.max(0, Math.min(latest, Math.trunc(requested))) : latest;
    const limit = ordered[cutoff]?.[0] ?? -1;
    const showApproval = cutoff === latest && view?.run.id === bundle.runs.at(-1)?.id;
    const nodes = all.filter(item => item.at <= limit).map(({ value }) => {
      const receipt = showApproval && approvals.get(value.id);
      return receipt ? { ...value, approver: receipt.actorId, approvalRationale: receipt.rationale } : value;
    });
    return { cutoff, nodes, edges: links.filter(item => item.at <= limit).map(item => item.value),
      sources: sourceRecords.filter(item => item.at <= limit).map(item => item.value), metrics: [] };
  }
  return { events, getSnapshot };
}
