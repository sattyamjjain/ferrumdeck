"""Policy-engine behavioural security tests (SEC-POL-001..004).

Drives the real enforcement endpoint and asserts the *decision*: deny-by-default
denies an unknown tool (`allowed is False`), obfuscated tool names do not slip
past the allowlist, and input-borne "policy" cannot grant access. The previous
version POSTed workflows and asserted ``status_code in (200, 201, 400, 403, 422)``
— and, in two places, literally ``assert ... or True`` — which asserted nothing.
"""

import httpx
import pytest

# A tool that is NOT on the seeded agent's allowlist
# (git_read / git_write / test_run / github_create_pr).
UNKNOWN_TOOL = "completely_unknown_tool_xyz123"


def _create_run(client: httpx.Client, agent_id: str, run_input: dict) -> str:
    resp = client.post("/v1/runs", json={"agent_id": agent_id, "input": run_input})
    assert resp.status_code in (200, 201), f"create run: {resp.status_code} {resp.text}"
    return resp.json()["id"]


# ==========================================================================
# SEC-POL-001: Deny by default
# ==========================================================================
class TestDenyByDefault:
    def test_unknown_tool_is_denied(self, check_tool, created_run: str) -> None:
        """An unknown tool is denied — deny-by-default, not merely 'handled'."""
        decision = check_tool(created_run, UNKNOWN_TOOL, {"arg": "value"})
        assert decision["allowed"] is False, (
            f"deny-by-default must deny {UNKNOWN_TOOL!r}: {decision}"
        )

    def test_allowlisted_tool_has_no_false_positive_violation(
        self, check_tool, created_run: str
    ) -> None:
        """A benign, allowlisted tool call is not flagged with an Airlock violation
        (positive control — the engine is not just denying everything)."""
        decision = check_tool(created_run, "git_read", {"path": "README.md"})
        assert decision["violation_type"] is None, (
            f"benign allowlisted call should not raise a violation: {decision}"
        )


# ==========================================================================
# SEC-POL-002: Allowlist cannot be bypassed with a crafted tool name
# ==========================================================================
class TestPolicyBypassAttempt:
    @pytest.mark.parametrize(
        "crafted_name",
        [
            "git_read​malicious",  # zero-width space smuggling
            "GIT_READ",  # case manipulation
            "../../../git_read",  # path traversal
            "git_read\x00execute_shell",  # null-byte truncation
            "execute_shell",  # a plainly dangerous, non-allowlisted tool
        ],
    )
    def test_crafted_tool_name_is_denied(
        self, check_tool, created_run: str, crafted_name: str
    ) -> None:
        """None of these resolve to an allowlisted tool, so each must be denied —
        the allowlist matches the exact tool identity, not a fuzzy variant."""
        decision = check_tool(created_run, crafted_name, {"cmd": "ls"})
        assert decision["allowed"] is False, (
            f"crafted name {crafted_name!r} bypassed the allowlist: {decision}"
        )


# ==========================================================================
# SEC-POL-003: Policy cannot be injected via run input or tool input
# ==========================================================================
class TestPolicyInjection:
    def test_injected_policy_in_run_input_does_not_grant_access(
        self, api_client: httpx.Client
    ) -> None:
        """A run whose input tries to smuggle a policy override still denies an
        unknown tool — the input is data, not policy."""
        run_id = _create_run(
            api_client,
            "agt_01JFVX0000000000000000001",
            {"task": "x", "__policy__": {"allow": ["*"]}, "allow_all": True},
        )
        resp = api_client.post(
            f"/v1/runs/{run_id}/check-tool",
            json={"tool_name": UNKNOWN_TOOL, "tool_input": {}},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["allowed"] is False, (
            "input-borne policy override must not grant access to an unknown tool"
        )

    def test_injected_policy_in_tool_input_is_ignored(self, check_tool, created_run: str) -> None:
        """A `__policy__` key inside tool_input does not allowlist a tool."""
        decision = check_tool(
            created_run,
            "read_file",  # not on the allowlist
            {"path": "/tmp/x", "__policy__": {"allow": ["read_file"]}},
        )
        assert decision["allowed"] is False, (
            f"tool_input policy injection must be ignored: {decision}"
        )


# ==========================================================================
# SEC-POL-004: Decisions are consistent (no race-condition bypass)
# ==========================================================================
class TestDecisionConsistency:
    def test_repeated_denies_are_consistent(self, check_tool, created_run: str) -> None:
        """Ten identical checks of an unknown tool all deny — no call slips
        through under repetition (the old test asserted `... or True`)."""
        decisions = [
            check_tool(created_run, UNKNOWN_TOOL, {"idx": i})["allowed"] for i in range(10)
        ]
        assert decisions == [False] * 10, (
            f"deny-by-default was inconsistent across repeats: {decisions}"
        )

    def test_same_tool_yields_same_decision(self, check_tool, created_run: str) -> None:
        """An allowlisted tool yields a stable allow-decision across repeats."""
        first = check_tool(created_run, "git_read", {"path": "a.txt"})["allowed"]
        again = check_tool(created_run, "git_read", {"path": "a.txt"})["allowed"]
        assert first == again, "policy decision for the same tool must be stable"
