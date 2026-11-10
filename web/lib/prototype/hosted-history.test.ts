import { describe, expect, it } from "vitest";
import { getView, type CommitmentReceipt, type Connection, type Entry } from "@reasoning";
import { makeDemoBundle } from "@/components/reasoning/fixture";
import { createHostedHistory } from "./hosted-history";

describe("hosted project history", () => {
  it("projects the selected revision exactly as the domain does at every source cutoff", () => {
    const bundle = makeDemoBundle();
    for (const run of bundle.runs) {
      const history = createHostedHistory(bundle, run.id);
      expect(history.events).toHaveLength(run.sourceCutoff);
      const latest = history.getSnapshot();
      const positions = new Map(latest.nodes.map(node => [node.id, node.position]));
      history.events.forEach((event, index) => {
        const snapshot = history.getSnapshot(index);
        const domain = getView(bundle, run.id, index + 1);
        expect(event.id).toBe("source:S" + (index + 1));
        expect(snapshot.nodes.filter(n => n.kind !== "connection").map(n => n.id)).toEqual(domain.entries.map(e => e.id));
        expect(new Set(snapshot.edges.map(e => e.connectionId))).toEqual(new Set(domain.connections.map(c => c.id)));
        for (const node of snapshot.nodes) expect(node.position).toBe(positions.get(node.id));
        expect(snapshot.metrics).toEqual([]);
      });
    }
  });

  it("retains native roles, rationale, multi-party assertions and additional parents", () => {
    const bundle = makeDemoBundle();
    const comparison = bundle.connections.find(c => c.relation === "compares")!;
    comparison.rationaleEntryId = "E-test:v1";
    const snapshot = createHostedHistory(bundle).getSnapshot();
    const edges = snapshot.edges.filter(e => e.connectionId === comparison.id);
    expect(edges.map(e => e.label)).toEqual(["assessment", "alternative", "alternative", "criterion", "rationale"]);
    expect(edges.find(e => e.label === "assessment")).toMatchObject({ from: comparison.id, to: "E-recommendation:v1" });
    expect(edges.find(e => e.label === "rationale")).toMatchObject({ from: "E-test:v1", to: comparison.id });
    expect(snapshot.nodes.find(n => n.id === comparison.id)).toMatchObject({ kind: "connection", sourceIds: ["S2"] });
    expect(snapshot.nodes.find(n => n.id === "E-option-a:v1")).toMatchObject({ kind: "alternative", typeLabel: "option", summary: "option A" });
    expect(snapshot.nodes.find(n => n.id === "E-question:v1")).toMatchObject({ kind: "entry", typeLabel: "question" });
    expect(snapshot.edges.find(e => e.connectionId === "C-answer-a:v1")).toMatchObject({
      from: "E-question:v1", to: "E-option-a:v1", fromRole: "question", toRole: "answer", label: "answered by",
    });
    expect(snapshot.edges.some(e => !e.tree)).toBe(true);
    const parents = snapshot.edges.filter(e => e.tree).map(e => e.to);
    expect(parents.length).toEqual(new Set(parents).size);
  });

  it("keeps external references opaque and hides them until the entire assertion is in scope", () => {
    const bundle = makeDemoBundle(), id = "external:ref";
    bundle.externalEntryRefs.push({ id, originalId: "D-external", entryId: "foreign-entry-id",
      namespace: { datasetId: "external-dataset", workspaceId: "workspace", projectId: "other-project" } });
    const connection: Connection = {
      ...bundle.connections[0], id: "cross-edge", logicalId: "cross-edge", relation: "legacy:references",
      participants: [{ entryId: "E-new-test:v1", role: "source" }, { entryId: id, role: "target" }],
    };
    bundle.connections.push(connection);
    bundle.runs[1].addedConnectionIds.push(connection.id);
    const history = createHostedHistory(bundle);
    expect(history.getSnapshot(2).nodes.find(n => n.id === id)).toBeUndefined();
    expect(history.getSnapshot(2).edges.find(e => e.id === connection.id)).toBeUndefined();
    expect(history.getSnapshot().nodes.find(n => n.id === id)).toMatchObject({ title: "D-external", kind: "external", sourceIds: [] });
    expect(history.getSnapshot().edges.find(e => e.id === connection.id)?.to).toBe(id);
  });

  it("preserves an authored record at its introducing cutoff, including cutoffs without a new source", () => {
    const bundle = makeDemoBundle(), run = bundle.runs[1];
    run.sourceCutoff = 17;
    const entry: Entry = { ...bundle.entries[0], id: "authored", logicalId: "authored", content: "An authored follow-up", labels: ["legacy-type:Decision"],
      provenance: { ...bundle.entries[0].provenance, sourceSpans: [], expressedBy: null } };
    bundle.entries.push(entry); run.addedEntryIds.push(entry.id);
    const history = createHostedHistory(bundle);
    expect(history.events[4]).toMatchObject({ id: "cutoff:17", label: "An authored follow-up" });
    expect(history.getSnapshot(3).nodes.find(n => n.id === entry.id)).toBeUndefined();
    expect(history.getSnapshot(4).nodes.find(n => n.id === entry.id)).toMatchObject({
      title: "An authored follow-up", kind: "decision", expressedBy: undefined, sourceIds: [],
    });
  });

  it("excludes omitted or replaced entries from the corrected revision", () => {
    const bundle = makeDemoBundle();
    bundle.runs[1].omissions = [{ kind: "entry", recordId: "E-cost:v1", reason: "Extraction correction" }];
    const snapshot = createHostedHistory(bundle).getSnapshot();
    expect(snapshot.nodes.find(n => n.id === "E-cost:v1")).toBeUndefined();
    expect(snapshot.nodes.find(n => n.id === "C-support:v1")).toBeUndefined();
    expect(createHostedHistory(bundle, "R1").getSnapshot().nodes.find(n => n.id === "E-cost:v1")).toBeDefined();
  });

  it("handles unknown dates, empty and source-only projects without inserting invented records", () => {
    const bundle = makeDemoBundle();
    bundle.runs = []; bundle.entries = []; bundle.connections = [];
    bundle.sources[0].occurredAt = null; bundle.sources[0].loggedAt = null;
    const history = createHostedHistory(bundle);
    expect(history.events[0].date).toBe("");
    expect(history.getSnapshot(0).sources.map(s => s.id)).toEqual(["S1"]);
    expect(history.getSnapshot().nodes).toEqual([]);
    bundle.sources = [];
    const empty = createHostedHistory(bundle);
    expect(empty.events).toEqual([]);
    expect(empty.getSnapshot()).toEqual({ cutoff: 0, nodes: [], edges: [], sources: [], metrics: [] });
  });

  it("shows only current verified approvals at the latest cutoff and never infers an approver from expressions", () => {
    const bundle = makeDemoBundle();
    const receipt: CommitmentReceipt = {
      id: "receipt", action: "adopt", entryId: "E-commitment:v1", priorReceiptId: null,
      actorId: "human:verified", recordedAt: bundle.manifest.frozenAt, rationale: "This is the recorded approval.",
      connectionId: null, grantId: null, basis: "authorized_action", sourceSpans: [],
    };
    bundle.commitmentReceipts.push(receipt);
    const selected = (history: ReturnType<typeof createHostedHistory>, at?:number) => history.getSnapshot(at).nodes.find(n => n.id === receipt.entryId);
    expect(selected(createHostedHistory(bundle))?.approver).toBeUndefined();
    const history = createHostedHistory(bundle, undefined, [receipt]);
    expect(selected(history)?.approvalRationale).toBe(receipt.rationale);
    expect(selected(history)?.approver).toBe(receipt.actorId);
    expect(selected(history, 2)?.approver).toBeUndefined();
    expect(selected(createHostedHistory(bundle, "R1", [receipt]))?.approver).toBeUndefined();
    const withdrawal: CommitmentReceipt = { ...receipt, id: "withdrawal", priorReceiptId: receipt.id, action: "withdraw" };
    expect(selected(createHostedHistory(bundle, undefined, [receipt, withdrawal]))?.approver).toBeUndefined();
  });
});
