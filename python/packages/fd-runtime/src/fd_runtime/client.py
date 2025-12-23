"""Control Plane HTTP client."""

from typing import Any

import httpx

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
