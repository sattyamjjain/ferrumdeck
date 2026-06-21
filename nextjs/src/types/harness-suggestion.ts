// Eval-driven harness/policy suggestions (HarnessX trace->delta loop).
// ===========================================================================
// Mirrors `fd_policy::harness` (Rust) and `fd_evals.harness_delta` (Python).
// A suggestion is a PROPOSAL only: deny-by-default + human-in-the-loop are
// preserved — approving records the decision in the audit trail and never
// auto-applies a change to a live policy, allowlist, or budget.

/** What kind of harness adjustment a suggestion proposes. */
export type SuggestionKind = "tool_scope" | "budget" | "policy";

/** Lifecycle status, folded from the append-only audit chain. */
export type SuggestionStatus = "proposed" | "approved" | "rejected";

/** One piece of trace-derived evidence behind a suggestion. */
export interface SuggestionEvidence {
  code: string;
  detail: string;
  observed?: number | null;
}

/** A proposed harness/policy change projected from the audit trail. */
export interface HarnessSuggestion {
  id: string;
  agent_id: string;
  source_eval_run_id?: string | null;
  kind: SuggestionKind;
  current: unknown;
  proposed: unknown;
  reason: string;
  evidence: SuggestionEvidence[];
  confidence: number;
  status: SuggestionStatus;
  content_hash: string;
  created_at: string;
  anchor: string;
}

/** Response shape for `GET /v1/harness-suggestions/agent/:agentId`. */
export interface HarnessSuggestionsResponse {
  agent_id: string;
  suggestions: HarnessSuggestion[];
  anchor: string;
}
