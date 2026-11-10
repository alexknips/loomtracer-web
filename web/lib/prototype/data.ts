import type { RelatedScatterChartSpec } from "./related-analysis";
export type { RelatedScatterChartSpec } from "./related-analysis";
import type { EvidenceChartSpec, LinkedCountChartSpec } from "./graph-query";
export type { EvidenceChartSpec, LinkedCountChartSpec } from "./graph-query";

/** Fictional project records used exclusively by the interactive viewer prototype. */
export const PROJECT_NAME = "Atlas pricing rollout";
export const REPORT_PERIOD = "Q3 2026";
export const recordKinds = ["decision", "alternative", "evidence", "outcome", "entry", "connection", "external"] as const;
export type RecordKind = (typeof recordKinds)[number];

export type ViewerNode = {
  id: string;
  kind: RecordKind;
  title: string;
  summary: string;
  date: string;
  actor: string;
  approver?: string;
  approvalRationale?: string;
  typeLabel?: string;
  expressedBy?: string;
  basis?: "direct" | "inferred";
  labels?: string[];
  context?: string;
  sourceIds: string[];
  originSourceIds?: string[];
  sourceId?: string;
  position: [number, number, number];
};

export type ViewerEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  tree: boolean;
  connectionId?: string;
  relation?: string;
  fromRole?: string;
  toRole?: string;
  sourceIds?: string[];
  date: string;
  sourceId?: string;
};

export type ViewerSource = {
  id: string;
  title: string;
  excerpt: string;
  sourceRef?: string;
  date: string;
  author: string;
};

export type DecisionMetric = {
  nodeId: string;
  aiShare: number | null;
  revenue: number | null;
  aiRationale: string | null;
  aiSourceId: string | null;
  revenueSourceId: string | null;
};

export type MetricChartSpec = {
  type: "scatter" | "bar";
  title: string;
  x: string;
  y: string;
  decisionIds: string[];
};

export type ChartSpec =
  MetricChartSpec | EvidenceChartSpec | LinkedCountChartSpec | RelatedScatterChartSpec;

export type Snapshot = {
  cutoff: number;
  nodes: ViewerNode[];
  edges: ViewerEdge[];
  sources: ViewerSource[];
  metrics: DecisionMetric[];
};

export type ViewerEvent = { id: string; date: string; label: string; nodeId: string; stage?: string };

export type ViewerHistory = {
  events: ViewerEvent[];
  getSnapshot: (cutoff?: number) => Snapshot;
};

type Stage = "Discovery" | "Packaging" | "Pilot" | "Launch" | "Review";
type TreeParent = [id: string, relation: string];
type RecordEntry = {
  date: string;
  stage: Stage;
  source: Omit<ViewerSource, "date">;
  node?: Omit<ViewerNode, "date" | "sourceIds">;
  parent?: TreeParent;
  links?: TreeParent[];
  measures?: {
    key: "aiShare" | "revenue";
    values: Readonly<Record<string, number>>;
    rationale?: Readonly<Record<string, string>>;
  };
};

function source(id: string, title: string, author: string, excerpt: string): RecordEntry["source"] {
  return { id, title, author, excerpt };
}

function node(
  id: string,
  kind: ViewerNode["kind"],
  title: string,
  summary: string,
  actor: string,
  position: ViewerNode["position"],
  approver?: string,
): RecordEntry["node"] {
  return { id, kind, title, summary, actor, position, approver };
}

// Every element is one recorded event, including documents reported after a decision.
// Relations appear when their supporting record arrives. Coordinates remain stable while scrubbing.
const assessedInfluence: Readonly<Record<string, string>> = {
  "team-plan":
    "The assistant compared twelve bundles. Maya used interviews and support costs to select the five-seat offer.",
  "usage-meter":
    "The model simulated threshold costs and proposed the alert band. Noor chose the advance warning after customer feedback.",
  "annual-billing":
    "A model helped finance compare discount scenarios. Ezra set the terms after customers requested one invoice.",
  "pilot-cohort":
    "Recruitment and the cohort size came from the research team. AI assisted with organizing the participant list.",
  "seat-floor":
    "The assistant grouped seat-rule feedback. Pilot conversations led Maya to remove the minimum.",
  "rollout-gate":
    "A forecast informed the capacity discussion. Imani chose a slower launch based on support coverage.",
  "migration-credit":
    "Model estimates informed the credit size. Ezra chose a cap based on stalled customer migrations.",
};

