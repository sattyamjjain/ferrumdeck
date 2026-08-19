"""OWASP LLM Top 10 security tests (SEC-LLM-001..006), behavioural.

Every test here used to POST a workflow to ``/v1/workflows`` (a path the
gateway does not serve) and assert ``status_code in (200, 201, 400, 422)`` — or,
for SEC-LLM-004, literally ``assert True``. Those asserted only that the service
stayed up.

The one item that is a deterministic policy-plane *decision* — tool-use policy
(LLM07): a non-allowlisted or dangerous tool is denied — is asserted here
against the real enforcement endpoint ``POST /v1/runs/{id}/check-tool``. The
rest depend on executing an LLM/agentic run (prompt-injection mitigation,
output validation, budget-DoS, PII redaction, approval gating), which this suite
cannot drive to a decision without a live run; they are skipped with the reason
and the runnable proof that *does* cover them, rather than left as tautologies
(#6).
"""

import pytest


# ==========================================================================
# SEC-LLM-005 (LLM07): tool-use policy — deny-by-default is a real decision.
# ==========================================================================
class TestLLM07ToolPolicyEnforced:
    """A tool that is not on the run's agent allowlist is denied. This is the
    core deny-by-default guarantee, asserted on the decision (`allowed is False`),
    not on a 2xx that the *workflow envelope* was accepted."""

    def test_unknown_tool_is_denied(self, check_tool, created_run: str) -> None:
        """SEC-LLM-005a: a made-up tool is denied by the allowlist."""
        decision = check_tool(created_run, "completely_made_up_tool", {})
        assert decision["allowed"] is False, (
            f"a non-allowlisted tool must be denied, got {decision}"
        )

    def test_dangerous_tool_is_denied(self, check_tool, created_run: str) -> None:
        """SEC-LLM-005b: an arbitrary-code tool is denied (not on the allowlist),
        so the deny-by-default policy blocks it before any RCE payload runs."""
        decision = check_tool(
            created_run,
            "execute_arbitrary_code",
            {"code": "os.system('rm -rf /')"},
        )
        assert decision["allowed"] is False, (
            f"an off-allowlist code-execution tool must be denied, got {decision}"
        )


# ==========================================================================
# Not convertible without executing a run — skipped with the reason and the
# runnable coverage that already exists. Listed on #6.
# ==========================================================================
class TestRequiresLiveRun:
    @pytest.mark.skip(
        reason="prompt-injection mitigation needs the agentic loop to confirm the "
        "injected tool call is blocked; the deterministic corpus is gated by "
        "`make eval-injection-defense` (100% block) — see #6"
    )
    def test_llm01_prompt_injection(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="LLM02 output validation runs during step execution "
        "(fd_worker.validation); assert it in the worker path, not via a "
        "workflow POST — see #6"
    )
    def test_llm02_insecure_output(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="budget-DoS needs a run to accrue cost past the ceiling; the gate "
        "itself is unit-tested in fd_policy::budget — see #6"
    )
    def test_llm04_denial_of_service(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="PII redaction is asserted in fd_audit::redaction unit tests; there "
        "is no audit-read API to observe the redacted record on the wire — see #6"
    )
    def test_llm06_sensitive_disclosure(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="approval-gate decision (`requires_approval`) needs a tool in the "
        "agent's approval_required set; the seed agent's allowlist has none, so "
        "this needs a purpose-seeded agent on a live stack — see #6"
    )
    def test_llm09_overreliance_approval_gate(self) -> None:  # pragma: no cover
        ...
