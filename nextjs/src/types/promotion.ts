// Champion-challenger promotion gate.
// ===========================================================================
// Mirrors `fd_policy::promotion` (Rust) and `fd_evals.promotion` (Python).
// A challenger version stays in `shadow` until it clears the gate (configurable
// metric thresholds + a required human approval); the decision + evidence are
// written to the immutable audit trail.

/** Policy-decision kind, snake_case — mirrors `fd_policy::PolicyDecisionKind`. */
export type PromotionDecisionKind =
  | "allow"
  | "deny"
  | "requires_approval"
  | "allow_with_warning";

/** Lifecycle status of a challenger relative to its champion. */
export type PromotionStatus =
  | "shadow"
  | "promoted"
  | "denied"
  | "awaiting_approval";

/** Per-metric outcome recorded as evidence on a decision. */
export interface MetricEvidence {
  name: string;
  min_value: number;
  measured_value?: number | null;
  passed: boolean;
}

/** A single promotion-gate decision projected from an audit row. */
export interface PromotionDecision {
  id: string;
  agent_id: string;
  champion_version_id?: string | null;
  challenger_version_id: string;
  decision_kind: PromotionDecisionKind;
  status: PromotionStatus;
  reason: string;
  metric_evidence: MetricEvidence[];
  approval_present: boolean;
  approval_required: boolean;
  content_hash: string;
  decided_at: string;
  anchor: string;
}

/** Promotion history for an agent (newest-first). */
export interface PromotionHistoryResponse {
  agent_id: string;
  decisions: PromotionDecision[];
  anchor: string;
}
