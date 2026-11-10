import { useMemo, useSyncExternalStore } from "react";
import { z } from "zod";
import { events } from "@/lib/prototype/data";
import { relatedScatterChartSchema } from "@/lib/prototype/related-analysis";
import { evidenceChartSchema, linkedCountChartSchema } from "@/lib/prototype/graph-query";

export type SavedViewScope = readonly [workspaceId: string, userId: string, projectRef: string, datasetId: string];

const atlasKey = "loomtracer.atlas.views.v1";
const changed = "loomtracer-atlas-views";
type Timeline = readonly { id: string }[];
function storageKey(scope?: SavedViewScope) {
  return scope ? "loomtracer.workspace.views.v1." + JSON.stringify(scope) : atlasKey;
}
const vector = z.tuple([z.number(), z.number(), z.number()]);
const camera3D = z.object({ position: vector, target: vector, zoom: z.number().positive() });
const camera2D = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
  collapsedIds: z.array(z.string()),
});
const metricChart = z.object({
  type: z.enum(["scatter", "bar"]),
  title: z.string(),
  x: z.string(),
  y: z.string(),
  decisionIds: z.array(z.string()),
});
const viewSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  view: z.enum(["3d", "tree", "chart"]),
  cutoff: z.number().int().nonnegative(),
  eventId: z.string().optional(),
  selected: z.string().nullable(),
  graphCamera: camera3D.nullable(),
  treeCamera: camera2D.nullable(),
  chart: z
    .union([metricChart, evidenceChartSchema, linkedCountChartSchema, relatedScatterChartSchema])
    .nullable(),
});
export type SavedView = z.infer<typeof viewSchema>;
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  window.addEventListener(changed, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(changed, cb);
  };
}
function read(key: string) {
  try {
    return localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}
function supportedView(view: SavedView, hosted: boolean) {
  if (!hosted) return view.cutoff < events.length;
  if (view.chart) return view.chart.type === "linkedCount";
  return view.view !== "chart";
}
function decode(raw: string, hosted: boolean): SavedView[] {
  try {
    const values: unknown = JSON.parse(raw);
    return Array.isArray(values)
      ? values.flatMap((value) => {
          const parsed = viewSchema.safeParse(value);
          return parsed.success && supportedView(parsed.data, hosted) ? [parsed.data] : [];
        })
      : [];
  } catch {
    return [];
  }
}

// Resolve the recorded event at restore time. A history can acquire additional
// events at earlier cutoffs without changing the meaning of an existing view.
export function resolveSavedViews(raw: string, timeline: Timeline, hosted: boolean) {
  const saved = decode(raw, hosted);
  if (!saved.length) return saved;
  const indexById = new Map(timeline.map((event, index) => [event.id, index]));
  return saved.flatMap(view => {
    const cutoff = view.eventId === undefined ? view.cutoff : indexById.get(view.eventId);
    return cutoff !== undefined && cutoff < timeline.length ? [{ ...view, cutoff }] : [];
  });
}

export function useSavedViews(scope?: SavedViewScope, timeline: Timeline = events) {
  const key = storageKey(scope);
  const hosted = scope !== undefined;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "[]");
  return useMemo(() => resolveSavedViews(raw, timeline, hosted), [raw, timeline, hosted]);
}

export function persistView(view: SavedView, scope?: SavedViewScope, timeline: Timeline = events) {
  const event = timeline[view.cutoff];
  const parsed = viewSchema.parse(scope && event ? { ...view, eventId: event.id } : view);
  if (!event || !supportedView(parsed, scope !== undefined)) throw new Error("Unavailable view.");
  const key = storageKey(scope);
  const previous = decode(read(key), scope !== undefined);
  localStorage.setItem(key, JSON.stringify([...previous.filter(item => item.id !== parsed.id), parsed]));
  window.dispatchEvent(new Event(changed));
}
