"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ViewerEdge, ViewerNode } from "@/lib/prototype/data";
import { recordColors } from "./graphColors";
import styles from "./graph.module.css";

type Triple = [number, number, number];
export type GraphCamera = { position: Triple; target: Triple; zoom: number };
type SpatialProps = {
  nodes: ViewerNode[];
  edges: ViewerEdge[];
  visibleIds: string[];
  searchMatchIds: string[];
  visibleEdgeIds?: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  focus?: { id: string; sequence: number } | null;
  restore?: { sequence: number; state: GraphCamera } | null;
  onCameraChange?: (state: GraphCamera) => void;
  onOpenTree?: () => void;
};
const radius = { decision: 6.8, alternative: 4.7, evidence: 4.1, outcome: 5.3, entry: 5.5, connection: 4.6, external: 5.0 };
const ink = "#332B32";
type LabelAnchor = "right" | "left" | "below" | "above";
type Dot = {
  record: ViewerNode;
  mesh: THREE.Mesh;
  hit: HTMLButtonElement;
  text: HTMLSpanElement;
  anchor: LabelAnchor;
};
const labelSides: LabelAnchor[] = ["right", "left", "below", "above"];
type Link = { record: ViewerEdge; line: THREE.Line; material: THREE.LineBasicMaterial };
type Rect = { x: number; y: number; w: number; h: number };
const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** An on-demand scene: a static graph consumes no animation frames while the camera is at rest. */
class SpatialScene {
  readonly camera = new THREE.PerspectiveCamera(34, 1, 0.5, 8000);
  readonly scene = new THREE.Scene();
  readonly controls: OrbitControls;
  readonly dots: Dot[] = [];
  readonly links: Link[] = [];
  readonly selectionRing: THREE.Mesh;
  readonly observer: ResizeObserver;
  readonly bounds = new THREE.Box3();
  readonly resources: { dispose(): void }[] = [];
  private matches = new Set<string>();
  private hoveredId: string | null = null;
  private arrangeLabels = true;
  private orbiting = false;
  private labelTimer = 0;
  private frame = 0;
  private closed = false;
  private width = 1;
  private height = 1;
  private homeCenter = new THREE.Vector3();
  private stage: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private labels: HTMLDivElement;
  private onCamera: (camera: GraphCamera) => void;

  constructor(
    stage: HTMLDivElement,
    labels: HTMLDivElement,
    renderer: THREE.WebGLRenderer,
    records: ViewerNode[],
    edges: ViewerEdge[],
    onSelect: (id: string) => void,
    onCamera: (state: GraphCamera) => void,
  ) {
    this.stage = stage;
    this.labels = labels;
    this.renderer = renderer;
    this.onCamera = onCamera;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor("#FDF8F4", 0);
    const canvas = renderer.domElement;
    canvas.className = styles.threeCanvas;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "group");
    canvas.setAttribute(
      "aria-label",
      "3D decision graph. Arrow keys rotate the graph. Tab to explore records.",
    );
    stage.prepend(canvas);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.rotateSpeed = 0.72;
    this.controls.zoomSpeed = 0.9;
    this.controls.minZoom = 0.28;
    this.controls.maxZoom = 8;
    this.controls.minDistance = 130;
    this.controls.maxDistance = 2300;

    const shapes = {
      decision: new THREE.SphereGeometry(1, 32, 24),
      alternative: new THREE.OctahedronGeometry(1, 0),
      evidence: new THREE.SphereGeometry(1, 16, 12),
      outcome: new THREE.IcosahedronGeometry(1, 1),
      entry: new THREE.SphereGeometry(1, 16, 12),
      connection: new THREE.OctahedronGeometry(1, 0),
      external: new THREE.BoxGeometry(1.6, 1.6, 1.6),
    };
    const materials = Object.fromEntries(
      Object.entries(recordColors).map(([kind, color]) => [
        kind,
        new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      ]),
    ) as Record<ViewerNode["kind"], THREE.MeshBasicMaterial>;
    // External references are outlined cubes; the referenced project stays outside this graph.
    materials.external.color.set(ink);
    materials.external.wireframe = true;
    this.resources.push(...Object.values(shapes), ...Object.values(materials));

