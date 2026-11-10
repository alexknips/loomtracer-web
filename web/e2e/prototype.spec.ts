import { expect, test, type Page } from "@playwright/test";
import { events, getSnapshot } from "../lib/prototype/data";

const route = "/graph/prototype";
const latest = events.length - 1;
const final = getSnapshot();
const teamIndex = events.findIndex((event) => event.nodeId === "team-plan");
const assessmentIndex = events.findIndex((event) => event.id === "influence-review");
const chartTitle = "AI influence and Q3 revenue";
const chart = { type: "scatter", title: chartTitle, x: "aiShare", y: "revenue", decisionIds: [] };

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

async function saveView(page: Page, name: string) {
  await page.getByRole("button", { name: "Save view", exact: true }).click();
  await page.getByLabel("Name this view").fill(name);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("scrubs a selected record in 3D before pointer release and preserves its camera and saved view", async ({
  page,
}) => {
  await page.goto(route);
  const scene = page.getByTestId("prototype-3d");
  const playhead = page.getByRole("slider", { name: "History playhead" });
  const detail = page.getByTestId("record-detail");
  await expect(scene).toHaveAttribute("data-visible-nodes", String(final.nodes.length));
  await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
  const camera = await scene.getAttribute("data-camera");
  expect(camera).toBeTruthy();
  await scene.locator("canvas").press("ArrowRight");
  await expect(scene).not.toHaveAttribute("data-camera", camera!);
  const rotated = await scene.getAttribute("data-camera");
  const team = scene.getByRole("button", { name: "decision: Launch the team plan" });
  await team.press("Enter");
  await expect(detail).toContainText("Launch the team plan");
  const box = await playhead.boundingBox();
  expect(box).toBeTruthy();
  const y = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width - 7, y);
  await page.mouse.down();
  await page.mouse.move(box!.x + 1, y, { steps: 8 });
  await expect(playhead).toHaveValue("0");
  await expect(scene).toHaveAttribute("data-visible-nodes", "1");
  await expect(scene).toHaveAttribute("data-visible-edges", "0");
  await expect(team).toBeHidden();
  await expect(detail).toHaveCount(0);
  await expect(scene).toHaveAttribute("data-camera", rotated!);
  await page.mouse.move(box!.x + box!.width - 1, y, { steps: 8 });
  await expect(playhead).toHaveValue(String(latest));
  await expect(detail).toContainText("Launch the team plan");
  await page.mouse.up();
  await expect(scene).toHaveAttribute("data-visible-edges", String(final.edges.length));
  await expect(scene).toHaveAttribute("data-camera", rotated!);

  await playhead.fill(String(teamIndex));
  await saveView(page, "Team launch review");
  await page.reload();
  await expect(playhead).toHaveValue(String(latest));
  await page.getByRole("button", { name: "Team launch review", exact: true }).click();
  await expect(playhead).toHaveValue(String(teamIndex));
  await expect(detail).toContainText("Launch the team plan");
  await expect(scene).toHaveAttribute("data-camera", rotated!);
});

test("keyboard search reveals a folded branch, focuses the decision, and enables minimap navigation", async ({
  page,
}) => {
  await page.goto(route);
  await page.getByRole("button", { name: "Tree view", exact: true }).click();
  const tree = page.getByTestId("prototype-tree");
  const mini = tree.locator(".react-flow__minimap");
  await expect(tree).toHaveAttribute("data-visible-nodes", String(final.nodes.length));
  await expect(mini).toBeVisible();
  const connectors = tree.locator(".react-flow__edge-path");
  await expect(connectors).toHaveCount(final.edges.length);
  expect(
    await connectors.evaluateAll((paths) =>
      paths.every((path) => path.getAttribute("d")?.includes("C") && path.hasAttribute("marker-end")),
    ),
  ).toBe(true);
  const toggle = tree.getByLabel("Collapse Launch the team plan");
  await toggle.press("Enter");
  await expect(tree.getByRole("button", { name: "decision: Meter excess usage" })).toHaveCount(0);
  const search = page.getByRole("searchbox", { name: "Search decisions" });
  await search.fill("Meter excess usage");
  await search.press("Enter");
  await expect(page.getByTestId("record-detail")).toContainText("Meter excess usage");
  await expect(tree.getByRole("button", { name: "decision: Meter excess usage" })).toBeVisible();
  await expect
    .poll(async () => Number(JSON.parse((await tree.getAttribute("data-camera")) ?? "{}").zoom))
    .toBe(1);
  await page.getByRole("button", { name: "Close record details" }).click();
  const before = await tree.getAttribute("data-camera");
  const bounds = await mini.boundingBox();
  expect(bounds).toBeTruthy();
  const centerX = bounds!.x + bounds!.width / 2;
  const centerY = bounds!.y + bounds!.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX + 30, centerY + 12, { steps: 5 });
  await page.mouse.up();
  await expect(tree).not.toHaveAttribute("data-camera", before!);
  const position = await tree.getAttribute("data-camera");
  await page.getByRole("slider", { name: "History playhead" }).fill("0");
  await expect(tree).toHaveAttribute("data-visible-nodes", "1");
  await expect(tree).toHaveAttribute("data-camera", position!);
  await search.fill("Meter excess usage");
  await expect(page.getByText("No matching records at this point.")).toBeVisible();
});

