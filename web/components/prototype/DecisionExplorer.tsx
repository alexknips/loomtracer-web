"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { PROJECT_NAME, getSnapshot, events, type ChartSpec, type ViewerHistory } from "@/lib/prototype/data";
import { evidenceRoleLabels, selectedEvidenceRoles } from "@/lib/prototype/graph-query";
import { analysisRowKind } from "@/lib/prototype/related-analysis";
import { recordColors, evidenceRoleColors } from "./graphColors";
import type { ChartFocus } from "./ChartView";
import type { GraphCamera } from "./Graph3D";
import type { TreeCamera } from "./DecisionTree";
import ChartView from "./ChartView";
import { ChartExamples } from "./ChartExamples";
import Assistant from "./Assistant";
import RecordDetail from "./RecordDetail";
import Timeline from "./Timeline";
import { Icon } from "./Icon";
import { useSavedViews, persistView, type SavedView, type SavedViewScope } from "./savedViews";
import styles from "./prototype.module.css";

const Graph3D = dynamic(() => import("./Graph3D"), { ssr: false });
const DecisionTree = dynamic(() => import("./DecisionTree"), { ssr: false });
const atlasHistory: ViewerHistory = { events, getSnapshot };
const kinds = ["decision", "alternative", "evidence", "outcome"] as const;
type View = SavedView["view"];
const viewLabels = { "3d": "3D graph", tree: "Tree view", chart: "Chart" };
type Restore<T> = { sequence: number; state: T };

