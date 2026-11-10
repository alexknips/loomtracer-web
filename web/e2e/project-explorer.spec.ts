import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test("the prototype opens a connected ledger project and keeps its saved views project-scoped", async ({ page }) => {
  await page.goto("/graph/prototype?project=pricing");
  const scene = page.getByTestId("prototype-3d");
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pricing study", exact: true })).toBeVisible();
  await expect(scene.getByRole("button", { name: /Price per seat/ })).toBeVisible();
  const modes = page.getByRole("navigation", { name: "Viewer modes" });
  await modes.getByRole("button", { name: "Tree view" }).click();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  const playhead = page.getByRole("slider", { name: "History playhead" });
  await playhead.press("ArrowLeft");
  const cutoff = await playhead.inputValue();
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("Name this view").fill("Earlier pricing tree");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const bookmark = modes.getByRole("button", { name: "Earlier pricing tree" });
  await expect(bookmark).toBeVisible();

  await page.getByLabel("Reasoning project").selectOption("pricing-experiments");
  await expect(page).toHaveURL(/\/graph\/prototype\?project=pricing-experiments$/);
  await expect(scene.locator("canvas")).toBeVisible();
  await expect(bookmark).toHaveCount(0);
  await page.goBack();
  await bookmark.click();
  await expect(playhead).toHaveValue(cutoff);
  await page.reload();
  await bookmark.click();
  await expect(page.locator(".react-flow__minimap")).toBeVisible();
  await expect(playhead).toHaveValue(cutoff);
  await page.getByText("History", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Open history inspector" })).toHaveAttribute("href", "/graph?project=pricing");
});

test("an unknown project stays empty until a valid project is selected", async ({ page }) => {
  await page.goto("/graph/prototype?project=not-in-the-ledger");
  await expect(page.getByRole("status")).toHaveText("Choose an available project in the header.");
  await expect(page.getByTestId("prototype-3d")).toHaveCount(0);
  await page.getByLabel("Reasoning project").selectOption("pricing");
  await expect(page.getByTestId("prototype-3d").locator("canvas")).toBeVisible();
});