test("plots reports with source inspection, measured zero and missing values, and restores a saved chart", async ({
  page,
}) => {
  let requestedCutoff: number | undefined;
  await page.route("**/api/prototype/chat", async (request) => {
    requestedCutoff = request.request().postDataJSON().cutoff;
    await request.fulfill({
      json: {
        answer: "Five decisions have both measurements.",
        citations: ["influence-review", "q3-attribution"],
        chart,
      },
    });
  });
  await page.goto(route);
  await page.getByRole("button", { name: "Plot AI influence against attributed revenue." }).click();
  const plot = page.getByRole("region", { name: chartTitle });
  await expect(plot).toContainText("5 of 8 decisions plotted");
  expect(requestedCutoff).toBe(latest);
  await expect(plot).toContainText("3 decisions lack a reported value");
  const zero = plot.getByRole("button", {
    name: /Remove the seat minimum, Assessed AI influence 20%.*\$0/,
  });
  await zero.press("Enter");
  await expect(page.getByTestId("record-detail")).toContainText("$0");
  await page.getByRole("button", { name: "Close record details" }).click();
  await plot.getByRole("button", { name: "Q3 revenue attribution report" }).click();
  await expect(plot).toContainText("one primary reason code per invoice line");
  await saveView(page, "Quarter close");
  const playhead = page.getByRole("slider", { name: "History playhead" });
  await playhead.fill(String(assessmentIndex));
  await expect(plot).toContainText("0 of 8 decisions plotted");
  await expect(plot.getByText("one primary reason code per invoice line", { exact: false })).toHaveCount(
    0,
  );
  await expect(plot.getByRole("button", { name: "Q3 revenue attribution report" })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Quarter close", exact: true }).click();
  await expect(plot).toContainText("5 of 8 decisions plotted");
  await expect(playhead).toHaveValue(String(latest));
});

test.describe("touchscreen and unavailable WebGL", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("keeps the decision tree, timeline and chat drawer usable on a phone", async ({ page }) => {
    // Exercise the supported fallback by withholding WebGL contexts on this page only.
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        value(this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
          if (kind.includes("webgl")) return null;
          return Reflect.apply(getContext, this, [kind, ...args]);
        },
      });
    });
    await page.goto(route);
    await expect(page.getByTestId("prototype-tree")).toBeVisible();
    await expect(page.getByText("3D unavailable on this device")).toBeVisible();
    const playhead = page.getByRole("slider", { name: "History playhead" });
    await playhead.scrollIntoViewIfNeeded();
    const box = await playhead.boundingBox();
    expect(box).toBeTruthy();
    await page.touchscreen.tap(box!.x + 2, box!.y + box!.height / 2);
    await expect(playhead).toHaveValue("0");
    await expect(page.getByTestId("prototype-tree")).toHaveAttribute("data-visible-nodes", "1");
    await page.getByRole("button", { name: "Graph assistant", exact: true }).tap();
    const assistant = page.getByRole("complementary", { name: "Graph assistant" });
    await expect(assistant).toBeVisible();
    await expect(assistant).toContainText("Context at Jun 2, 2026");
    await assistant.getByRole("button", { name: "Close chat" }).tap();
    await expect(assistant).toBeHidden();
  });
});