export default function DecisionExplorer({
  workspaceAvailable = true,
  localChatEnabled = false,
  history = atlasHistory,
  savedScope,
  header,
}: {
  workspaceAvailable?: boolean;
  localChatEnabled?: boolean;
  history?: ViewerHistory;
  savedScope?: SavedViewScope;
  header?: ReactNode;
}) {
  const isAtlas = history === atlasHistory;
  const chatEnabled = isAtlas && localChatEnabled;
  const latest = Math.max(0, history.events.length - 1);
  const scene = useMemo(() => history.getSnapshot(), [history]);
  const [cutoff, setCutoff] = useState(latest);
  const [view, setView] = useState<View>("3d");
  const [selected, setSelected] = useState<string | null>(null);
  const [chart, setChart] = useState<ChartSpec | null>(null);
  const [chartOpen, setChartOpen] = useState<{
    key: number;
    group?: ChartFocus;
  }>({ key: 0 });
  const [focus, setFocus] = useState<{ id: string; sequence: number }>();
  const [restore3D, setRestore3D] = useState<Restore<GraphCamera>>();
  const [restoreTree, setRestoreTree] = useState<Restore<TreeCamera>>();
  const graphCamera = useRef<GraphCamera | null>(null),
    treeCamera = useRef<TreeCamera | null>(null);
  const serial = useRef(0);
  const [activeSaved, setActiveSaved] = useState<string | null>(null);
  const viewTabs = useRef<HTMLElement>(null);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState("");
  const [drawer, setDrawer] = useState(false);
  const drawerPanel = useRef<HTMLDivElement>(null);
  const chatTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (drawer)
      drawerPanel.current?.querySelector<HTMLButtonElement>('[aria-label="Close chat"]')?.focus();
  }, [drawer]);
  function closeDrawer() {
    setDrawer(false);
    chatTrigger.current?.focus();
  }
  const [fallback, setFallback] = useState(false);
  const saved = useSavedViews(savedScope, history.events);
  useEffect(() => {
    const tabs = viewTabs.current;
    const active = tabs?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (!tabs || !active) return;
    const bounds = tabs.getBoundingClientRect();
    const button = active.getBoundingClientRect();
    if (button.right > bounds.right) tabs.scrollLeft += button.right - bounds.right;
    else if (button.left < bounds.left) tabs.scrollLeft -= bounds.left - button.left;
  }, [view, activeSaved, chart]);
  const snapshot = useMemo(() => history.getSnapshot(cutoff), [history, cutoff]);
  const milestones = useMemo(() => new Set(scene.nodes.filter((n) => n.kind === "decision").map((n) => n.id)), [scene]);
  const legendKinds = useMemo(() => isAtlas ? kinds : [...new Set(snapshot.nodes.map((n) => n.kind))], [isAtlas, snapshot.nodes]);
  const visibleIds = useMemo(() => snapshot.nodes.map((n) => n.id), [snapshot]);
  const visibleEdgeIds = useMemo(() => snapshot.edges.map((e) => e.id), [snapshot]);
  const visibleSelected = visibleIds.includes(selected ?? "") ? selected : null;
  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return snapshot.nodes
      .filter((node) =>
        [node.title, node.summary, node.actor].some((value) => value.toLowerCase().includes(term)),
      )
      .sort((a, b) => Number(b.kind === "decision") - Number(a.kind === "decision"));
  }, [search, snapshot.nodes]);
  const searchMatchIds = useMemo(() => matches.map((node) => node.id), [matches]);
  const remember3D = useCallback((s: GraphCamera) => {
    graphCamera.current = s;
  }, []);
  const rememberTree = useCallback((s: TreeCamera) => {
    treeCamera.current = s;
  }, []);
  const toTree = useCallback(() => {
    setFallback(true);
    setView("tree");
    setActiveSaved(null);
  }, []);
  function switchView(next: View) {
    setActiveSaved(null);
    setView(next);
    setSaving(false);
    setSearchOpen(false);
    setFocus(undefined);
    if (graphCamera.current) setRestore3D({ sequence: ++serial.current, state: graphCamera.current });
    if (treeCamera.current) setRestoreTree({ sequence: ++serial.current, state: treeCamera.current });
  }
  function showResult(id: string) {
    if (view !== "3d") {
      setView("tree");
      setSearch("");
    }
    setActiveSaved(null);
    setSelected(id);
    setFocus({ id, sequence: ++serial.current });
    setSearchOpen(false);
  }
  function showChart(spec: ChartSpec, at: number, group?: ChartFocus) {
    setChart(spec);
    setCutoff(at);
    setChartOpen({ key: ++serial.current, group });
    setView("chart");
    setActiveSaved(null);
    setSelected(null);
    setDrawer(false);
  }
  function openCitation(id: string, at: number) {
    const recorded = history.getSnapshot(at);
    if (!recorded.nodes.some((n) => n.id === id) && !recorded.sources.some((s) => s.id === id)) return;
    setCutoff(at);
    setSelected(id);
    setActiveSaved(null);
    setDrawer(false);
    if (recorded.nodes.some((n) => n.id === id)) setFocus({ id, sequence: ++serial.current });
  }
  function restore(saved: SavedView) {
    setView(saved.view);
    setCutoff(saved.cutoff);
    setSelected(saved.selected);
    setChart(saved.chart);
    setChartOpen({ key: ++serial.current });
    setFocus(undefined);
    setRestore3D(
      saved.graphCamera ? { sequence: ++serial.current, state: saved.graphCamera } : undefined,
    );
    setRestoreTree(
      saved.treeCamera ? { sequence: ++serial.current, state: saved.treeCamera } : undefined,
    );
    setActiveSaved(saved.id);
    setSaving(false);
    setSearchOpen(false);
  }
  function beginSave() {
    setSaving((v) => !v);
    setName(
      view === "chart" && chart
        ? chart.title
        : (snapshot.nodes.find((n) => n.id === selected)?.title ?? viewLabels[view]),
    );
    setSaveError("");
  }
  function save(e: React.FormEvent) {
    e.preventDefault();
    const title = name.trim();
    if (!title) return;
    const id = crypto.randomUUID();
    try {
      persistView({
        id,
        name: title,
        view,
        cutoff,
        selected,
        graphCamera: graphCamera.current,
        treeCamera: treeCamera.current,
        chart,
      }, savedScope, history.events);
      setSaving(false);
      setActiveSaved(id);
    } catch {
      setSaveError("This browser could not save the view. Your current view is still open.");
    }
  }
  const graphProps = {
    nodes: scene.nodes,
    edges: scene.edges,
    visibleIds,
    visibleEdgeIds,
    selectedId: visibleSelected,
    onSelect: setSelected,
    focus,
  };

  return (
    <div className={styles.page}>
      {isAtlas && header === undefined ? <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link className={styles.brandHome} href="/" aria-label="Loomtracer home">
            <BrandLogo className={styles.logo} />
          </Link>
          <div className={styles.projectHeading}>
            <nav aria-label="Project navigation" className={styles.projectTrail}>
              <Link href={workspaceAvailable ? "/projects" : "/demo"}>
                {workspaceAvailable ? "Projects" : "Demo overview"}
              </Link>
              <Icon name="chevron" size={12} />
              <span>Fictional project</span>
            </nav>
            <h1>{PROJECT_NAME}</h1>
          </div>
          {workspaceAvailable && (
            <Link
              href="/account/settings"
              className={styles.accountLink}
              aria-label="Account settings"
              title="Account settings"
            >
              <Icon name="account" size={18} />
              <span>Account settings</span>
            </Link>
          )}
        </div>
      </header> : header}
      <main className={styles.workspace} aria-label="Decision explorer" data-chat={chatEnabled}>
        <div className={styles.left}>
          <div className={styles.nav}>
            <nav ref={viewTabs} aria-label="Viewer modes" className={styles.tabs}>
              <button aria-pressed={view === "3d" && !activeSaved} onClick={() => switchView("3d")}>
                <Icon name="cube" size={17} />
                3D graph
              </button>
              <button aria-pressed={view === "tree" && !activeSaved} onClick={() => switchView("tree")}>
                <Icon name="tree" size={17} />
                Tree view
              </button>
              {chart && !activeSaved && (
                <button
                  aria-pressed={view === "chart"}
                  title={chart.title}
                  onClick={() => switchView("chart")}
                >
                  <Icon name="chart" size={17} />
                  {chart.title}
                </button>
              )}
              {saved.map((s) => (
                <button
                  key={s.id}
                  aria-pressed={activeSaved === s.id}
                  title={s.name}
                  onClick={() => restore(s)}
                >
                  <Icon name="bookmark" size={15} />
                  {s.name}
                </button>
              ))}
            </nav>
            <ChartExamples snapshot={isAtlas ? undefined : snapshot} onOpen={(spec) => showChart(spec, cutoff)} />
            <div className={styles.saveWrap}>
              <button className={styles.save} aria-expanded={saving} onClick={beginSave}>
                <Icon name="bookmark" size={16} />
                Save view
              </button>
              {saving && (
                <form
                  className={styles.saveForm}
                  onSubmit={save}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSaving(false);
                  }}
                >
                  <label htmlFor="view-name">Name this view</label>
                  <input
                    id="view-name"
                    autoFocus
                    value={name}
                    maxLength={64}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <div>
                    <button type="button" onClick={() => setSaving(false)}>
                      Cancel
                    </button>
                    <button type="submit" disabled={!name.trim()}>
                      Save
                    </button>
                  </div>
                  {saveError && <p role="alert">{saveError}</p>}
                </form>
              )}
            </div>
          </div>
          <section className={styles.surface} aria-label={viewLabels[view]}>
            <div className={styles.toolbar}>
              <div className={styles.searchWrap}>
                <div className={styles.search}>
                  <Icon name="search" size={15} />
                  <input
                    aria-label={isAtlas ? "Search decisions" : "Search project records"}
                    type="search"
                    placeholder={isAtlas ? "Find a decision…" : "Find a record…"}
                    value={search}
                    onFocus={() => setSearchOpen(true)}
                    onBlur={(e) => {
                      if (!e.currentTarget.parentElement?.parentElement?.contains(e.relatedTarget))
                        setSearchOpen(false);
                    }}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setSearchOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearch("");
                        setSearchOpen(false);
                      }
                      if (e.key === "Enter" && matches.length) {
                        e.preventDefault();
                        showResult(matches[0].id);
                      }
                    }}
                  />
                </div>
                {search.trim() && searchOpen && (
                  <div className={styles.results} aria-label="Search results">
                    {matches.length ? (
                      matches.map((n) => (
                        <button key={n.id} onClick={() => showResult(n.id)}>
                          <strong>{n.title}</strong>
                          <small>{n.typeLabel ?? n.kind}</small>
                        </button>
                      ))
                    ) : (
                      <p>No matching records at this point.</p>
                    )}
                  </div>
                )}
              </div>
              <span className={styles.recordCount}>
                {snapshot.nodes.length} records <i>·</i> {snapshot.edges.length} links
              </span>
            </div>
            <div className={styles.canvas}>
              {view === "3d" && (
                <Graph3D
                  {...graphProps}
                  searchMatchIds={searchMatchIds}
                  restore={restore3D}
                  onCameraChange={remember3D}
                  onOpenTree={toTree}
                />
              )}
              {view === "tree" && (
                <DecisionTree {...graphProps} restore={restoreTree} onCameraChange={rememberTree} />
              )}
              {view === "chart" && chart && (
                <ChartView
                  key={chartOpen.key}
                  initialFocus={chartOpen.group}
                  snapshot={snapshot}
                  spec={chart}
                  selectedId={visibleSelected}
                  onSelect={setSelected}
                />
              )}
              <RecordDetail
                snapshot={snapshot}
                id={selected}
                onSelect={setSelected}
                onClose={() => setSelected(null)}
              />
            </div>
            <div className={styles.legend} role="group" aria-label="Color key">
              {view === "chart" && chart?.type === "evidence"
                ? selectedEvidenceRoles(chart.query).map((role) => (
                    <span key={role}>
                      <i style={{ backgroundColor: evidenceRoleColors[role] }} />
                      {evidenceRoleLabels[role]}
                    </span>
                  ))
                : (view === "chart"
                    ? ([
                        chart?.type === "relatedScatter"
                          ? analysisRowKind(chart.query.source)
                          : chart?.type === "linkedCount"
                            ? chart.query.linkedKind
                            : "decision",
                      ] as const)
                    : legendKinds
                  ).map((kind) => (
                    <span key={kind}>
                      <i style={{ backgroundColor: recordColors[kind] }} />
                      {kind === "external" ? "External reference" : kind[0].toUpperCase() + kind.slice(1)}
                    </span>
                  ))}
              {fallback && view === "tree" && (
                <span className={styles.fallback}>3D unavailable on this device</span>
              )}
            </div>
          </section>
          <Timeline events={history.events} decisionIds={milestones} cutoff={cutoff} onChange={setCutoff} />
        </div>
        {chatEnabled && (
          <>
            <button
              ref={chatTrigger}
              className={styles.mobileChat}
              onClick={() => setDrawer(true)}
              aria-expanded={drawer}
            >
              <Icon name="chat" size={17} />
              Graph assistant
            </button>
            {drawer && (
              <button
                tabIndex={-1}
                aria-label="Dismiss chat drawer"
                className={styles.backdrop}
                onClick={closeDrawer}
              />
            )}
            <div
              ref={drawerPanel}
              className={styles.chatColumn}
              data-open={drawer}
              role={drawer ? "dialog" : undefined}
              aria-label={drawer ? "Graph chat" : undefined}
              aria-modal={drawer || undefined}
              onKeyDown={(e) => {
                if (!drawer) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  closeDrawer();
                  return;
                }
                if (e.key !== "Tab") return;
                const controls = e.currentTarget.querySelectorAll<HTMLElement>(
                  "button:not(:disabled), textarea",
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                  e.preventDefault();
                  last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                  e.preventDefault();
                  first?.focus();
                }
              }}
            >
              <Assistant
                snapshot={snapshot}
                selectedId={visibleSelected}
                onChart={showChart}
                onCitation={openCitation}
                onClose={closeDrawer}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
