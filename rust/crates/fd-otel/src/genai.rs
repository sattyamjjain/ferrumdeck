//! GenAI semantic conventions for OpenTelemetry
//!
//! Based on the OpenTelemetry GenAI semantic conventions.
//! https://opentelemetry.io/docs/specs/semconv/gen-ai/

/// Attribute keys for GenAI spans
pub mod attrs {
    // System attributes
    pub const GEN_AI_SYSTEM: &str = "gen_ai.system";
    pub const GEN_AI_REQUEST_MODEL: &str = "gen_ai.request.model";
    pub const GEN_AI_RESPONSE_MODEL: &str = "gen_ai.response.model";

    // Token usage
    pub const GEN_AI_USAGE_INPUT_TOKENS: &str = "gen_ai.usage.input_tokens";
    pub const GEN_AI_USAGE_OUTPUT_TOKENS: &str = "gen_ai.usage.output_tokens";
    pub const GEN_AI_USAGE_TOTAL_TOKENS: &str = "gen_ai.usage.total_tokens";

    // Request parameters
    pub const GEN_AI_REQUEST_TEMPERATURE: &str = "gen_ai.request.temperature";
    pub const GEN_AI_REQUEST_MAX_TOKENS: &str = "gen_ai.request.max_tokens";
    pub const GEN_AI_REQUEST_TOP_P: &str = "gen_ai.request.top_p";

    // Response attributes
    pub const GEN_AI_RESPONSE_FINISH_REASON: &str = "gen_ai.response.finish_reason";
    pub const GEN_AI_RESPONSE_ID: &str = "gen_ai.response.id";

    // Tool/function calling
    pub const GEN_AI_TOOL_NAME: &str = "gen_ai.tool.name";
    pub const GEN_AI_TOOL_CALL_ID: &str = "gen_ai.tool.call_id";

    // Agent/orchestration (extended)
    pub const FERRUMDECK_RUN_ID: &str = "ferrumdeck.run.id";
    pub const FERRUMDECK_STEP_ID: &str = "ferrumdeck.step.id";
    pub const FERRUMDECK_AGENT_ID: &str = "ferrumdeck.agent.id";
    pub const FERRUMDECK_TENANT_ID: &str = "ferrumdeck.tenant.id";

    // Cost tracking (extended)
    pub const FERRUMDECK_COST_CENTS: &str = "ferrumdeck.cost.cents";
    pub const FERRUMDECK_COST_CURRENCY: &str = "ferrumdeck.cost.currency";

    // x402 paid-API spend (autonomous payments). A paywalled outbound call that
    // answers HTTP 402 quotes a price the agent must pay; the FerrumDeck spend
    // gate prices it in cents and rides it on the same span as token cost, so a
    // run's cost slope includes autonomous payments, not just inference. The
    // gate verdict (`authorize` | `deny` | `deny_unpriceable`) is stable across
    // the GenAI semconv flip. Domain type: `fd_policy::x402::X402CostEvent`.
    pub const FERRUMDECK_COST_X402_CENTS: &str = "ferrumdeck.cost.x402_cents";
    pub const FERRUMDECK_X402_ASSET: &str = "ferrumdeck.x402.asset";
    pub const FERRUMDECK_X402_SCHEME: &str = "ferrumdeck.x402.scheme";
    pub const FERRUMDECK_X402_NETWORK: &str = "ferrumdeck.x402.network";
    pub const FERRUMDECK_X402_DECISION: &str = "ferrumdeck.x402.decision";

    // Debt-vs-tax cost decomposition (§2605.27320). Per-call `*.role` is
    // tagged on the LLM/tool span; the three rollup attrs land on the
    // run-completion span. Python mirror lives in `fd_runtime.tracing` and
    // `fd_evals.cost_decomposition`.
    pub const FERRUMDECK_COST_ROLE: &str = "ferrumdeck.cost.role";
    pub const FERRUMDECK_COST_TOKEN_CENTS: &str = "ferrumdeck.cost.token_cents";
    pub const FERRUMDECK_COST_TAX_CENTS: &str = "ferrumdeck.cost.tax_cents";
    pub const FERRUMDECK_COST_TAX_SHARE: &str = "ferrumdeck.cost.tax_share";

