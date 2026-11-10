"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import styles from "./chart.module.css";

export type PlotPoint = { id: string; title: string; summary: string; x: number; y: number };
export type PlotAxis = {
  label: string;
  ticks: number[];
  format: (value: number, compact?: boolean) => string;
};

/** Count axes have integer ticks. All numeric axes include zero, even for a set of negative values. */
export function plotAxis(
  values: number[],
  label: string,
  format: PlotAxis["format"],
  scale: "count" | "percent" | "numeric",
): PlotAxis {
  if (scale === "percent") return { label, ticks: [0, 25, 50, 75, 100], format };
  let low = 0,
    high = 0;
  for (const value of values) {
    low = Math.min(value, low);
    high = Math.max(value, high);
  }
  if (low === high) high = 1;
  const interval = Math.max(scale === "count" ? 1 : 0, (high - low) / 4);
  const magnitude = 10 ** Math.floor(Math.log10(interval));
  const scaleSteps = scale === "count" ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = magnitude * (scaleSteps.find((factor) => factor * magnitude >= interval) ?? 10);
  const first = Math.floor(low / step);
  const last = scale === "numeric" && low === 0 ? 4 : Math.ceil(high / step);
  const ticks = Array.from({ length: last - first + 1 }, (_, i) => (first + i) * step);
  return { label, ticks, format };
}

