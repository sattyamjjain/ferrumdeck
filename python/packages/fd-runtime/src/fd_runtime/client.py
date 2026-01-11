"""Control Plane HTTP client."""

from typing import Any

import httpx

from fd_runtime.airlock import AirlockResponse
from fd_runtime.models import Run, Step, StepStatus


class ControlPlaneClient:
    """HTTP client for the FerrumDeck Control Plane API."""

    def __init__(
        self,
        base_url: str = "http://localhost:8080",
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.headers = {"Content-Type": "application/json"}
        if api_key:
            self.headers["Authorization"] = f"Bearer {api_key}"

    async def create_run(
        self,
        agent_id: str,
        input_data: dict[str, Any],
        config: dict[str, Any] | None = None,
    ) -> Run:
        """Create a new run."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/v1/runs",
                headers=self.headers,
                json={
                    "agent_id": agent_id,
                    "input": input_data,
                    "config": config,
                },
            )
            response.raise_for_status()
            data = response.json()
            return Run(**data)

    async def get_run(self, run_id: str) -> Run:
        """Get run by ID."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/v1/runs/{run_id}",
                headers=self.headers,
            )
            response.raise_for_status()
            return Run(**response.json())

    async def list_steps(self, run_id: str) -> list[Step]:
        """List steps for a run."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(
                f"{self.base_url}/v1/runs/{run_id}/steps",
                headers=self.headers,
            )
            response.raise_for_status()
            return [Step(**s) for s in response.json()]

    async def submit_step_result(
        self,
        run_id: str,
        step_id: str,
        output: dict[str, Any],
        status: StepStatus,
        usage: dict[str, Any] | None = None,
        error: dict[str, Any] | None = None,
    ) -> None:
        """Submit the result of a step execution."""
        payload: dict[str, Any] = {
            "output": output,
            "status": status.value,
        }
        if usage:
            payload["input_tokens"] = usage.get("input_tokens")
            payload["output_tokens"] = usage.get("output_tokens")
        if error:
            payload["error"] = error

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/v1/runs/{run_id}/steps/{step_id}",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()

    async def check_tool_policy(
        self,
        run_id: str,
        tool_name: str,
        tool_input: dict[str, Any] | None = None,
        estimated_cost_cents: int | None = None,
    ) -> AirlockResponse:
        """Check if a tool call is allowed by policy and Airlock security.

        Args:
            run_id: The run ID for context.
            tool_name: The tool name to check.
            tool_input: Tool input payload for Airlock inspection.
            estimated_cost_cents: Estimated cost for velocity tracking.

        Returns:
            AirlockResponse with policy and security decision details.

        Note:
            This method returns the response even if blocked. Callers should
            check response.allowed and handle accordingly, or use
            check_tool_policy_strict() which raises exceptions.
        """
        payload: dict[str, Any] = {"tool_name": tool_name}
        if tool_input is not None:
            payload["tool_input"] = tool_input
        if estimated_cost_cents is not None:
            payload["estimated_cost_cents"] = estimated_cost_cents

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/v1/runs/{run_id}/check-tool",
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            result = response.json()
            return AirlockResponse.from_dict(result)

    async def check_tool_policy_strict(
        self,
        run_id: str,
        tool_name: str,
        tool_input: dict[str, Any] | None = None,
        estimated_cost_cents: int | None = None,
    ) -> AirlockResponse:
        """Check tool policy and raise exceptions if not allowed.

        This is a convenience wrapper around check_tool_policy that raises
        appropriate exceptions when the tool call is blocked.

        Args:
            run_id: The run ID for context.
            tool_name: The tool name to check.
            tool_input: Tool input payload for Airlock inspection.
            estimated_cost_cents: Estimated cost for velocity tracking.

        Returns:
            AirlockResponse (only if allowed).

        Raises:
            PermissionError: If the tool is denied by policy or Airlock.
            ValueError: If approval is required before execution.
        """
        result = await self.check_tool_policy(run_id, tool_name, tool_input, estimated_cost_cents)

        if not result.allowed:
            if result.requires_approval:
                raise ValueError(f"Tool '{tool_name}' requires approval: {result.reason}")
            if result.blocked_by_airlock:
                raise PermissionError(
                    f"Tool '{tool_name}' blocked by Airlock: {result.reason} "
                    f"(risk_level={result.risk_level.value}, "
                    f"violation_type={result.violation_type})"
                )
            raise PermissionError(f"Tool '{tool_name}' denied by policy: {result.reason}")

        return result