    // Tool-call firing-rate metric (extended) — see
    // `fd_otel::firing_rate` for the contract.
    pub const FERRUMDECK_TOOL_FIRING_RATE: &str = "ferrumdeck.metrics.tool_call_firing_rate";
    pub const FERRUMDECK_TOOL_FIRING_REASONING_STEPS: &str =
        "ferrumdeck.metrics.tool_call_reasoning_steps";
    pub const FERRUMDECK_TOOL_FIRING_INVOKING_STEPS: &str =
        "ferrumdeck.metrics.tool_call_invoking_steps";
    pub const FERRUMDECK_TOOL_FIRING_LOW_BREACHED: &str =
        "ferrumdeck.metrics.tool_call_firing_low_breached";
    pub const FERRUMDECK_TOOL_FIRING_LOW_THRESHOLD: &str =
        "ferrumdeck.metrics.tool_call_firing_low_threshold";

    // Receiver-attestation (optional, off by default). Cross-checks a
    // self-reported tool/service span against a receiver-signed receipt.
    // Verification lives in the Python data plane (`fd_runtime.attestation`);
    // these keys are mirrored here so any OTLP/Jaeger consumer reads one
    // schema. `attested=false` (or absent) means the span is self-reported
    // and unverified — additive signal, never enforcement.
    pub const FERRUMDECK_ATTESTED: &str = "ferrumdeck.attestation.attested";
    pub const FERRUMDECK_ATTESTATION_STATUS: &str = "ferrumdeck.attestation.status";
    pub const FERRUMDECK_ATTESTATION_RECEIVER: &str = "ferrumdeck.attestation.receiver_id";
    pub const FERRUMDECK_ATTESTATION_CALL_TOKEN: &str = "ferrumdeck.attestation.call_token";
    pub const FERRUMDECK_ATTESTATION_SCHEME: &str = "ferrumdeck.attestation.scheme";
    pub const FERRUMDECK_ATTESTATION_SELF_REPORTED_UNVERIFIED: &str =
        "ferrumdeck.attestation.self_reported_unverified";

    // Reversibility-aware graduated response (DeepMind AI Control Roadmap
    // R1–R3 ladder). `response_level` is the chosen rung
    // (`allow_and_log` | `allow_under_budget` | `require_approval`) and
    // `reversibility` is the tool's recoverability tier that drove it. Set on
    // the policy/tool-check span; mirrored to the audit trail + the polled
    // `RunResponse`. See `fd_policy::reversibility`.
    pub const FERRUMDECK_POLICY_RESPONSE_LEVEL: &str = "ferrumdeck.policy.response_level";
    pub const FERRUMDECK_POLICY_REVERSIBILITY: &str = "ferrumdeck.policy.reversibility";

    // Claim-grounding-rate reliability metric (VeriGraph, arXiv:2606.16603).
    // Per-run fraction of output claims reachable from a tool-output source
    // node. `*_flagged` carries the optional project-threshold flag (a
    // reliability signal, never enforcement). See `fd_otel::claim_grounding`.
    pub const FERRUMDECK_RELIABILITY_CLAIM_GROUNDING_RATE: &str =
        "ferrumdeck.reliability.claim_grounding_rate";
    pub const FERRUMDECK_RELIABILITY_CLAIM_GROUNDING_FLAGGED: &str =
        "ferrumdeck.reliability.claim_grounding_below_threshold";
    pub const FERRUMDECK_RELIABILITY_CLAIM_GROUNDING_THRESHOLD: &str =
        "ferrumdeck.reliability.claim_grounding_threshold";

    // Coherence-divergence signal (Strained Coherence, arXiv:2606.07889). `true`
    // when the run's trajectory exhibited at least one stated-blocking-fact →
    // contradicting-closure-action divergence surfaced by the live
    // `CoherenceMonitor`. A reliability signal only — never enforcement. See
    // `fd_policy::airlock::coherence`.
    pub const FERRUMDECK_RELIABILITY_COHERENCE_DIVERGENCE: &str =
        "ferrumdeck.reliability.coherence_divergence";