const records: RecordEntry[] = [
  {
    date: "2026-06-02",
    stage: "Discovery",
    source: source(
      "pricing-brief",
      "Pricing review brief",
      "Maya Chen, product lead",
      "Atlas sells workflow software to studios. Small teams share one subscription and add seats in unpredictable bursts. Maya opened a review of a team plan, with a pilot before general release and a separate decision on existing accounts.",
    ),
    node: node(
      "pricing-review",
      "decision",
      "Open the pricing review",
      "Review how Atlas charges growing studios. Test simpler team pricing with a limited cohort before changing the public price sheet.",
      "Maya Chen",
      [0, 0, 0],
      "Maya Chen",
    ),
  },
  {
    date: "2026-06-04",
    stage: "Discovery",
    parent: ["pricing-review", "informed by"],
    source: source(
      "interviews",
      "Buyer interview notes",
      "Lena Ortiz, research",
      "Six of nine studio leads asked for a predictable monthly bill. Four said they postpone inviting freelancers because they cannot estimate the cost of a short project. The nine interviewees were existing Atlas customers.",
    ),
    node: node(
      "buyer-interviews",
      "evidence",
      "Studios want predictable bills",
      "Six of nine interviewed studio leads asked to know their bill before inviting collaborators.",
      "Lena Ortiz",
      [-65, 72, 66],
    ),
  },
  {
    date: "2026-06-05",
    stage: "Discovery",
    parent: ["pricing-review", "considered"],
    source: source(
      "flat-seat-memo",
      "Per-seat option memo",
      "Owen Bell, pricing analyst",
      "A flat $24 per active seat would preserve the existing billing model. The pricing group kept the proposal as a comparator. It scored poorly on predictable cost for studios bringing in temporary contractors.",
    ),
    node: node(
      "flat-seat",
      "alternative",
      "Keep flat per-seat billing",
      "Keep the familiar $24 seat price. Invitations for temporary collaborators would still cause unpredictable bills.",
      "Owen Bell",
      [-124, 98, -38],
    ),
  },
  {
    date: "2026-06-08",
    stage: "Packaging",
    parent: ["pricing-review", "led to"],
    links: [
      ["buyer-interviews", "cited by"],
      ["flat-seat", "passed over for"],
    ],
    source: source(
      "team-approval",
      "Team plan approval",
      "Maya Chen, product lead",
      "Approved a $99 monthly plan with five included seats and pooled usage. Interviews favored a stable starting price over a per-seat meter. The model compared twelve bundles; Maya chose the five-seat version after reviewing interviews and support costs.",
    ),
    node: node(
      "team-plan",
      "decision",
      "Launch the team plan",
      "Bundle five seats and pooled usage for $99 per month. The fixed starting bill answered studio leads’ strongest objection to inviting collaborators.",
      "Maya Chen and Atlas modeling assistant",
      [-87, 9, 22],
      "Maya Chen",
    ),
  },
  {
    date: "2026-06-09",
    stage: "Packaging",
    parent: ["team-plan", "considered"],
    source: source(
      "unlimited-option",
      "Unlimited usage scenario",
      "Atlas modeling assistant",
      "Unlimited usage removed the need for metering. The simulation predicted that high-volume render farms would absorb most compute capacity while paying the same fee as small studios. The team parked this version pending more usage data.",
    ),
    node: node(
      "unlimited-usage",
      "alternative",
      "Offer unlimited usage",
      "A single unlimited tier was easy to explain but exposed the team to unusually heavy compute usage.",
      "Atlas modeling assistant",
      [-174, -34, 82],
    ),
  },
  {
    date: "2026-06-11",
    stage: "Packaging",
    parent: ["team-plan", "informed by"],
    source: source(
      "usage-model",
      "Usage distribution study",
      "Noor Shah, data lead",
      "Across 48 consenting studio workspaces, the top decile consumed 3.2 times the median compute volume. The model reran three overage thresholds. Noor checked the billing inputs against a sample of invoices.",
    ),
    node: node(
      "usage-study",
      "evidence",
      "Usage concentrates in ten percent",
      "A sample of 48 workspaces exposed a long tail of compute demand and informed the metered allowance.",
      "Noor Shah",
      [-63, -74, 76],
    ),
  },
  {
    date: "2026-06-12",
    stage: "Packaging",
    parent: ["team-plan", "enabled"],
    links: [
      ["usage-study", "supports"],
      ["unlimited-usage", "passed over for"],
    ],
    source: source(
      "meter-review",
      "Meter design review",
      "Noor Shah, data lead",
      "Approve metering above the included allowance. The assistant simulated threshold costs and proposed the alert band. Noor chose advance alerts at eighty percent after customers said a surprise charge would undermine the plan.",
    ),
    node: node(
      "usage-meter",
      "decision",
      "Meter excess usage",
      "Include normal usage in the base plan, warn teams at 80% of their allowance, then meter the excess. This protects margins while giving buyers notice.",
      "Noor Shah and Atlas modeling assistant",
      [-148, -81, 7],
      "Noor Shah",
    ),
  },
  {
    date: "2026-06-15",
    stage: "Packaging",
    parent: ["pricing-review", "led to"],
    source: source(
      "annual-approval",
      "Annual terms approval",
      "Ezra Park, finance lead",
      "Offer an annual option with a 15% discount. Three pilot customers had requested a single invoice for budget approval. Finance set the discount by comparing one year of retained margin with the working-capital benefit of prepayment.",
    ),
    node: node(
      "annual-billing",
      "decision",
      "Offer annual billing",
      "Give buyers a 15% discount for annual prepayment. Finance selected the discount after modeling retained margin and reviewing three customer requests.",
      "Ezra Park",
      [102, 41, -22],
      "Ezra Park",
    ),
  },
  {
    date: "2026-06-16",
    stage: "Packaging",
    parent: ["annual-billing", "considered"],
    source: source(
      "deep-discount",
      "Discount sensitivity note",
      "Ezra Park, finance lead",
      "At 25%, the annual discount would have reduced expected first-year margin below the pilot threshold. Finance retained the scenario in the worksheet and signed off on the 15% option.",
    ),
    node: node(
      "annual-25",
      "alternative",
      "Discount annual plans by 25%",
      "A deeper annual discount made the offer easier to sell but brought expected margin below the pilot threshold.",
      "Ezra Park",
      [169, 98, -62],
    ),
  },
  {
    date: "2026-06-19",
    stage: "Pilot",
    parent: ["team-plan", "tested through"],
    source: source(
      "pilot-roster",
      "Pilot enrollment record",
      "Lena Ortiz, research",
      "Invite twelve studios across three sizes, including four with frequent freelancers. The team chose a smaller handpicked group so each invoice dispute could be investigated before a wider rollout.",
    ),
    node: node(
      "pilot-cohort",
      "decision",
      "Pilot with twelve studios",
      "Recruit a mix of studio sizes, including teams with frequent freelancers. Limit the pilot to twelve to make individual invoice reviews practical.",
      "Lena Ortiz",
      [-67, 84, -52],
      "Maya Chen",
    ),
  },
  {
    date: "2026-06-25",
    stage: "Pilot",
    parent: ["pilot-cohort", "observed"],
    source: source(
      "pilot-interviews",
      "Pilot week-one debrief",
      "Lena Ortiz, research",
      "Four of twelve studios asked whether unused seats carried forward. Support found that a two-seat minimum would make the offer harder to explain to very small teams.",
    ),
    node: node(
      "seat-feedback",
      "evidence",
      "Pilot teams question seat rules",
      "The pilot surfaced questions about empty seats and minimum commitments, especially among part-time studios.",
      "Lena Ortiz",
      [-126, 135, -104],
    ),
  },
  {
    date: "2026-06-29",
    stage: "Pilot",
    parent: ["pilot-cohort", "led to"],
    links: [["seat-feedback", "supports"]],
    source: source(
      "seat-minimum",
      "Minimum-seat decision",
      "Maya Chen, product lead",
      "Remove the proposed two-seat minimum from the sign-up terms. The five seats in the bundle remain available to every team, including accounts starting with one active member. Maya approved the change after the pilot debrief.",
    ),
    node: node(
      "seat-floor",
      "decision",
      "Remove the seat minimum",
      "Let a studio start with one active member and invite colleagues later. This resolves a recurring source of confusion in the pilot.",
      "Maya Chen",
      [-31, 138, -14],
      "Maya Chen",
    ),
  },
  {
    date: "2026-07-02",
    stage: "Launch",
    parent: ["pricing-review", "led to"],
    links: [["pilot-cohort", "informed"]],
    source: source(
      "rollout-review",
      "Staged rollout sign-off",
      "Imani Cole, operations lead",
      "Release to ten percent of eligible accounts, then expand after two billing cycles with invoice disputes under two percent. A forecast suggested faster expansion, but Imani chose the slower cadence so support could investigate disputed invoices.",
    ),
    node: node(
      "rollout-gate",
      "decision",
      "Stage the public rollout",
      "Start with 10% of eligible accounts and widen after two billing cycles below the dispute threshold. Support capacity set the pace.",
      "Imani Cole",
      [54, -76, -40],
      "Imani Cole",
    ),
  },
  {
    date: "2026-07-06",
    stage: "Launch",
    parent: ["rollout-gate", "considered"],
    source: source(
      "instant-launch",
      "Full-release checklist",
      "Imani Cole, operations lead",
      "A same-day launch would reach all eligible teams at once. Support could handle the expected total volume, but a billing defect would leave no comparison cohort. Operations set this option aside.",
    ),
    node: node(
      "full-release",
      "alternative",
      "Release to all teams at once",
      "A full launch would reach buyers sooner. It would also make a billing defect harder to isolate.",
      "Imani Cole",
      [99, -123, -122],
    ),
  },
  {
    date: "2026-07-08",
    stage: "Launch",
    parent: ["rollout-gate", "enabled"],
    source: source(
      "migration-policy",
      "Migration credit policy",
      "Ezra Park, finance lead",
      "Approve one $30 invoice credit for eligible legacy studios that switch during July. Support repeatedly saw migration stall at the first new invoice. Finance approved a fixed cap and a dedicated switcher cohort.",
    ),
    node: node(
      "migration-credit",
      "decision",
      "Credit migrating studios",
      "Offer a capped $30 first-invoice credit to eligible legacy customers. Finance selected a fixed amount so the team could track take-up and cost.",
      "Ezra Park",
      [114, -54, 47],
      "Ezra Park",
    ),
  },
  {
    date: "2026-07-17",
    stage: "Launch",
    parent: ["team-plan", "observed"],
    links: [["pilot-cohort", "observed through"]],
    source: source(
      "conversion-report",
      "Pilot conversion report",
      "Lena Ortiz, research",
      "Eight of twelve studios converted to paid team plans within thirty days. Three retained customers cited predictable bills in follow-up calls. The small invited cohort limits generalization to the wider customer base.",
    ),
    node: node(
      "pilot-conversion",
      "outcome",
      "Eight pilot studios convert",
      "Eight of twelve invited studios became paying teams within thirty days of enrollment.",
      "Lena Ortiz",
      [-149, 31, 121],
    ),
  },
  {
    date: "2026-08-14",
    stage: "Launch",
    parent: ["annual-billing", "observed"],
    source: source(
      "annual-intake",
      "August annual intake",
      "Ezra Park, finance lead",
      "Twelve teams prepaid for a year in the first six weeks. Five said the single invoice made procurement easier. These are observed uptake figures; the quarter-end allocation report handles dollar attribution separately.",
    ),
    node: node(
      "annual-uptake",
      "outcome",
      "Twelve teams prepay",
      "Twelve teams selected annual billing during the first six weeks. Five cited easier procurement.",
      "Ezra Park",
      [164, 24, 65],
    ),
  },
  {
    date: "2026-09-10",
    stage: "Review",
    parent: ["rollout-gate", "observed"],
    source: source(
      "invoice-audit",
      "Rollout invoice audit",
      "Imani Cole, operations lead",
      "The two completed billing cycles saw dispute rates of 1.3% and 1.1%. Operations approved expansion beyond the initial release cohort and opened a separate review for customers with unusual compute usage.",
    ),
    node: node(
      "invoice-disputes",
      "outcome",
      "Invoice disputes stay below 2%",
      "Dispute rates of 1.3% and 1.1% met the operations team's expansion threshold.",
      "Imani Cole",
      [43, -148, 53],
    ),
  },
  {
    date: "2026-09-21",
    stage: "Review",
    source: source(
      "influence-review",
      "Decision influence assessment",
      "Lena Ortiz, research",
      "The review panel allocated 100 influence points per assessed decision between AI analysis and human research or judgment. AI shares: team plan 45%; usage meter 85%; annual billing 25%; pilot cohort 10%; seat minimum 20%; rollout gate 35%; migration credit 55%. Approval remained with the people named in each decision. The opening review had no assessment. " +
        Object.values(assessedInfluence).join(" "),
    ),
    measures: {
      key: "aiShare",
      rationale: assessedInfluence,
      values: {
        "team-plan": 45,
        "usage-meter": 85,
        "annual-billing": 25,
        "pilot-cohort": 10,
        "seat-floor": 20,
        "rollout-gate": 35,
        "migration-credit": 55,
      },
    },
  },
  {
    date: "2026-10-05",
    stage: "Review",
    source: source(
      "q3-attribution",
      "Q3 revenue attribution report",
      "Ezra Park, finance lead",
      "Finance allocated all $212,000 of Q3 2026 net invoice revenue using one primary reason code per invoice line. Team plan $84,000; excess usage $48,000; annual billing $62,000; seat minimum $0; migration credit $18,000. Zero is a measured result. The pilot cohort and rollout gate had no allocated amounts. Annual billing uses revenue recognized within Q3. Observed allocations do not establish counterfactual lift.",
    ),
    measures: {
      key: "revenue",
      values: {
        "team-plan": 84000,
        "usage-meter": 48000,
        "annual-billing": 62000,
        "seat-floor": 0,
        "migration-credit": 18000,
      },
    },
  },
];

