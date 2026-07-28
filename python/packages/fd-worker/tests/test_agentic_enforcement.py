"""Enforcement tests for the agentic tool-execution path.

These pin the fix for the demo bypass: fd_worker.agentic previously checked a
local allowlist and, on ``requires_approval``, logged a warning and executed the
tool anyway. Every tool call must now be authorized by the control plane's
``check-tool`` endpoint *before* it runs, and the executor must fail closed when
the control plane is unreachable.

The three tests the whole change exists for:
  * a ``deny`` decision blocks execution,
  * a ``requires_approval`` decision does not execute before approval,
  * the gateway being down results in refusal (fail-closed).
"""

from unittest.mock import AsyncMock

import pytest

from fd_mcp_router.config import ToolAllowlist
from fd_runtime.airlock import AirlockResponse
from fd_worker.agentic import AgenticExecutor
from fd_worker.llm import ToolCall


def _allow_response(**overrides):
    data = {
        "allowed": True,
        "requires_approval": False,
        "decision_id": "pdc_x",
        "reason": "allowlisted",
    }
    data.update(overrides)
    return AirlockResponse.from_dict(data)


def _make_executor(client, *, fail_closed=True):
    """An executor whose only tool, ``write_file``, is locally allowed (so the
    LOCAL pre-filter passes and the CONTROL PLANE is the deciding authority), with
    a fake MCP connection that records whether the tool actually executed."""
    ex = AgenticExecutor(
        mcp_configs=[],
        allowlist=ToolAllowlist(allowed_tools=["write_file"]),
        control_plane_client=client,
        fail_closed=fail_closed,
    )
    conn = AsyncMock()
    conn.call_tool = AsyncMock(return_value="TOOL RAN")
    ex._connections = {"srv": conn}
    ex._tool_to_server = {"write_file": "srv"}
    return ex, conn


def _tool_call():
    return ToolCall(id="tc1", name="write_file", arguments={"path": "x", "content": "y"})


@pytest.mark.asyncio
async def test_deny_decision_blocks_execution():
    client = AsyncMock()
    client.check_tool_policy = AsyncMock(
        return_value=_allow_response(allowed=False, reason="denied by allowlist")
    )
    ex, conn = _make_executor(client)

    result = await ex._execute_tool(_tool_call(), run_id="run_1")

    assert result.success is False
    assert result.decision == "deny"
    conn.call_tool.assert_not_awaited()  # the tool never ran
    client.check_tool_policy.assert_awaited_once()  # the authority WAS consulted


@pytest.mark.asyncio
async def test_requires_approval_does_not_execute():
    client = AsyncMock()
    # Local allowlist says "allowed", but the control plane requires approval —
    # proving the control plane, not the local filter, is the final authority.
    client.check_tool_policy = AsyncMock(
        return_value=_allow_response(
            allowed=False, requires_approval=True, reason="write tool needs approval"
        )
    )
    ex, conn = _make_executor(client)

    result = await ex._execute_tool(_tool_call(), run_id="run_1")

    assert result.success is False
    assert result.decision == "requires_approval"
    assert "approval" in (result.error or "").lower()
    conn.call_tool.assert_not_awaited()  # NOT executed before approval


@pytest.mark.asyncio
async def test_gateway_down_fails_closed():
    import httpx

    client = AsyncMock()
    client.check_tool_policy = AsyncMock(side_effect=httpx.ConnectError("connection refused"))
    ex, conn = _make_executor(client, fail_closed=True)

    result = await ex._execute_tool(_tool_call(), run_id="run_1")

    assert result.success is False
    assert result.decision == "fail_closed"
    conn.call_tool.assert_not_awaited()  # unreachable gateway => refuse, don't run


@pytest.mark.asyncio
async def test_allow_decision_executes():
    client = AsyncMock()
    client.check_tool_policy = AsyncMock(return_value=_allow_response())
    ex, conn = _make_executor(client)

    result = await ex._execute_tool(_tool_call(), run_id="run_1")

    assert result.success is True
    assert result.output == "TOOL RAN"
    conn.call_tool.assert_awaited_once()


@pytest.mark.asyncio
async def test_local_deny_short_circuits_without_calling_gateway():
    client = AsyncMock()
    client.check_tool_policy = AsyncMock(return_value=_allow_response())
    ex = AgenticExecutor(
        mcp_configs=[],
        allowlist=ToolAllowlist(denied_tools=["delete_repo"]),
        control_plane_client=client,
    )
    conn = AsyncMock()
    conn.call_tool = AsyncMock(return_value="TOOL RAN")
    ex._connections = {"srv": conn}
    ex._tool_to_server = {"delete_repo": "srv"}

    result = await ex._execute_tool(
        ToolCall(id="tc2", name="delete_repo", arguments={}), run_id="run_1"
    )

    assert result.success is False
    assert result.decision == "deny"
    conn.call_tool.assert_not_awaited()
    client.check_tool_policy.assert_not_awaited()  # cheap local deny, no round-trip


@pytest.mark.asyncio
async def test_no_run_id_fails_closed():
    # No run_id => the control plane cannot be consulted => refuse by default.
    client = AsyncMock()
    client.check_tool_policy = AsyncMock(return_value=_allow_response())
    ex, conn = _make_executor(client)

    result = await ex._execute_tool(_tool_call(), run_id=None)

    assert result.success is False
    assert result.decision == "fail_closed"
    conn.call_tool.assert_not_awaited()


@pytest.mark.asyncio
async def test_fail_open_executes_when_explicitly_configured():
    # Escape hatch: with fail_closed=False, an unreachable gateway executes
    # UNGOVERNED (logged). Proves the default (closed) is a real choice, not luck.
    import httpx

    client = AsyncMock()
    client.check_tool_policy = AsyncMock(side_effect=httpx.ConnectError("down"))
    ex, conn = _make_executor(client, fail_closed=False)

    result = await ex._execute_tool(_tool_call(), run_id="run_1")

    assert result.success is True
    conn.call_tool.assert_awaited_once()