    // Enforcement-decision GenAI span. FerrumDeck returns an
    // allow/deny/approval/kill verdict *before* a tool executes; this makes
    // that verdict a first-class, queryable OTel GenAI span (not just an
    // after-the-fact log). The span name + the `gen_ai.*` keys follow the
    // OpenTelemetry GenAI semconv and flip under `OTEL_SEMCONV_STABILITY_OPT_IN`
    // — see `fd_otel::decision`. The `ferrumdeck.*` decision attrs below are
    // stable across both conventions. Python mirror: `fd_runtime.tracing`.
    pub const GEN_AI_OPERATION_NAME: &str = "gen_ai.operation.name";
    pub const FERRUMDECK_DECISION: &str = "ferrumdeck.decision";
    pub const FERRUMDECK_DECISION_REASON: &str = "ferrumdeck.reason";
    pub const FERRUMDECK_DECISION_RUNG: &str = "ferrumdeck.rung";
    pub const FERRUMDECK_BUDGET_REMAINING: &str = "ferrumdeck.budget_remaining";
    // Colorado SB 26-189 (2026): whether an ADMT-use disclosure is required on a
    // covered consequential decision. A stable `ferrumdeck.*` attribute — like
    // the other decision attrs it is unaffected by the `gen_ai.*` semconv rename.
    pub const FERRUMDECK_ADMT_DISCLOSURE: &str = "ferrumdeck.admt_disclosure";
}

/// GenAI system values
pub mod systems {
    pub const OPENAI: &str = "openai";
    pub const ANTHROPIC: &str = "anthropic";
}

/// Finish reasons
pub mod finish_reasons {
    pub const STOP: &str = "stop";
    pub const LENGTH: &str = "length";
    pub const TOOL_CALLS: &str = "tool_calls";
    pub const ERROR: &str = "error";
}

/// Helper functions for recording GenAI attributes on spans
pub mod span_helpers {
    use super::attrs;
    use tracing::Span;

    /// Record LLM request attributes on the current span
    pub fn record_llm_request(span: &Span, model: &str, system: &str) {
        span.record(attrs::GEN_AI_REQUEST_MODEL, model);
        span.record(attrs::GEN_AI_SYSTEM, system);
    }

    /// Record token usage on the current span
    pub fn record_token_usage(span: &Span, input_tokens: i64, output_tokens: i64) {
        span.record(attrs::GEN_AI_USAGE_INPUT_TOKENS, input_tokens);
        span.record(attrs::GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens);
        span.record(
            attrs::GEN_AI_USAGE_TOTAL_TOKENS,
            input_tokens + output_tokens,
        );
    }

    /// Record cost on the current span
    pub fn record_cost(span: &Span, cost_cents: i64) {
        span.record(attrs::FERRUMDECK_COST_CENTS, cost_cents);
    }

    /// Record an x402 paid-API cost event on the current span, **alongside**
    /// token cost, so a paywalled autonomous payment is queryable next to the
    /// inference it accompanies. Primitive args (no dependency on the
    /// `fd_policy::x402::X402CostEvent` domain type): pass the normalized cents,
    /// the settlement `asset`/`scheme`, the optional `network`, and the gate
    /// `decision` (`"authorize"` | `"deny"` | `"deny_unpriceable"`). Mirrors the
    /// style of [`record_cost`] — the caller owns the domain object.
    pub fn record_x402_cost(
        span: &Span,
        cost_cents: i64,
        asset: &str,
        scheme: &str,
        network: Option<&str>,
        decision: &str,
    ) {
        span.record(attrs::FERRUMDECK_COST_X402_CENTS, cost_cents);
        span.record(attrs::FERRUMDECK_X402_ASSET, asset);
        span.record(attrs::FERRUMDECK_X402_SCHEME, scheme);
        span.record(attrs::FERRUMDECK_X402_DECISION, decision);
        if let Some(net) = network {
            span.record(attrs::FERRUMDECK_X402_NETWORK, net);
        }
    }

    /// Record FerrumDeck context on the current span
    pub fn record_ferrumdeck_context(
        span: &Span,
        run_id: &str,
        step_id: Option<&str>,
        agent_id: Option<&str>,
    ) {
        span.record(attrs::FERRUMDECK_RUN_ID, run_id);
        if let Some(id) = step_id {
            span.record(attrs::FERRUMDECK_STEP_ID, id);
        }
        if let Some(id) = agent_id {
            span.record(attrs::FERRUMDECK_AGENT_ID, id);
        }
    }