export const events = records.map(({ source: record, date, stage, node: item, measures }) => ({
  id: record.id,
  date,
  label: item?.title ?? record.title,
  stage,
  nodeId: item?.id ?? Object.keys(measures?.values ?? {})[0] ?? "",
}));

export function getSnapshot(requested = records.length - 1): Snapshot {
  const cutoff = Math.max(
    0,
    Math.min(
      records.length - 1,
      Number.isFinite(requested) ? Math.trunc(requested) : records.length - 1,
    ),
  );
  const nodes: ViewerNode[] = [];
  const edges: ViewerEdge[] = [];
  const sources: ViewerSource[] = [];
  const metricsById = new Map<string, DecisionMetric>();
  for (const record of records.slice(0, cutoff + 1)) {
    sources.push({ ...record.source, date: record.date });
    const item = record.node;
    if (item) {
      nodes.push({
        ...item,
        position: [...item.position],
        date: record.date,
        sourceIds: [record.source.id],
        sourceId: record.source.id,
      });
      if (item.kind === "decision") {
        metricsById.set(item.id, {
          nodeId: item.id,
          aiShare: null,
          revenue: null,
          aiRationale: null,
          aiSourceId: null,
          revenueSourceId: null,
        });
      }
      if (record.parent) {
        const [from, label] = record.parent;
        edges.push({
          id: from + "." + item.id,
          from,
          to: item.id,
          label,
          tree: true,
          date: record.date,
          sourceId: record.source.id,
        });
      }
      for (const [from, label] of record.links ?? []) {
        edges.push({
          id: from + "." + item.id,
          from,
          to: item.id,
          label,
          tree: false,
          date: record.date,
          sourceId: record.source.id,
        });
      }
    }
    if (record.measures) {
      const { key, values } = record.measures;
      for (const [id, value] of Object.entries(values)) {
        const metric = metricsById.get(id)!;
        metric[key] = value;
        if (key === "aiShare") metric.aiRationale = record.measures.rationale?.[id] ?? null;
        metric[key === "aiShare" ? "aiSourceId" : "revenueSourceId"] = record.source.id;
        nodes.find((entry) => entry.id === id)!.sourceIds.push(record.source.id);
      }
    }
  }
  return { cutoff, nodes, edges, sources, metrics: [...metricsById.values()] };
}
