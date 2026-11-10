import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { events } from "../lib/prototype/data";

test.use({
  viewport: { width: 681, height: 863 },
  hasTouch: true,
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

test("explores unnumbered decision points by hover, keyboard and click at compact width", async ({
  page,
}) => {
  await page.addInitScript((cutoff) => {
    const chart = {
      type: "scatter",
      title: "Influence and revenue",
      x: "aiShare",
      y: "revenue",
      decisionIds: [],
    };
    localStorage.setItem(
      "loomtracer.atlas.views.v1",
      JSON.stringify([
        {
          id: "scatter-preview",
          name: "Saved scatter",
          view: "chart",
          cutoff,
          selected: null,
          graphCamera: null,
          treeCamera: null,
          chart,
        },
      ]),
    );
  }, events.length - 1);
  await page.goto("/graph/prototype");
  await page.getByRole("button", { name: "Saved scatter", exact: true }).click();
  const chart = page.getByRole("region", { name: "Influence and revenue" });
  const points = chart.locator("[data-point]");
  await expect(points).toHaveCount(5);
  await expect(chart.locator("[data-point][tabindex='0']")).toHaveCount(1);
  await expect(points.locator("text")).toHaveCount(0);
  await expect(chart.getByLabel("Plotted decisions")).toHaveCount(0);

  const team = chart.locator("[data-point='team-plan']");
  await team.hover();
  const tip = chart.getByRole("tooltip");
  await expect(tip).toContainText("Launch the team plan");
  await expect(tip).toContainText("Bundle five seats");
  await expect(tip).toContainText("45%");
  await expect(tip).toContainText("$84,000");
  if (process.env.LOOMTRACER_SCREENSHOTS) {
    mkdirSync(process.env.LOOMTRACER_SCREENSHOTS, { recursive: true });
    await page.screenshot({ path: `${process.env.LOOMTRACER_SCREENSHOTS}/scatter-hover-681.png` });
  }
  const tipBox = await tip.boundingBox();
  const chartBox = await chart.boundingBox();
  const axis = await chart
    .locator("svg")
    .getByText("Assessed AI influence", { exact: true })
    .boundingBox();
  expect(axis!.y + axis!.height).toBeLessThanOrEqual(chartBox!.y + chartBox!.height);
  expect(tipBox!.x).toBeGreaterThanOrEqual(chartBox!.x);
  expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(chartBox!.x + chartBox!.width);
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();

  await team.focus();
  await expect(tip).toContainText("Launch the team plan");
  await team.press("ArrowRight");
  await expect(points.nth(1)).toBeFocused();
  await expect(tip).toContainText("Meter excess usage");
  await points.nth(1).press("Enter");
  await expect(page.getByTestId("record-detail")).toContainText("Meter excess usage");
  await page.getByRole("button", { name: "Close record details" }).click();
  await team.tap();
  await expect(page.getByTestId("record-detail")).toContainText("Launch the team plan");
});
