import { expect, test, type Locator } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 960 },
  launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
});

function readAnchors(labels: Locator) {
  return labels.evaluateAll((elements) =>
    elements.map((element) => {
      const label = element as HTMLSpanElement;
      return { id: label.parentElement?.dataset.nodeId, left: label.style.left, top: label.style.top };
    }),
  );
}

test("3D labels follow search and keep their anchors while orbiting", async ({ page }) => {
  await page.goto("/graph/prototype");
  const graph = page.getByTestId("prototype-3d");
  const labels = graph.locator("button[data-node-id] > span:visible");
  const node = graph.getByRole("button", { name: "decision: Launch the team plan", exact: true });
  await expect(node).toBeVisible();
  await expect(labels).toHaveCount(0);
  await node.hover();
  await expect(labels).toHaveText(["Launch the team plan"]);
  await node.locator("span").hover();
  await expect(labels).toHaveText(["Launch the team plan"]);
  await page.mouse.move(1, 1);
  await expect(labels).toHaveCount(0);

  await graph.locator("canvas").focus();
  await page.keyboard.press("Tab");
  await expect(labels).toHaveText(["Open the pricing review"]);
  await node.focus();
  await expect(labels).toHaveText(["Launch the team plan"]);
  await node.press("Enter");
  await expect(page.getByTestId("record-detail")).toContainText("Launch the team plan");
  await page.getByRole("button", { name: "Close record details" }).click();
  await expect(labels).toHaveCount(0);

  const search = page.getByRole("searchbox", { name: "Search decisions" });
  await search.fill("annual");
  await search.blur();
  await expect(labels).toHaveText([
    "Offer annual billing",
    "Discount annual plans by 25%",
    "Twelve teams prepay",
  ]);
  await node.hover();
  await expect(labels).toContainText(["Launch the team plan"]);
  await page.mouse.move(1, 1);
  await expect(labels).toHaveCount(3);
  const anchors = await readAnchors(labels);
  const camera = await graph.getAttribute("data-camera");
  const bounds = await graph.boundingBox();
  expect(bounds).toBeTruthy();
  const x = bounds!.x + 40,
    y = bounds!.y + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const offset of [8, 16, 24]) {
    await page.mouse.move(x + offset, y + offset / 2);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await readAnchors(labels)).toEqual(anchors);
  }
  await page.mouse.up();
  await expect(graph).not.toHaveAttribute("data-camera", camera!);

  await page.getByRole("slider", { name: "History playhead" }).fill("0");
  await expect(labels).toHaveCount(0);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(labels).toHaveCount(3);
  await search.fill("unmatched-query");
  await expect(labels).toHaveCount(0);
  await search.fill("");
  await expect(labels).toHaveCount(0);
});

test("hover titles track the visible records at compact width", async ({ page }) => {
  await page.setViewportSize({ width: 681, height: 863 });
  await page.goto("/graph/prototype");
  const graph = page.getByTestId("prototype-3d");
  const node = graph.getByRole("button", { name: "decision: Launch the team plan", exact: true });
  const labels = graph.locator("button[data-node-id] > span:visible");
  await expect(node).toBeVisible();
  await expect(labels).toHaveCount(0);
  await node.hover();
  await expect(labels).toHaveText(["Launch the team plan"]);
  await page.getByRole("slider", { name: "History playhead" }).fill("0");
  await expect(node).toBeHidden();
  await expect(labels).toHaveCount(0);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(node).toBeVisible();
  await expect(labels).toHaveCount(0);
});