    /// Record tool call on the current span
    pub fn record_tool_call(span: &Span, tool_name: &str, call_id: Option<&str>) {
        span.record(attrs::GEN_AI_TOOL_NAME, tool_name);
        if let Some(id) = call_id {
            span.record(attrs::GEN_AI_TOOL_CALL_ID, id);
        }
    }
}

/// Builder for creating GenAI spans with proper attributes
pub struct GenAISpanBuilder {
    span: tracing::Span,
}

impl GenAISpanBuilder {
    /// Create a new builder from an existing span
    pub fn new(span: tracing::Span) -> Self {
        Self { span }
    }

    /// Set the model being used
    pub fn model(self, model: &str) -> Self {
        self.span.record(attrs::GEN_AI_REQUEST_MODEL, model);
        self
    }

    /// Set the AI system (e.g., "openai", "anthropic")
    pub fn system(self, system: &str) -> Self {
        self.span.record(attrs::GEN_AI_SYSTEM, system);
        self
    }

    /// Set token usage
    pub fn tokens(self, input: i64, output: i64) -> Self {
        self.span.record(attrs::GEN_AI_USAGE_INPUT_TOKENS, input);
        self.span.record(attrs::GEN_AI_USAGE_OUTPUT_TOKENS, output);
        self.span
            .record(attrs::GEN_AI_USAGE_TOTAL_TOKENS, input + output);
        self
    }

    /// Set cost in cents
    pub fn cost_cents(self, cents: i64) -> Self {
        self.span.record(attrs::FERRUMDECK_COST_CENTS, cents);
        self
    }

    /// Set run ID
    pub fn run_id(self, id: &str) -> Self {
        self.span.record(attrs::FERRUMDECK_RUN_ID, id);
        self
    }

    /// Set step ID
    pub fn step_id(self, id: &str) -> Self {
        self.span.record(attrs::FERRUMDECK_STEP_ID, id);
        self
    }

    /// Get the configured span
    pub fn build(self) -> tracing::Span {
        self.span
    }
}

/// Model pricing (USD per million tokens)
/// Prices as of December 2024
pub mod pricing {
    /// Pricing info for a model
    #[derive(Debug, Clone, Copy)]
    pub struct ModelPricing {
        /// Cost per million input tokens in USD
        pub input_per_million: f64,
        /// Cost per million output tokens in USD
        pub output_per_million: f64,
    }

    impl ModelPricing {
        /// Calculate cost in cents
        pub fn calculate_cost_cents(&self, input_tokens: u64, output_tokens: u64) -> u64 {
            let input_cost = (input_tokens as f64 / 1_000_000.0) * self.input_per_million;
            let output_cost = (output_tokens as f64 / 1_000_000.0) * self.output_per_million;
            let total_usd = input_cost + output_cost;
            // Convert to cents and round up
            (total_usd * 100.0).ceil() as u64
        }
    }

    // OpenAI models
    pub const GPT_4O: ModelPricing = ModelPricing {
        input_per_million: 2.50,
        output_per_million: 10.00,
    };

    pub const GPT_4O_MINI: ModelPricing = ModelPricing {
        input_per_million: 0.15,
        output_per_million: 0.60,
    };

    pub const GPT_4_TURBO: ModelPricing = ModelPricing {
        input_per_million: 10.00,
        output_per_million: 30.00,
    };

    pub const O1: ModelPricing = ModelPricing {
        input_per_million: 15.00,
        output_per_million: 60.00,
    };

    pub const O1_MINI: ModelPricing = ModelPricing {
        input_per_million: 3.00,
        output_per_million: 12.00,
    };

    // Anthropic models
    pub const CLAUDE_3_5_SONNET: ModelPricing = ModelPricing {
        input_per_million: 3.00,
        output_per_million: 15.00,
    };

    pub const CLAUDE_3_OPUS: ModelPricing = ModelPricing {
        input_per_million: 15.00,
        output_per_million: 75.00,
    };

    pub const CLAUDE_3_HAIKU: ModelPricing = ModelPricing {
        input_per_million: 0.25,
        output_per_million: 1.25,
    };