    for (const record of records) {
      const mesh = new THREE.Mesh(shapes[record.kind], materials[record.kind]);
      mesh.position.fromArray(record.position);
      mesh.position.x *= 1.28;
      mesh.scale.setScalar(radius[record.kind]);
      this.bounds.expandByPoint(mesh.position);
      this.scene.add(mesh);
      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = styles.hit;
      hit.setAttribute("aria-label", `${record.typeLabel ?? record.kind}: ${record.title}`);
      hit.dataset.nodeId = record.id;
      hit.dataset.kind = record.kind;
      const text = document.createElement("span");
      text.setAttribute("aria-hidden", "true");
      text.textContent = record.title;
      text.className = styles.spatialLabel;
      hit.append(text);
      hit.onclick = () => onSelect(record.id);
      hit.onpointerenter = (event) => {
        if (event.pointerType === "touch" || event.buttons || this.orbiting) return;
        this.hoveredId = record.id;
        this.invalidateLabels();
      };
      hit.onpointerleave = () => {
        if (this.hoveredId !== record.id) return;
        this.hoveredId = null;
        this.invalidateLabels();
      };
      hit.onfocus = hit.onblur = hit.onkeydown = () => this.invalidateLabels();
      labels.append(hit);
      this.dots.push({ record, mesh, hit, text, anchor: "right" });
    }
    if (this.bounds.isEmpty())
      this.bounds.set(new THREE.Vector3(-100, -70, -40), new THREE.Vector3(100, 70, 40));
    this.bounds.getCenter(this.homeCenter);

    const points = new Map(this.dots.map((dot) => [dot.record.id, dot.mesh.position]));
    for (const edge of edges) {
      const from = points.get(edge.from),
        to = points.get(edge.to);
      if (!from || !to) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
      const material = edge.tree
        ? new THREE.LineBasicMaterial({ color: ink, transparent: true, opacity: 0.4 })
        : new THREE.LineDashedMaterial({
            color: ink,
            transparent: true,
            opacity: 0.32,
            dashSize: 2.3,
            gapSize: 2.6,
          });
      const line = new THREE.Line(geometry, material);
      if (!edge.tree) line.computeLineDistances();
      this.resources.push(geometry, material);
      this.links.push({ record: edge, line, material });
      this.scene.add(line);
    }

    const ringShape = new THREE.RingGeometry(8.8, 9.45, 60);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: ink,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    this.resources.push(ringShape, ringMaterial);
    this.selectionRing = new THREE.Mesh(ringShape, ringMaterial);
    this.selectionRing.renderOrder = 2;
    this.scene.add(this.selectionRing);