test("evidence counts agree in chat and chart during scrubbing, with decision drilldowns and saved queries", async ({
  page,
}) => {
  const query = { kind: "evidenceUse", evidenceIds: [], roles: [] };
  const evidenceChart = { type: "evidence", title: "Evidence use", query };
  let calls = 0;
  await page.route("**/api/prototype/chat", async (route) => {
    ++calls;
    expect(route.request().postDataJSON().cutoff).toBe(latest);
    await route.fulfill({
      json: {
        answer: "Evidence use at the playhead.",
        citations: ["usage-study"],
        chart: evidenceChart,
        query,
      },
    });
  });
  await page.goto(route);
  await page
    .getByRole("button", {
      name: "Plot how often evidence is cited, supports a decision, or contradicts one.",
    })
    .click();
  const chartSurface = page.getByTestId("evidence-use-chart");
  const chatCounts = page.getByRole("region", { name: "Evidence counts at the playhead" });
  const support = chartSurface.getByTestId("evidence-group-usage-study-supports");
  const chatSupport = (count: number) =>
    chatCounts.getByRole("button", {
      name: `Usage concentrates in ten percent, Explicit support: ${count}`,
      exact: true,
    });
  await expect(support).toHaveAccessibleName(/1 distinct decision/);
  await chatSupport(1).click();
  const decisions = chartSurface.getByTestId("evidence-drilldown");
  await expect(decisions).toContainText("Meter excess usage");
  await decisions.getByRole("button", { name: "Meter excess usage", exact: true }).click();
  await expect(page.getByTestId("record-detail")).toContainText("Meter excess usage");
  await page.getByRole("button", { name: "Close record details" }).click();
  const playhead = page.getByRole("slider", { name: "History playhead" });
  const beforeMeter = events.findIndex((e) => e.nodeId === "usage-meter") - 1;
  await playhead.fill(String(beforeMeter));
  await expect(support).toHaveAccessibleName(/0 distinct decisions/);
  await expect(chatSupport(0)).toBeVisible();
  await expect(decisions).not.toContainText("Meter excess usage");
  await saveView(page, "Evidence before metering");
  await playhead.fill("0");
  await expect(support).toHaveCount(0);
  await expect(chatCounts).toContainText("No matching evidence records");
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(support).toHaveAccessibleName(/1 distinct decision/);
  await expect(chatSupport(1)).toBeVisible();
  expect(calls).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Evidence before metering", exact: true }).click();
  await expect(playhead).toHaveValue(String(beforeMeter));
  await expect(support).toHaveAccessibleName(/0 distinct decisions/);
});

