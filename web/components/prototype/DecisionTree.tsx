"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ViewerEdge, ViewerNode } from "@/lib/prototype/data";
import { recordColors as colors } from "./graphColors";
import styles from "./graph.module.css";

export type TreeCamera = Viewport & { collapsedIds: string[] };
type TreeProps = {
  nodes: ViewerNode[];
  edges: ViewerEdge[];
  visibleIds: string[];
  visibleEdgeIds?: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  focus?: { id: string; sequence: number } | null;
  restore?: { sequence: number; state: TreeCamera } | null;
  onCameraChange?: (state: TreeCamera) => void;
};

export { colors };
const cardWidth = 202;
const cardHeight = 70;
const columnSpacing = 260;
const rowSpacing = 100;

type CardNode = Node<
  {
    record: ViewerNode;
    active: boolean;
    childCount: number;
    collapsed: boolean;
    onToggle: (id: string) => void;
  },
  "decisionRecord"
>;

function RecordCard({ data }: NodeProps<CardNode>) {
  const { record, active, childCount, collapsed, onToggle } = data;
  return (
    <div
      className={styles.recordCard}
      data-selected={active}
      data-kind={record.kind}
      style={{ "--kind-color": colors[record.kind] } as CSSProperties}
    >
      <Handle type="target" position={Position.Left} />
      <span className={styles.recordKind}>
        <i />
        {record.typeLabel ?? record.kind}
      </span>
      <span className={styles.recordTitle} title={record.title}>
        {record.title}
      </span>
      {childCount > 0 && (
        <button
          className={`${styles.branchToggle} nodrag nopan`}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${record.title}`}
          aria-expanded={!collapsed}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(record.id);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {collapsed ? "+" : "−"}
        </button>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { decisionRecord: RecordCard };

/** Position the primary forest once. Cross-links remain edges without creating duplicate cards. */
function treeLayout(records: ViewerNode[], edges: ViewerEdge[]) {
  const children = new Map(records.map((record) => [record.id, [] as string[]]));
  const parent = new Map<string, string>();
  const primaryEdges = new Set<string>();
  // A record can have one primary parent. Union by component keeps cycle detection fast on long chains.
  const component = new Map(records.map((record) => [record.id, record.id]));
  function rootOf(id: string) {
    let root = id;
    while (component.get(root) !== root) root = component.get(root)!;
    while (id !== root) {
      const next = component.get(id)!;
      component.set(id, root);
      id = next;
    }
    return root;
  }
  for (const edge of edges) {
    if (!edge.tree || parent.has(edge.to) || !children.has(edge.from) || !children.has(edge.to)) continue;
    const fromRoot = rootOf(edge.from), toRoot = rootOf(edge.to);
    if (fromRoot === toRoot) continue;
    component.set(toRoot, fromRoot);
    parent.set(edge.to, edge.from);
    primaryEdges.add(edge.id);
    children.get(edge.from)!.push(edge.to);
  }
  const position = new Map<string, { x: number; y: number }>();
  let nextRow = 0;
  const roots = records.filter((record) => !parent.has(record.id)).map((record) => record.id);
  for (const root of roots) {
    const pending = [{ id: root, column: 0, afterChildren: false }];
    while (pending.length) {
      const { id, column, afterChildren } = pending.pop()!;
      const childIds = children.get(id)!;
      if (childIds.length && !afterChildren) {
        pending.push({ id, column, afterChildren: true });
        for (let i = childIds.length - 1; i >= 0; i--)
          pending.push({ id: childIds[i], column: column + 1, afterChildren: false });
        continue;
      }
      const y = childIds.length
        ? (position.get(childIds[0])!.y + position.get(childIds[childIds.length - 1])!.y) / 2
        : nextRow++ * rowSpacing;
      position.set(id, { x: column * columnSpacing, y });
    }
    nextRow++;
  }
  return { parent, children, position, roots, primaryEdges };
}

export default function DecisionTree({
  nodes,
  edges,
  visibleIds,
  visibleEdgeIds,
  selectedId,
  onSelect,
  focus,
  restore,
  onCameraChange,
}: TreeProps) {
  const [flow, setFlow] = useState<ReactFlowInstance<CardNode, Edge> | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(restore?.state.collapsedIds ?? []),
  );
  const surface = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => treeLayout(nodes, edges), [nodes, edges]);
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const edgeIds = useMemo(() => visibleEdgeIds && new Set(visibleEdgeIds), [visibleEdgeIds]);
  const props = useRef({ collapsed, onCameraChange });
  useEffect(() => {
    props.current = { collapsed, onCameraChange };
  }, [collapsed, onCameraChange]);

  const toggle = useCallback((id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const report = useCallback((viewport: Viewport) => {
    const camera = { ...viewport, collapsedIds: [...props.current.collapsed] };
    if (surface.current) surface.current.dataset.camera = JSON.stringify(camera);
    props.current.onCameraChange?.(camera);
  }, []);
  useEffect(() => {
    if (flow) report(flow.getViewport());
  }, [flow, collapsed, report]);

  const expanded = useMemo(() => {
    const ids = new Set<string>();
    const pending = [...layout.roots];
    while (pending.length) {
      const id = pending.pop()!;
      ids.add(id);
      if (!collapsed.has(id)) for (const child of layout.children.get(id)!) pending.push(child);
    }
    return ids;
  }, [layout, collapsed]);
  const drawnNodes = useMemo(
    (): CardNode[] =>
      nodes.filter((node) => visible.has(node.id) && expanded.has(node.id))
        .map((record) => ({
          id: record.id,
          type: "decisionRecord",
          position: layout.position.get(record.id)!,
          width: cardWidth,
          height: cardHeight,
          selected: record.id === selectedId,
          ariaLabel: `${record.typeLabel ?? record.kind}: ${record.title}`,
          ariaRole: "button",
          data: {
            record,
            active: record.id === selectedId,
            collapsed: collapsed.has(record.id),
            childCount: layout.children.get(record.id)!.filter((child) => visible.has(child)).length,
            onToggle: toggle,
          },
        })),
    [nodes, visible, expanded, layout, collapsed, selectedId, toggle],
  );
  const drawn = useMemo(() => new Set(drawnNodes.map((node) => node.id)), [drawnNodes]);
  const drawnEdges = useMemo(
    (): Edge[] =>
      edges
        .filter(
          (edge) => (!edgeIds || edgeIds.has(edge.id)) && drawn.has(edge.from) && drawn.has(edge.to),
        )
        .map((edge) => {
          const active = edge.from === selectedId || edge.to === selectedId;
          const stroke = active ? "#1D90CD" : "#332B3280";
          return {
            id: edge.id,
            source: edge.from,
            target: edge.to,
            type: "default", // React Flow’s cubic Bézier connector.
            ariaLabel: edge.label,
            label: active ? edge.label : undefined,
            labelStyle: { fill: "#332B32", fontSize: 12 },
            labelBgStyle: { fill: "#FDF8F4" },
            labelBgPadding: [4, 2],
            style: {
              stroke,
              strokeWidth: active ? 2.2 : 1.45,
              strokeDasharray: layout.primaryEdges.has(edge.id) ? undefined : "5 5",
            },
            markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 16, height: 16 },
          };
        }),
    [edges, edgeIds, drawn, selectedId, layout.primaryEdges],
  );

  const appliedRestore = useRef<number | null>(null);
  const appliedFocus = useRef<number | null>(null);
  const initialViewport = useRef(false);
  useEffect(() => {
    if (!flow) return;
    if (restore && appliedRestore.current !== restore.sequence) {
      const frame = requestAnimationFrame(() => {
        appliedRestore.current = restore.sequence;
        initialViewport.current = true;
        setCollapsed(new Set(restore.state.collapsedIds));
        void flow.setViewport(restore.state).then(() => report(flow.getViewport()));
      });
      return () => cancelAnimationFrame(frame);
    }
    if (!initialViewport.current && drawnNodes.length) {
      const frame = requestAnimationFrame(() => {
        initialViewport.current = true;
        const root = drawnNodes.find((node) => !layout.parent.has(node.id)) ?? drawnNodes[0];
        const zoom = 0.86;
        const width = surface.current?.clientWidth ?? 800;
        const height = surface.current?.clientHeight ?? 480;
        const x = Math.min(48, width * 0.07) - root.position.x * zoom;
        const y = height / 2 - (root.position.y + cardHeight / 2) * zoom;
        void flow.setViewport({ x, y, zoom }).then(() => report(flow.getViewport()));
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [flow, restore, drawnNodes, layout, report]);
  useEffect(() => {
    if (!flow || !focus || appliedFocus.current === focus.sequence || !visible.has(focus.id)) return;
    const ancestorIds: string[] = [];
    let parent = layout.parent.get(focus.id);
    while (parent !== undefined) {
      ancestorIds.push(parent);
      parent = layout.parent.get(parent);
    }
    if (ancestorIds.some((id) => collapsed.has(id))) {
      const frame = requestAnimationFrame(() =>
        setCollapsed((current) => new Set([...current].filter((id) => !ancestorIds.includes(id)))),
      );
      return () => cancelAnimationFrame(frame);
    }
    const position = layout.position.get(focus.id);
    if (!position) return;
    const frame = requestAnimationFrame(() => {
      appliedFocus.current = focus.sequence;
      initialViewport.current = true;
      void flow
        .setCenter(position.x + cardWidth / 2, position.y + cardHeight / 2, { zoom: 1 })
        .then(() => report(flow.getViewport()));
    });
    return () => cancelAnimationFrame(frame);
  }, [flow, focus, visible, collapsed, layout, report]);

  return (
    <div
      ref={surface}
      className={styles.tree}
      data-testid="prototype-tree"
      data-visible-nodes={drawnNodes.length}
      data-visible-edges={drawnEdges.length}
      aria-label="Decision tree"
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.matches(".react-flow__node") &&
          target.dataset.id &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(target.dataset.id);
        }
      }}
    >
      <ReactFlow<CardNode, Edge>
        onlyRenderVisibleElements={nodes.length > 250}
        nodes={drawnNodes}
        edges={drawnEdges}
        nodeTypes={nodeTypes}
        minZoom={0.12}
        maxZoom={2.2}
        onInit={setFlow}
        onMoveEnd={(_, viewport) => report(viewport)}
        onNodeClick={(_, node) => onSelect(node.id)}
        nodesDraggable={false}
        edgesFocusable={false}
        nodesConnectable={false}
        autoPanOnNodeFocus
        panOnScroll
        zoomOnPinch
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={22} size={0.8} color="#332B3232" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap<CardNode>
          pannable
          zoomable
          position="bottom-right"
          ariaLabel="Tree navigation minimap, drag to pan and scroll to zoom"
          bgColor="#FDF8F4"
          maskColor="#332B321D"
          nodeColor={(node) => colors[node.data.record.kind]}
          nodeStrokeColor="#332B32"
          nodeStrokeWidth={2}
        />
      </ReactFlow>
      {drawnNodes.length === 0 && (
        <p className={styles.empty}>No records at this point in the timeline.</p>
      )}
    </div>
  );
}
