import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getSnapshot } from "@/lib/prototype/data";
import type { RelatedAnalysisQuery } from "@/lib/prototype/related-analysis";
import ChartView from "./ChartView";

const outcomes: RelatedAnalysisQuery = {
  kind: "relatedAnalysis",
  source: { kind: "linkedCount", rowKind: "outcome", linkedKind: "decision", rowIds: ["pilot-conversion"] },
  x: { operation: "mean", field: "aiShare" },
  y: { operation: "countDistinct", field: "recordId" },
};

function markup(query: RelatedAnalysisQuery) {
  return renderToStaticMarkup(createElement(ChartView, {
    spec: { type: "relatedScatter", title: "Pilot outcome comparison", query },
    snapshot: getSnapshot(), selectedId: null, onSelect: () => {},
    initialFocus: { recordId: "pilot-conversion" },
  }));
}

describe("grouped comparison chart", () => {
  it("renders a linked outcome as a point with swapped count and average axes and its distinct members", () => {
    const html = markup(outcomes);
    expect(html).toContain('data-point="pilot-conversion"');
    expect(html).toContain("Eight pilot studios convert, Mean assessed AI influence 27.5%, Distinct linked decisions 2");
    expect(html).toContain('aria-label="Records behind this point"');
    expect(html).toContain("2 contributing decisions");
    expect(html).toContain("Pilot with twelve studios");
    expect(html).toContain("Launch the team plan");
    expect(html).not.toContain("Plotted decisions");
  });

  it("makes an incomplete mean drillable without plotting it as a coordinate", () => {
    const html = markup({ ...outcomes, x: { operation: "mean", field: "revenue" } });
    expect(html).not.toContain('data-point="pilot-conversion"');
    expect(html).toContain('data-testid="unplotted-pilot-conversion"');
    expect(html).toContain("$84,000 mean of reported values (1 of 2 measured)");
    expect(html).toContain("Unreported");
  });
});
