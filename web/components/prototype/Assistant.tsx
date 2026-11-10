"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { events, getSnapshot, type Snapshot, type ChartSpec } from "@/lib/prototype/data";
import { formatAnalysisAt, type AnalysisQuery } from "@/lib/prototype/analysis";
import RelatedAnalysisAnswer from "./RelatedAnalysisAnswer";
import { LinkedCountAnswer } from "./LinkedCountView";
import type { ChartFocus } from "./ChartView";
import EvidenceAnswer from "./EvidenceAnswer";
import { Icon } from "./Icon";
import { formatEventDate } from "./Timeline";
import styles from "./prototype.module.css";

type Message = {
  role: "user" | "assistant";
  text: string;
  cutoff: number;
  citations?: string[];
  chart?: ChartSpec | null;
  query?: AnalysisQuery;
};
type Question = { question: string; selectedId: string | null; cutoff: number; history: Message[] };
const prompts = [
  "Why did we choose the team plan?",
  "Plot AI influence against attributed revenue.",
  "Plot how often evidence is cited, supports a decision, or contradicts one.",
  "Plot how many recorded outcomes are linked to each decision.",
];

export default function Assistant({
  snapshot,
  selectedId,
  onChart,
  onCitation,
  onClose,
}: {
  snapshot: Snapshot;
  selectedId: string | null;
  onChart: (spec: ChartSpec, cutoff: number, group?: ChartFocus) => void;
  onCitation: (id: string, cutoff: number) => void;
  onClose: () => void;
}) {
  const cutoff = snapshot.cutoff;
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<{ request: Question; error: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const active = useRef<AbortController | null>(null);
  const current = useRef(cutoff);
  useEffect(() => {
    current.current = cutoff;
  }, [cutoff]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    const feed = end.current?.parentElement;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [messages, pending, failed]);
  async function send(request: Question) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setFailed(null);
    try {
      const response = await fetch("/api/prototype/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || typeof result.answer !== "string")
        throw new Error(result.error || "The assistant could not answer. Try again.");
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: result.answer,
          citations: result.citations,
          chart: result.chart,
          query:
            result.query ?? (result.chart && "query" in result.chart ? result.chart.query : undefined),
          cutoff: request.cutoff,
        },
      ]);
      if (result.chart && current.current === request.cutoff) onChart(result.chart, request.cutoff);
    } catch (err) {
      if (!controller.signal.aborted)
        setFailed({
          request,
          error: err instanceof Error ? err.message : "The assistant could not be reached.",
        });
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }
  function ask(input: string) {
    const question = input.trim();
    if (!question || active.current) return;
    const history = messages
      .filter((m) => m.cutoff <= cutoff)
      .slice(-8)
      .map((message) =>
        message.query
          ? {
              role: message.role,
              text: formatAnalysisAt(snapshot, message.query),
              cutoff,
            }
          : { role: message.role, text: message.text, cutoff: message.cutoff },
      );
    setMessages((previous) => [...previous, { role: "user", text: question, cutoff }]);
    setDraft("");
    void send({ question, cutoff, selectedId, history });
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    ask(draft);
  }
  return (
    <aside className={styles.assistant} aria-label="Graph assistant">
      <header className={styles.assistantHeader}>
        <span className={styles.assistantMark}>
          <Icon name="spark" size={20} />
        </span>
        <h2>Graph assistant</h2>
        <button className={styles.drawerClose} onClick={onClose} aria-label="Close chat">
          <Icon name="close" />
        </button>
      </header>
      <div className={styles.feed} aria-live="polite">
        {!messages.length && (
          <div className={styles.welcome}>
            <h3>Ask about this graph</h3>
            <p>Explore a decision, follow its evidence, or turn the project’s records into a chart.</p>
            <div className={styles.prompts}>
              {prompts.map((prompt, i) => (
                <button key={prompt} onClick={() => ask(prompt)}>
                  <Icon name={i === 1 ? "chart" : i === 2 ? "tree" : "chat"} size={17} />
                  <span>{prompt}</span>
                  <Icon name="arrow" size={14} />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, i) => {
          const query = message.query;
          const at = events[message.cutoff],
            citedSnapshot =
              !message.query && message.citations?.length ? getSnapshot(message.cutoff) : null;
          return (
            <article key={i} className={message.role === "user" ? styles.userMessage : styles.answer}>
              <div className={styles.messageMeta}>
                {message.role === "user" ? "You" : "Graph assistant"}
                <time dateTime={at.date} title={at.label}>
                  {formatEventDate(at.date)} · {message.cutoff + 1}/{events.length}
                </time>
              </div>
              {query?.kind === "relatedAnalysis" ? (
                <RelatedAnalysisAnswer
                  snapshot={snapshot}
                  query={query}
                  onRow={(recordId) => {
                    const spec: ChartSpec =
                      message.chart?.type === "relatedScatter"
                        ? message.chart
                        : { type: "relatedScatter", title: "Related record comparison", query };
                    onChart(spec, cutoff, { recordId });
                  }}
                />
              ) : query?.kind === "linkedCount" ? (
                <LinkedCountAnswer
                  snapshot={snapshot}
                  query={query}
                  onRow={(recordId) => {
                    const spec: ChartSpec =
                      message.chart?.type === "linkedCount"
                        ? message.chart
                        : { type: "linkedCount", title: "Linked record counts", query };
                    onChart(spec, cutoff, { recordId });
                  }}
                />
              ) : query ? (
                <EvidenceAnswer
                  snapshot={snapshot}
                  query={query}
                  onGroup={(evidenceId, role) => {
                    const spec: ChartSpec =
                      message.chart?.type === "evidence"
                        ? message.chart
                        : { type: "evidence", title: "Evidence use", query };
                    onChart(spec, cutoff, { evidenceId, role });
                  }}
                />
              ) : (
                <p>{message.text}</p>
              )}
              {!message.query &&
                message.citations?.map((id) => (
                  <button
                    key={id}
                    className={styles.citation}
                    onClick={() => onCitation(id, message.cutoff)}
                  >
                    <Icon name="file" size={14} />
                    {citedSnapshot?.nodes.find((n) => n.id === id)?.title ??
                      citedSnapshot?.sources.find((s) => s.id === id)?.title ??
                      id}
                  </button>
                ))}
              {message.chart && (
                <button
                  className={styles.citation}
                  onClick={() => onChart(message.chart!, message.query ? cutoff : message.cutoff)}
                >
                  <Icon name="chart" size={14} />
                  Open {message.chart.title}
                </button>
              )}
            </article>
          );
        })}
        {pending && (
          <p className={styles.pending} role="status">
            Reading the graph…
          </p>
        )}
        {failed && (
          <div className={styles.error} role="alert">
            <p>{failed.error}</p>
            <button onClick={() => void send(failed.request)}>Retry question</button>
          </div>
        )}
        <div ref={end} />
      </div>
      <form className={styles.composer} onSubmit={submit}>
        <label htmlFor="graph-question">
          <span className={styles.contextDot} />
          Context at {formatEventDate(events[cutoff].date)}
        </label>
        <div>
          <textarea
            id="graph-question"
            value={draft}
            maxLength={2000}
            rows={2}
            placeholder="Ask about this graph…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(draft);
              }
            }}
          />
          <button aria-label="Send question" type="submit" disabled={!draft.trim() || pending}>
            <Icon name="send" size={17} />
          </button>
        </div>
      </form>
    </aside>
  );
}
