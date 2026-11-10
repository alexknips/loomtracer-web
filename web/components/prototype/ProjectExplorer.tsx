"use client";

import type { ReasoningBundle } from "@reasoning";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandLogo } from "@/components/brand-logo";
import { createHostedHistory } from "@/lib/prototype/hosted-history";
import DecisionExplorer from "./DecisionExplorer";
import { Icon } from "./Icon";
import chrome from "./project-explorer.module.css";
import styles from "./prototype.module.css";

type Project = { ref: string; name: string; decisions: number };
type Detail = { bundle: ReasoningBundle; decisions: { shown: number; total: number; truncated: boolean } };
type Read<T> = { url: string; attempt: number; data?: T; error?: string };

function useLedgerRead<T>(url: string | null, attempt: number) {
  const [result, setResult] = useState<Read<T> | null>(null);
  useEffect(() => {
    if (!url) return;
    const endpoint = url;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Could not load the project ledger.");
        const data: T = await response.json();
        if (!controller.signal.aborted) setResult({ url: endpoint, attempt, data });
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({ url: endpoint, attempt, error: error instanceof Error ? error.message : "The ledger is unavailable." });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [url, attempt]);
  return result?.url === url && result.attempt === attempt ? result : null;
}

function projectUrl(path: string, ref?: string) {
  return ref ? path + "?" + new URLSearchParams({ project: ref }) : path;
}

export function ProjectExplorer({ workspace, user, initialProject }: {
  workspace: string; user: string; initialProject: string;
}) {
  const router = useRouter();
  const [attempt, retry] = useState(0);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const historyMenu = useRef<HTMLDetailsElement>(null);
  const projectList = useLedgerRead<{ projects: Project[] }>("/api/reasoning", attempt);
  const projects = projectList?.data?.projects;
  const current = initialProject
    ? projects?.find(project => project.ref === initialProject)
    : projects?.find(project => project.decisions > 0) ?? projects?.[0];
  let endpoint: string | null = null;
  if (current) {
    const query = new URLSearchParams({ project_ref: current.ref });
    if (expandedProject === current.ref) query.set("limit", "1000");
    endpoint = "/api/reasoning?" + query;
  }
  const detail = useLedgerRead<Detail>(endpoint, attempt);
  const bundle = detail?.data?.bundle;
  const coverage = detail?.data?.decisions;
  const model = useMemo(() => bundle ? createHostedHistory(bundle) : null, [bundle]);

  const header = <header className={styles.header}>
    <div className={styles.headerInner}>
      <Link href="/graph" className={styles.brandHome} aria-label="Loomtracer graph home"><BrandLogo className={styles.logo} /></Link>
      <div className={styles.projectHeading}>
        <nav aria-label="Project navigation" className={styles.projectTrail}>
          <Link href="/projects">Projects</Link><Icon name="chevron" size={12} />
          <select aria-label="Reasoning project" className={chrome.projectSelect} value={current?.ref ?? ""}
            disabled={!projects?.length} onChange={event => {
              setExpandedProject(null);
              router.push(projectUrl("/graph/prototype", event.target.value), { scroll: false });
            }}>
            {!current && <option value="">Choose a project</option>}
            {projects?.map(project => <option key={project.ref} value={project.ref}>{project.name}</option>)}
          </select>
          {coverage?.truncated && <span aria-label="Ledger coverage">{coverage.shown} of {coverage.total} decisions</span>}
        </nav>
        <h1 title={bundle?.title ?? current?.name}>{bundle?.title ?? current?.name ?? "Decision explorer"}</h1>
      </div>
      <div className={chrome.actions}>
        <details ref={historyMenu} className={chrome.history} onKeyDown={event => {
          if (event.key === "Escape" && historyMenu.current?.open) {
            historyMenu.current.open = false;
            historyMenu.current.querySelector("summary")?.focus();
          }
        }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }}>
          <summary>History</summary>
          <div className={chrome.popover}>
            {current && coverage?.truncated && coverage.shown < 1000 && <button type="button" className={styles.save}
              onClick={() => setExpandedProject(current.ref)}>Draw up to 1,000 decisions</button>}
            <Link href={projectUrl("/graph", current?.ref)}>Open history inspector</Link>
            <Link href="/inspect">Inspect a file</Link>
            <Link href="/graph/prototype">Explore Atlas demo</Link>
          </div>
        </details>
        <Link href="/account/settings" aria-label="Account settings" title="Account settings" className={styles.accountLink}>
          <Icon name="account" size={18} /><span>Account settings</span>
        </Link>
      </div>
    </div>
  </header>;

  if (current && bundle && model?.events.length) {
    return <DecisionExplorer key={JSON.stringify([current.ref, bundle.id])} history={model} header={header}
      savedScope={[workspace, user, current.ref, bundle.id]} workspaceAvailable localChatEnabled={false} />;
  }

  const error = projectList?.error ?? detail?.error;
  let message = "Opening project history…";
  if (error) message = error;
  else if (projects && !current) message = projects.length ? "Choose an available project in the header." : "There are no projects in this ledger.";
  else if (model) message = "This project has no recorded history yet.";
  return <div className={styles.page}>{header}
    <main className={chrome.status}><p role={error ? "alert" : "status"}>{message}</p>
      {error && <button className={styles.save} onClick={() => retry(value => value + 1)}>Try again</button>}
    </main>
  </div>;
}
