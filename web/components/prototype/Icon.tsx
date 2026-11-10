import type { CSSProperties } from "react";

const paths = {
  cube: "m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5m-9 5L3 7m9 5v10",
  tree: "M3 3h6v5H3z M15 3h6v5h-6z M15 16h6v5h-6z M9 5.5h6 M9 5.5h2v13h4",
  chart: "M4 3v17h17 M8 14h1 M11 10h1 M16 12h1 M18 5h1",
  bookmark: "M6 3h12v18l-6-4-6 4V3Z",
  chat: "M4 4h16v12H9l-5 4V4Z M8 8h8m-8 4h5",
  spark: "m12 2 2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2Z",
  send: "M12 20V4m-7 7 7-7 7 7",
  search: "M20 20l-5.3-5.3 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  arrow: "M4 12h15m-6-6 6 6-6 6",
  close: "m6 6 12 12M18 6 6 18",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v6l4 2",
  latest: "m5 5 9 7-9 7V5Zm13 0v14",
  file: "M6 2h8l4 4v16H6V2Zm8 0v5h4M9 12h6m-6 4h6",
  project: "M3 7V4h7l2 3h9v13H3V7Z",
  account: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0",
  chevron: "m9 5 7 7-7 7",
} as const;
export function Icon({
  name,
  size = 18,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