    this.home();
    this.resize();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(stage);
    this.controls.addEventListener("start", this.beginOrbit);
    this.controls.addEventListener("change", this.cameraChanged);
    this.controls.addEventListener("end", this.endOrbit);
    this.renderer.domElement.addEventListener("keydown", this.keyboard);
  }

  private resize() {
    const rect = this.stage.getBoundingClientRect();
    this.width = Math.max(rect.width, 1);
    this.height = Math.max(rect.height, 1);
    const extent = this.bounds.getSize(new THREE.Vector3());
    const aspect = this.width / this.height;
    // Reserve enough room for titles beside and below the outer record markers.
    const viewHeight = Math.max(140, extent.y * 1.32, (extent.x / aspect) * 1.24);
    this.camera.aspect = aspect;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(viewHeight / (2 * 715)));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height, false);
    this.arrangeLabels = true;
    this.requestRender();
  }

  home() {
    this.camera.position.copy(this.homeCenter).add(new THREE.Vector3(125, 108, 695));
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(this.homeCenter);
    this.controls.update();
    this.requestRender();
    this.report();
  }

  zoom(factor: number) {
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom * factor,
      this.controls.minZoom,
      this.controls.maxZoom,
    );
    this.camera.updateProjectionMatrix();
    this.cameraChanged();
    this.report();
  }

  apply(camera: GraphCamera) {
    if (
      !Number.isFinite(camera.zoom) ||
      camera.zoom <= 0 ||
      ![...camera.position, ...camera.target].every(Number.isFinite)
    )
      return;
    this.camera.position.fromArray(camera.position);
    this.controls.target.fromArray(camera.target);
    this.camera.zoom = THREE.MathUtils.clamp(camera.zoom, this.controls.minZoom, this.controls.maxZoom);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
    this.report();
  }

  focus(id: string) {
    const node = this.dots.find((dot) => dot.record.id === id && dot.mesh.visible);
    if (!node) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.copy(node.mesh.position);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.zoom = Math.max(this.camera.zoom, 1.28);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
    this.report();
  }

  update(
    visible: Set<string>,
    visibleEdges: Set<string> | undefined,
    selected: string | null,
    matches: Set<string>,
  ) {
    this.matches = matches;
    if (this.hoveredId && !visible.has(this.hoveredId)) this.hoveredId = null;
    let nodeCount = 0,
      edgeCount = 0;
    for (const dot of this.dots) {
      const showNode = visible.has(dot.record.id);
      const matched = matches.has(dot.record.id);
      if (dot.mesh.visible !== showNode || matched !== (dot.hit.dataset.matched === "true")) {
        this.arrangeLabels = true;
      }
      dot.mesh.visible = showNode;
      if (showNode) nodeCount++;
      dot.hit.hidden = !showNode;
      dot.hit.dataset.matched = String(matched);
      if (!showNode) dot.hit.dataset.labeled = "false";
      dot.hit.dataset.active = String(dot.record.id === selected);
      dot.hit.setAttribute("aria-pressed", String(dot.record.id === selected));
    }
    const selectedDot = this.dots.find((dot) => dot.record.id === selected && dot.mesh.visible);
    this.selectionRing.visible = !!selectedDot;
    if (selectedDot) this.selectionRing.position.copy(selectedDot.mesh.position);
    for (const link of this.links) {
      const { from, to } = link.record;
      link.line.visible =
        visible.has(from) && visible.has(to) && (!visibleEdges || visibleEdges.has(link.record.id));
      if (link.line.visible) edgeCount++;
      const active = from === selected || to === selected;
      link.material.color.set(active ? recordColors.decision : ink);
      link.material.opacity = active ? 0.82 : link.record.tree ? 0.51 : 0.37;
    }
    this.stage.dataset.visibleNodes = String(nodeCount);
    this.stage.dataset.visibleEdges = String(edgeCount);
    this.requestRender();
  }

  private report = () => {
    const state = {
      position: this.camera.position.toArray() as Triple,
      target: this.controls.target.toArray() as Triple,
      zoom: this.camera.zoom,
    };
    this.stage.dataset.camera = JSON.stringify(state);
    this.onCamera(state);
  };

  private keyboard = (event: KeyboardEvent) => {
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      this.zoom(event.key === "-" ? 1 / 1.2 : 1.2);
      return;
    }
    const motion: Record<string, [number, number]> = {
      ArrowLeft: [-0.13, 0],
      ArrowRight: [0.13, 0],
      ArrowUp: [0, -0.13],
      ArrowDown: [0, 0.13],
    };
    if (!motion[event.key]) return;
    event.preventDefault();
    const polar = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    const [theta, phi] = motion[event.key];
    polar.theta += theta;
    polar.phi = THREE.MathUtils.clamp(polar.phi + phi, 0.04, Math.PI - 0.04);
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3().setFromSpherical(polar));
    this.controls.update();
    this.report();
  };

  private requestRender = () => {
    if (this.closed || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.camera.updateMatrixWorld();
      this.selectionRing.quaternion.copy(this.camera.quaternion);
      this.renderer.render(this.scene, this.camera);
      this.projectLabels();
    });
  };

  private invalidateLabels = () => {
    this.arrangeLabels = true;
    this.requestRender();
  };

  private beginOrbit = () => {
    this.orbiting = true;
    this.hoveredId = null;
    window.clearTimeout(this.labelTimer);
  };

  private endOrbit = () => {
    this.orbiting = false;
    this.cameraChanged();
    this.report();
  };

  private cameraChanged = () => {
    this.requestRender();
    if (this.orbiting) return;
    // Wheel and keyboard navigation can emit a stream of separate camera changes.
    window.clearTimeout(this.labelTimer);
    this.labelTimer = window.setTimeout(this.invalidateLabels, 160);
  };

  private projectLabels() {
    const projected = this.dots
      .filter((dot) => dot.mesh.visible)
      .map((dot) => {
        const point = dot.mesh.position.clone().project(this.camera);
        const x = ((point.x + 1) * this.width) / 2;
        const y = ((1 - point.y) * this.height) / 2;
        dot.hit.hidden = x < 0 || x > this.width || y < 0 || y > this.height || Math.abs(point.z) > 1;
        return { dot, x, y, depth: point.z };
      })
      .filter(({ dot }) => !dot.hit.hidden);
    const focused = this.labels.querySelector<HTMLButtonElement>("button:focus-visible")?.dataset.nodeId;
    const inspecting = (dot: Dot) => dot.record.id === this.hoveredId || dot.record.id === focused;

    // Each hit target follows its node even when there is no visible label.
    [...projected]
      .sort((a, b) => b.depth - a.depth)
      .forEach(({ dot, x, y }, index) => {
        dot.hit.style.transform = `translate3d(${x - 13}px, ${y - 13}px, 0)`;
        dot.hit.style.zIndex = String(index + 1 + (inspecting(dot) ? projected.length : 0));
        if (!inspecting(dot) && !this.matches.has(dot.record.id)) dot.hit.dataset.labeled = "false";
      });

    if (!this.arrangeLabels || this.orbiting) return;
    this.arrangeLabels = false;
    const occupied: Rect[] = [];
    // A hovered or keyboard-focused record gets first choice of anchor among overlapping matches.
    const labelOrder = [...projected].sort(
      (a, b) => Number(inspecting(b.dot)) - Number(inspecting(a.dot)),
    );
    for (const { dot, x, y } of labelOrder) {
      if (!inspecting(dot) && !this.matches.has(dot.record.id)) continue;
      const w = dot.text.offsetWidth;
      const h = dot.text.offsetHeight;
      const offsets = {
        right: { x: 12, y: -h / 2 },
        left: { x: -w - 12, y: -h / 2 },
        below: { x: -w / 2, y: 11 },
        above: { x: -w / 2, y: -h - 11 },
      };
      // Stable record order prevents competing labels from swapping priority as depth changes.
      const sides = [dot.anchor, ...labelSides.filter((side) => side !== dot.anchor)];
      const candidates = sides
        .map((side) => {
          const preferred = offsets[side];
          // Labels above or below an outer node can align to the canvas edge and still point to it.
          const offset =
            side === "above" || side === "below"
              ? { x: THREE.MathUtils.clamp(preferred.x, 2 - x, this.width - w - 2 - x), y: preferred.y }
              : preferred;
          return { side, offset, box: { x: x + offset.x, y: y + offset.y, w, h } };
        })
        .filter(
          ({ box }) =>
            box.x >= 2 &&
            box.y >= 2 &&
            box.x + w <= this.width - 2 &&
            box.y + h <= this.height - 2 &&
            !occupied.some((other) => intersects(box, other)),
        );
      const choice =
        candidates.find(
          ({ box }) =>
            !projected.some(
              (other) =>
                other.dot !== dot && intersects(box, { x: other.x - 6, y: other.y - 6, w: 12, h: 12 }),
            ),
        ) ?? candidates[0];
      dot.hit.dataset.labeled = String(!!choice);
      if (!choice) continue;
      dot.anchor = choice.side;
      dot.text.style.left = `${13 + choice.offset.x}px`;
      dot.text.style.top = `${13 + choice.offset.y}px`;
      dot.text.style.textAlign = { right: "left", left: "right", above: "center", below: "center" }[
        choice.side
      ];
      occupied.push({ ...choice.box, w: w + 4, h: h + 4 });
    }
  }

  dispose() {
    this.closed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    window.clearTimeout(this.labelTimer);
    this.controls.removeEventListener("start", this.beginOrbit);
    this.controls.removeEventListener("change", this.cameraChanged);
    this.controls.removeEventListener("end", this.endOrbit);
    this.renderer.domElement.removeEventListener("keydown", this.keyboard);
    this.controls.dispose();
    this.resources.forEach((resource) => resource.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.replaceChildren();
  }
}

