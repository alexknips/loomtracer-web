import type { Snapshot } from "./data";
import {
  evidenceCitations,
  formatEvidenceAnswer,
  formatLinkedCountAnswer,
  linkedCountCitations,
  runEvidenceQuery,
  runLinkedCountQuery,
  type GraphQuery,
} from "./graph-query";
import { formatRelatedAnswer, relatedCitations, runRelatedAnalysis } from "./related-analysis";

export type AnalysisQuery = GraphQuery;

/** Resolve an analysis at the caller's cutoff for both live replies and chat history. */
export function summarizeAnalysisAt(snapshot: Snapshot, query: AnalysisQuery) {
  switch (query.kind) {
    case "evidenceUse": {
      const rows = runEvidenceQuery(snapshot, query);
      return { answer: formatEvidenceAnswer(rows, query), citations: evidenceCitations(rows) };
    }
    case "linkedCount": {
      const rows = runLinkedCountQuery(snapshot, query);
      return { answer: formatLinkedCountAnswer(rows, query), citations: linkedCountCitations(rows) };
    }
    case "relatedAnalysis": {
      const rows = runRelatedAnalysis(snapshot, query);
      return { answer: formatRelatedAnswer(rows, query), citations: relatedCitations(rows) };
    }
  }
}

export function formatAnalysisAt(snapshot: Snapshot, query: AnalysisQuery): string {
  return summarizeAnalysisAt(snapshot, query).answer;
}