export default function ScatterPlot({
  data,
  x,
  y,
  groupLabel,
  color,
  hasFootnote = false,
  selectedId,
  onSelect,
}: {
  data: PlotPoint[];
  x: PlotAxis;
  y: PlotAxis;
  groupLabel: string;
  color?: string;
  hasFootnote?: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [{ width, availableHeight }, setSize] = useState({ width: 580, availableHeight: 355 });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const tipId = useId();
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelDismiss() {
    if (dismissTimer.current !== null) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
  }
  function scheduleDismiss() {
    cancelDismiss();
    dismissTimer.current = setTimeout(() => {
      const focused = surface.current?.querySelector<SVGGElement>("[data-point]:focus-visible");
      setActiveId(focused?.dataset.point ?? null);
    }, 180);
  }
  useEffect(
    () => () => {
      if (dismissTimer.current !== null) clearTimeout(dismissTimer.current);
    },
    [],
  );
  useEffect(() => {
    const host = surface.current;
    const chart = host?.parentElement;
    const header = chart?.querySelector("header");
    const footnote = hasFootnote ? chart?.querySelector<HTMLElement>("[data-plot-footnote]") : null;
    if (!host || !chart || !header) return;
    const observer = new ResizeObserver(() => {
      const width = host.clientWidth;
      if (!width) return;
      const chartStyle = getComputedStyle(chart);
      const plotStyle = getComputedStyle(host);
      const availableHeight =
        chart.clientHeight -
        header.offsetHeight -
        Math.min(110, footnote?.offsetHeight ?? 0) -
        parseFloat(chartStyle.paddingTop) -
        parseFloat(chartStyle.paddingBottom) -
        parseFloat(plotStyle.marginTop) -
        parseFloat(plotStyle.marginBottom);
      setSize((size) =>
        size.width === width && size.availableHeight === availableHeight
          ? size
          : { width, availableHeight },
      );
    });
    observer.observe(host);
    observer.observe(chart);
    observer.observe(header);
    if (footnote) observer.observe(footnote);
    return () => observer.disconnect();
  }, [hasFootnote]);
  useEffect(() => {
    if (activeId === null) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [activeId]);

  const height = Math.max(210, Math.min(availableHeight, 355, width * 0.57));
  const labelWidth = Math.max(...y.ticks.map((tick) => y.format(tick, true).length)) * 7;
  const left = Math.max(width < 420 ? 52 : 65, 27 + labelWidth);
  const right = 23;
  const top = 15;
  const bottom = 50;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const xFraction = (value: number) => (value - x.ticks[0]) / (x.ticks[x.ticks.length - 1] - x.ticks[0]);
  const yFraction = (value: number) => (value - y.ticks[0]) / (y.ticks[y.ticks.length - 1] - y.ticks[0]);
  const points = data.map((point) => ({
    ...point,
    px: left + xFraction(point.x) * plotWidth,
    py: top + (1 - yFraction(point.y)) * plotHeight,
  }));
  const active = points.find((point) => point.id === activeId);
  const reachableId = points.some((point) => point.id === tabId) ? tabId : points[0]?.id;
  const radius = points.length > 100 ? 3.5 : points.length > 25 ? 5 : 7;

  return (
    <div
      ref={surface}
      className={styles.plotSurface}
      style={color ? ({ "--point-color": color } as CSSProperties) : undefined}
      onPointerLeave={() => {
        cancelDismiss();
        if (!surface.current?.querySelector("[data-point]:focus-visible")) setActiveId(null);
      }}
    >
      <svg
        className={styles.scatter}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`${x.label} versus ${y.label}. Use the arrow keys to explore ${groupLabel} and Enter to inspect a point.`}
      >
        {x.ticks.map((tick) => {
          const px = left + xFraction(tick) * plotWidth;
          return (
            <g key={tick} className={styles.tick}>
              <line x1={px} x2={px} y1={top} y2={top + plotHeight} />
              <text x={px} y={top + plotHeight + 17} textAnchor="middle">
                {x.format(tick, true)}
              </text>
            </g>
          );
        })}
        {y.ticks.map((tick) => {
          const py = top + (1 - yFraction(tick)) * plotHeight;
          return (
            <g key={tick} className={styles.tick}>
              <line x1={left} x2={left + plotWidth} y1={py} y2={py} />
              <text x={left - 8} y={py + 4} textAnchor="end">
                {y.format(tick, true)}
              </text>
            </g>
          );
        })}
        <text className={styles.axis} x={left + plotWidth / 2} y={height - 5} textAnchor="middle">
          {x.label}
        </text>
        <text
          className={styles.axis}
          transform={`translate(12 ${top + plotHeight / 2}) rotate(-90)`}
          textAnchor="middle"
        >
          {y.label}
        </text>
        {points.map((point, index) => {
          return (
            <g
              key={point.id}
              data-point={point.id}
              role="button"
              tabIndex={reachableId === point.id ? 0 : -1}
              className={styles.point}
              aria-pressed={selectedId === point.id}
              aria-describedby={active?.id === point.id ? tipId : undefined}
              aria-label={`${point.title}, ${x.label} ${x.format(point.x)}, ${y.label} ${y.format(point.y)}`}
              onPointerEnter={(event) => {
                cancelDismiss();
                if (event.pointerType !== "touch") setActiveId(point.id);
              }}
              onPointerLeave={scheduleDismiss}
              onFocus={() => {
                cancelDismiss();
                setTabId(point.id);
                setActiveId(point.id);
              }}
              onBlur={() => setActiveId(null)}
              onClick={() => {
                setActiveId(null);
                onSelect(point.id);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveId(null);
                  onSelect(point.id);
                  return;
                }
                const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
                if (!offset && event.key !== "Home" && event.key !== "End") return;
                event.preventDefault();
                const target =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? points.length - 1
                      : (points.length + index + offset!) % points.length;
                surface.current?.querySelectorAll<SVGGElement>("[data-point]")[target]?.focus();
              }}
            >
              <circle cx={point.px} cy={point.py} r={Math.max(radius + 3, 12)} fill="transparent" />
              <circle className={styles.focusRing} cx={point.px} cy={point.py} r={radius + 3} />
              <circle className={styles.marker} cx={point.px} cy={point.py} r={radius} />
            </g>
          );
        })}
      </svg>
      {active && (
        <div
          id={tipId}
          role="tooltip"
          className={styles.pointTooltip}
          data-above={active.py > height / 2}
          onPointerEnter={cancelDismiss}
          onPointerLeave={scheduleDismiss}
          style={{
            left: `clamp(0px, calc(${(active.px / width) * 100}% - var(--tip-width) / 2), calc(100% - var(--tip-width)))`,
            top: `${(active.py / height) * 100}%`,
          }}
        >
          <strong>{active.title}</strong>
          <p>{active.summary}</p>
          <dl>
            <div>
              <dt>{x.label}</dt>
              <dd>{x.format(active.x)}</dd>
            </div>
            <div>
              <dt>{y.label}</dt>
              <dd>{y.format(active.y)}</dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
