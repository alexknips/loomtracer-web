import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { events } from "@/lib/prototype/data";
import { persistView, resolveSavedViews, type SavedView, type SavedViewScope } from "./savedViews";

const atlasKey = "loomtracer.atlas.views.v1";
const scope: SavedViewScope = ["workspace", "account", "project:one", "dataset"];
const timeline = Array.from({ length: 90 }, (_, index) => ({ id: `source:${index}` }));
const position: SavedView = {
  id: "bookmark", name: "First review", view: "tree", cutoff: 72, selected: "entry:review",
  graphCamera: { position: [1, 2, 3], target: [4, 5, 6], zoom: 1.2 },
  treeCamera: { x: 8, y: 9, zoom: 1.4, collapsedIds: ["entry:folded"] }, chart: null,
};

describe("project viewer bookmarks", () => {
  let records: Map<string, string>;
  beforeEach(() => {
    records = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
    });
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("isolates identities and restores the original recorded event after a history changes", () => {
    const scopes: SavedViewScope[] = [
      scope, ["other", "account", "project:one", "dataset"], ["workspace", "other", "project:one", "dataset"],
      ["workspace", "account", "project:two", "dataset"], ["workspace", "account", "project:one", "other"],
    ];
    for (const [index, ownScope] of scopes.entries()) {
      persistView({ ...position, name: `View ${index}` }, ownScope, timeline);
    }
    expect(records.size).toBe(5);
    expect(records.has(atlasKey)).toBe(false);
    for (const [index, raw] of [...records.values()].entries()) {
      expect(resolveSavedViews(raw, [{ id: "older" }, ...timeline], true)).toEqual([
        { ...position, name: `View ${index}`, cutoff: 73, eventId: "source:72" },
      ]);
    }
  });

  it("keeps unavailable bookmarks in storage without restoring the wrong event", () => {
    persistView(position, scope, timeline);
    const raw = [...records.values()][0];
    expect(resolveSavedViews(raw, timeline.filter(event => event.id !== "source:72"), true)).toEqual([]);
    persistView({ ...position, id: "second", cutoff: 3 }, scope, timeline.slice(0, 4));
    expect(resolveSavedViews([...records.values()][0], timeline, true).map(view => view.id)).toEqual(["bookmark", "second"]);
  });

  it("retains the original Atlas key and decodes existing index-based chart and graph views", () => {
    const legacy: SavedView = { ...position, id: "chart", view: "chart", cutoff: 19,
      chart: { type: "scatter", title: "Influence and revenue", x: "aiShare", y: "revenue", decisionIds: [] } };
    records.set(atlasKey, JSON.stringify([legacy]));
    const atlas = { ...position, cutoff: 0 };
    persistView(atlas);
    expect(resolveSavedViews(records.get(atlasKey)!, events, false)).toEqual([legacy, atlas]);
    expect(() => persistView(position)).toThrow();
    expect(resolveSavedViews(JSON.stringify([legacy]), timeline, true)).toEqual([]);
    expect(() => persistView(legacy, scope, timeline)).toThrow();
    expect(resolveSavedViews("bad json", timeline, true)).toEqual([]);
  });

  it("restores a real relationship-count chart", () => {
    const item: SavedView = { ...position, view: "chart", chart: { type: "linkedCount", title: "Outcomes",
      query: { kind: "linkedCount", rowKind: "decision", linkedKind: "outcome", rowIds: [] } } };
    persistView(item, scope, timeline);
    expect(resolveSavedViews([...records.values()][0], timeline, true)).toEqual([
      { ...item, eventId: timeline[position.cutoff].id },
    ]);
  });
});