test("a delayed text-only query opens its clicked count at the current playhead", async ({ page }) => {
  const question = "How often does each evidence record inform a decision?";
  const query = { kind: "evidenceUse", evidenceIds: [], roles: ["informs"] };
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/prototype/chat", async (route) => {
    await ready;
    await route.fulfill({
      json: { answer: "Latest snapshot", citations: ["team-approval"], chart: null, query },
    });
  });
  await page.goto(route);
  await page.getByPlaceholder("Ask about this graph…").fill(question);
  await page.getByRole("button", { name: "Send question", exact: true }).click();
  const playhead = page.getByRole("slider", { name: "History playhead" });
  const interviews = events.findIndex((e) => e.nodeId === "buyer-interviews");
  await playhead.fill(String(interviews));
  release();
  const counts = page.getByRole("region", { name: "Evidence counts at the playhead" });
  await expect(counts).toContainText("Studios want predictable bills");
  await expect(counts).not.toContainText("Usage concentrates in ten percent");
  await expect(page.getByTestId("evidence-use-chart")).toHaveCount(0);
  await counts
    .getByRole("button", { name: "Studios want predictable bills, used by 1 decision", exact: true })
    .click();
  await expect(playhead).toHaveValue(String(interviews));
  const drill = page.getByTestId("evidence-drilldown");
  await expect(
    drill.getByRole("button", { name: "Open the pricing review", exact: true }),
  ).toBeVisible();
  await expect(drill.getByRole("button", { name: "Launch the team plan", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(drill.getByRole("button", { name: "Launch the team plan", exact: true })).toBeVisible();
  await expect(
    counts.getByRole("button", {
      name: "Studios want predictable bills, used by 2 decisions",
      exact: true,
    }),
  ).toBeVisible();
});

test("recorded outcomes per decision share counts, drilldown and saved timeline scope", async ({
  page,
}) => {
  const prompt = "Plot how many recorded outcomes are linked to each decision.";
  const query = { kind: "linkedCount", rowKind: "decision", linkedKind: "outcome", rowIds: [] };
  const chart = { type: "linkedCount", title: "Recorded outcomes per decision", query };
  let calls = 0;
  await page.route("**/api/prototype/chat", async (route) => {
    expect(route.request().postDataJSON().question).toBe(prompt);
    calls += 1;
    await route.fulfill({
      json: { answer: "Counts computed from visible outcomes.", citations: [], query, chart },
    });
  });
  await page.goto("/graph/prototype");
  await page.getByRole("button", { name: prompt, exact: true }).click();
  const plot = page.getByRole("region", { name: chart.title });
  const chat = page.getByRole("region", { name: "Linked counts at the playhead" });
  const counter = (count: number) =>
    "Launch the team plan: " + count + " linked " + (count === 1 ? "outcome" : "outcomes");
  await expect(plot.getByRole("button", { name: counter(1), exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: "Color key" })).toHaveText("Outcome");
  await chat.getByRole("button", { name: counter(1), exact: true }).click();
  const drill = plot.getByRole("region", { name: "Records behind this count" });
  await expect(
    drill.getByRole("button", { name: "Eight pilot studios convert", exact: true }),
  ).toBeVisible();
  await drill.getByRole("button", { name: "Pilot conversion report", exact: true }).click();
  await expect(page.getByTestId("record-detail")).toContainText("Eight of twelve studios");
  await page.getByRole("button", { name: "Close record details" }).click();
  const playhead = page.getByRole("slider", { name: "History playhead" });
  await playhead.fill(String(events.findIndex((e) => e.nodeId === "pilot-conversion") - 1));
  await expect(plot.getByRole("button", { name: counter(0), exact: true })).toBeVisible();
  await expect(chat.getByRole("button", { name: counter(0), exact: true })).toBeVisible();
  await expect(drill).toContainText("No matching relationships");
  await saveView(page, "Outcomes before conversion");
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(
    drill.getByRole("button", { name: "Eight pilot studios convert", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Outcomes before conversion", exact: true }).click();
  await expect(plot.getByRole("button", { name: counter(0), exact: true })).toBeVisible();
});

test("compares measures across the same related decisions, retaining partial rows and zeroes on scrub", async ({
  page,
}) => {
  const question =
    "Plot how many decisions used each piece of evidence against the total revenue attributed to those decisions.";
  const query = {
    kind: "relatedAnalysis",
    source: { kind: "evidenceUse", evidenceIds: [], roles: [] },
    x: { operation: "countDistinct", field: "recordId" },
    y: { operation: "sum", field: "revenue" },
  };
  let calls = 0;
  await page.route("**/api/prototype/chat", async (route) => {
    expect(route.request().postDataJSON().question).toBe(question);
    ++calls;
    await route.fulfill({
      json: {
        answer: "Values at this cutoff.",
        citations: [],
        query,
        chart: { type: "relatedScatter", title: "Decision count and revenue", query },
      },
    });
  });
  await page.goto("/graph/prototype");
  await page.getByPlaceholder("Ask about this graph…").fill(question);
  await page.getByRole("button", { name: "Send question", exact: true }).click();
  const surface = page.getByTestId("related-scatter");
  const chat = page.getByRole("region", { name: "Comparison at the playhead" });
  const partial = surface.getByTestId("unplotted-buyer-interviews");
  await expect(surface.locator("[data-point]")).toHaveCount(2);
  await expect(surface.locator('[data-point="usage-study"]')).toHaveAccessibleName(/132,000/);
  await expect(surface.locator('[data-point="seat-feedback"]')).toHaveAccessibleName(/\$0/);
  await expect(partial).toBeVisible();
  await expect(surface.locator('[data-point="buyer-interviews"]')).toHaveCount(0);
  await expect(
    chat.getByRole("button", { name: "Inspect Studios want predictable bills" }),
  ).toContainText("$84,000 known subtotal");
  await expect(page.getByRole("group", { name: "Color key" })).toHaveText("Evidence");
  await chat.getByRole("button", { name: "Inspect Studios want predictable bills" }).click();
  const members = surface.getByRole("region", { name: "Records behind this point" });
  await expect(members).toContainText("Open the pricing review");
  await expect(members).toContainText("Launch the team plan");
  await members
    .getByRole("button", { name: "Q3 revenue attribution report", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("record-detail")).toContainText("one primary reason code");
  await page.getByRole("button", { name: "Close record details" }).click();
  await page.getByRole("button", { name: "Close group breakdown" }).click();
  await saveView(page, "Evidence comparison");
  const playhead = page.getByRole("slider", { name: "History playhead" });
  await playhead.fill(String(latest - 1));
  await expect(surface.locator("[data-point]")).toHaveCount(0);
  await expect(chat).not.toContainText("$84,000");
  await expect(chat).toContainText("Unreported");
  await page.getByRole("button", { name: "Latest", exact: true }).click();
  await expect(surface.locator("[data-point]")).toHaveCount(2);
  expect(calls).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Evidence comparison", exact: true }).click();
  await expect(surface.locator("[data-point]")).toHaveCount(2);
  await expect(partial).toBeVisible();
});
