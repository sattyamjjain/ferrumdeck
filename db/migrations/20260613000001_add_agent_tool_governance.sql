-- Per-agent tool governance: approval-required and explicit denylist tiers.
--
-- Until now `agent_versions` stored only `allowed_tools`. The policy engine
-- (fd-policy) supports a three-tier allowlist — denied > approval-required >
-- allowed > deny-by-default — but the registry could express only the "allowed"
-- tier, so per-agent approval gates and explicit denials were not representable
-- and the gateway evaluated tool calls against a process-global default instead
-- of the run's own agent. These columns let the gateway build the full
-- ToolAllowlist for each run's agent at the enforcement point.
--
-- Backward-compatible: existing rows default to empty arrays, preserving the
-- prior deny-by-default behaviour (only `allowed_tools` pass).

ALTER TABLE agent_versions
    ADD COLUMN IF NOT EXISTS approval_required_tools TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS denied_tools TEXT[] NOT NULL DEFAULT '{}';
