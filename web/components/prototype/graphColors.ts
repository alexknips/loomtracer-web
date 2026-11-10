import type { ViewerNode } from "@/lib/prototype/data";
import type { EvidenceRole } from "@/lib/prototype/graph-query";

export const recordColors: Record<ViewerNode["kind"], string> = {
  decision: "#1D90CD",
  alternative: "#F3BA1E",
  evidence: "#332B32",
  outcome: "#E25432",
  entry: "#332B32",
  connection: "#1D90CD",
  external: "#FDF8F4",
};
export const evidenceRoleColors: Record<EvidenceRole, string> = {
  supports: recordColors.decision,
  contradicts: recordColors.outcome,
  informs: recordColors.evidence,
  observes: recordColors.alternative,
};