export default function Graph3D(props: SpatialProps) {
  const { nodes, edges, visibleIds, visibleEdgeIds, searchMatchIds, selectedId, focus, restore } = props;
  const stage = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null);
  const scene = useRef<SpatialScene | null>(null);
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  }, [props]);
  useEffect(() => {
    if (!stage.current || !labels.current) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      callbacks.current.onOpenTree?.();
      return;
    }
    const spatial = new SpatialScene(
      stage.current,
      labels.current,
      renderer,
      nodes,
      edges,
      (id) => callbacks.current.onSelect(id),
      (state) => callbacks.current.onCameraChange?.(state),
    );
    scene.current = spatial;
    const fallback = (event: Event) => {
      event.preventDefault();
      callbacks.current.onOpenTree?.();
    };
    renderer.domElement.addEventListener("webglcontextlost", fallback);
    const current = callbacks.current;
    spatial.update(
      new Set(current.visibleIds),
      current.visibleEdgeIds && new Set(current.visibleEdgeIds),
      current.selectedId,
      new Set(current.searchMatchIds),
    );
    if (current.restore) spatial.apply(current.restore.state);
    return () => {
      renderer.domElement.removeEventListener("webglcontextlost", fallback);
      spatial.dispose();
      scene.current = null;
    };
  }, [nodes, edges]);
  useEffect(() => {
    scene.current?.update(
      new Set(visibleIds),
      visibleEdgeIds && new Set(visibleEdgeIds),
      selectedId,
      new Set(searchMatchIds),
    );
  }, [visibleIds, visibleEdgeIds, selectedId, searchMatchIds]);
  const restoredSeq = useRef<number | null>(null);
  useEffect(() => {
    if (restore && restore.sequence !== restoredSeq.current) {
      restoredSeq.current = restore.sequence;
      scene.current?.apply(restore.state);
    }
  }, [restore]);
  const focusedSeq = useRef<number | null>(null);
  useEffect(() => {
    if (focus && focus.sequence !== focusedSeq.current && visibleIds.includes(focus.id)) {
      focusedSeq.current = focus.sequence;
      scene.current?.focus(focus.id);
    }
  }, [focus, visibleIds]);
  return (
    <div className={styles.space} ref={stage} data-testid="prototype-3d">
      <div ref={labels} className={styles.labelLayer} />
      <div className={styles.spatialControls} aria-label="3D camera controls">
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => scene.current?.zoom(1.22)}
        >
          +
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => scene.current?.zoom(1 / 1.22)}
        >
          −
        </button>
        <button
          type="button"
          aria-label="Fit graph"
          title="Fit graph"
          onClick={() => scene.current?.home()}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4" />
          </svg>
        </button>
      </div>
      <span className={styles.orbitHint}>
        Drag to orbit<span> · </span>Scroll to zoom
      </span>
      {visibleIds.length === 0 && (
        <p className={styles.empty}>No records at this point in the timeline.</p>
      )}
    </div>
  );
}