    // Default fallback pricing (conservative estimate)
    pub const DEFAULT: ModelPricing = ModelPricing {
        input_per_million: 10.00,
        output_per_million: 30.00,
    };

    /// Get pricing for a model by name
    pub fn get_pricing(model: &str) -> ModelPricing {
        let model_lower = model.to_lowercase();

        // OpenAI models
        if model_lower.contains("gpt-4o-mini") {
            return GPT_4O_MINI;
        }
        if model_lower.contains("gpt-4o") {
            return GPT_4O;
        }
        if model_lower.contains("gpt-4-turbo") {
            return GPT_4_TURBO;
        }
        if model_lower.contains("o1-mini") {
            return O1_MINI;
        }
        if model_lower.contains("o1") {
            return O1;
        }

        // Anthropic models
        if model_lower.contains("claude-3-5-sonnet") || model_lower.contains("claude-3.5-sonnet") {
            return CLAUDE_3_5_SONNET;
        }
        if model_lower.contains("claude-3-opus") {
            return CLAUDE_3_OPUS;
        }
        if model_lower.contains("claude-3-haiku") {
            return CLAUDE_3_HAIKU;
        }

        DEFAULT
    }

    /// Calculate cost in cents for a given model and token counts
    pub fn calculate_cost_cents(model: &str, input_tokens: u64, output_tokens: u64) -> u64 {
        let pricing = get_pricing(model);
        pricing.calculate_cost_cents(input_tokens, output_tokens)
    }
}

#[cfg(test)]
mod tests {
    use super::pricing;

    #[test]
    fn x402_cost_attr_keys_are_stable_and_distinct() {
        use super::attrs;
        // These keys are the wire contract a Jaeger/OTLP consumer queries on;
        // pin them so a rename is a deliberate, test-breaking change.
        assert_eq!(
            attrs::FERRUMDECK_COST_X402_CENTS,
            "ferrumdeck.cost.x402_cents"
        );
        assert_eq!(attrs::FERRUMDECK_X402_ASSET, "ferrumdeck.x402.asset");
        assert_eq!(attrs::FERRUMDECK_X402_SCHEME, "ferrumdeck.x402.scheme");
        assert_eq!(attrs::FERRUMDECK_X402_NETWORK, "ferrumdeck.x402.network");
        assert_eq!(attrs::FERRUMDECK_X402_DECISION, "ferrumdeck.x402.decision");
        // Distinct from the token-cost key it rides alongside.
        assert_ne!(
            attrs::FERRUMDECK_COST_X402_CENTS,
            attrs::FERRUMDECK_COST_CENTS
        );
    }

    #[test]
    fn record_x402_cost_accepts_a_real_span_with_and_without_network() {
        // A disabled span absorbs records cleanly; guards against a typo in the
        // constant names (same smoke pattern as cost_decomposition).
        let span = tracing::Span::none();
        super::span_helpers::record_x402_cost(
            &span,
            50,
            "USDC",
            "exact",
            Some("base-sepolia"),
            "authorize",
        );
        super::span_helpers::record_x402_cost(&span, 0, "WETH", "exact", None, "deny_unpriceable");
    }

    #[test]
    fn test_gpt4o_pricing() {
        // 1000 input tokens + 500 output tokens
        let cost = pricing::calculate_cost_cents("gpt-4o", 1000, 500);
        // (1000/1M * 2.50) + (500/1M * 10.00) = 0.0025 + 0.005 = 0.0075 USD = 0.75 cents
        // Rounded up to 1 cent
        assert_eq!(cost, 1);
    }

    #[test]
    fn test_claude_pricing() {
        // 100000 input tokens + 50000 output tokens
        let cost = pricing::calculate_cost_cents("claude-3-5-sonnet", 100000, 50000);
        // (100000/1M * 3.00) + (50000/1M * 15.00) = 0.3 + 0.75 = 1.05 USD = 105 cents
        assert_eq!(cost, 105);
    }

    #[test]
    fn test_unknown_model_uses_default() {
        let cost = pricing::calculate_cost_cents("unknown-model", 1000000, 1000000);
        // Default pricing: (1M/1M * 10.00) + (1M/1M * 30.00) = 10 + 30 = 40 USD = 4000 cents
        assert_eq!(cost, 4000);
    }
}
