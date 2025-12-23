"""Step execution logic with tracing and retry support."""

import logging
import os
from typing import Any

import httpx
import litellm
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from fd_mcp_router import MCPRouter, MCPServerConfig, ToolAllowlist
from fd_runtime import (
    ArtifactStore,
    ArtifactType,
    ControlPlaneClient,
    StepStatus,
    StepType,
    create_artifact_store,
    set_llm_response_attributes,
    trace_llm_call,
    trace_step_execution,
    trace_tool_call,
)
from fd_worker.llm import LLMExecutor

logger = logging.getLogger(__name__)

# Transient errors that should trigger retry
RETRYABLE_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    httpx.ReadTimeout,
    ConnectionError,
    TimeoutError,
    litellm.RateLimitError,
    litellm.ServiceUnavailableError,
    litellm.APIConnectionError,
)


class StepExecutor:
    """Executes individual steps within a run with full tracing and retries."""

    def __init__(
        self,
        control_plane_url: str,
        api_key: str | None = None,
        mcp_servers: list[MCPServerConfig] | None = None,
        tool_allowlist: ToolAllowlist | None = None,
        max_retries: int | None = None,
        retry_delay_ms: int | None = None,
        artifact_store: ArtifactStore | None = None,
    ):
        self.client = ControlPlaneClient(control_plane_url, api_key)
        self.llm_executor = LLMExecutor()
        self.mcp_router = MCPRouter(
            servers=mcp_servers or [],
            allowlist=tool_allowlist or ToolAllowlist(),
        )
        self._mcp_connected = False

        # Retry configuration from environment or defaults
        self.max_retries = max_retries or int(os.getenv("WORKER_MAX_RETRIES", "3"))
        self.retry_delay_ms = retry_delay_ms or int(
            os.getenv("WORKER_RETRY_DELAY_MS", "1000")
        )

        # Artifact storage
        self.artifact_store = artifact_store or create_artifact_store("local")

    async def connect(self) -> None:
        """Connect to MCP servers."""
        if not self._mcp_connected:
            await self.mcp_router.connect()
            self._mcp_connected = True

    async def disconnect(self) -> None:
        """Disconnect from MCP servers."""
        if self._mcp_connected:
            await self.mcp_router.disconnect()
            self._mcp_connected = False

    async def _store_output_artifact(
        self,
        run_id: str,
        step_id: str,
        step_type: str,
        output: dict[str, Any],
    ) -> None:
        """Store step output as an artifact."""
        import json

        content = json.dumps(output, indent=2, default=str).encode()
        await self.artifact_store.store(
            run_id=run_id,
            name=f"step-{step_id}-output.json",
            content=content,
            artifact_type=ArtifactType.OUTPUT,
            step_id=step_id,
            content_type="application/json",
            metadata={"step_type": step_type},
        )

    async def execute(self, job: dict[str, Any]) -> None:
        """Execute a step job with full tracing."""
        run_id = job["run_id"]
        step_id = job["step_id"]
        step_type = StepType(job["step_type"])
        step_input = job.get("input", {})
        tenant_id = job.get("tenant_id")
        agent_id = job.get("agent_id")

        logger.info(f"Executing step {step_id} (type: {step_type})")

        with trace_step_execution(
            run_id=run_id,
            step_id=step_id,
            step_type=step_type.value,
            tenant_id=tenant_id,
            agent_id=agent_id,
        ) as span:
            try:
                if step_type == StepType.LLM:
                    result = await self._execute_llm(step_input, run_id, step_id)
                elif step_type == StepType.TOOL:
                    result = await self._execute_tool(step_input, run_id, step_id)
                elif step_type == StepType.RETRIEVAL:
                    result = await self._execute_retrieval(step_input)
                elif step_type == StepType.SANDBOX:
                    result = await self._execute_sandbox(step_input)
                elif step_type == StepType.APPROVAL:
                    # Approval steps are handled by control plane
                    result = {"output": {"status": "approval_pending"}}
                else:
                    raise ValueError(f"Unknown step type: {step_type}")

                # Store output as artifact
                await self._store_output_artifact(
                    run_id=run_id,
                    step_id=step_id,
                    step_type=step_type.value,
                    output=result["output"],
                )

                # Report success
                await self.client.submit_step_result(
                    run_id=run_id,
                    step_id=step_id,
                    output=result["output"],
                    status=StepStatus.COMPLETED,
                    usage=result.get("usage"),
                )

                span.set_attribute("step.status", "completed")

            except PermissionError as e:
                # Tool was denied by policy
                logger.warning(f"Step {step_id} denied by policy: {e}")
                await self.client.submit_step_result(
                    run_id=run_id,
                    step_id=step_id,
                    output={"error": str(e), "policy_denied": True},
                    status=StepStatus.FAILED,
                )
                span.set_attribute("step.status", "policy_denied")

            except ValueError as e:
                # Tool requires approval
                if "requires approval" in str(e).lower():
                    logger.info(f"Step {step_id} requires approval: {e}")
                    await self.client.submit_step_result(
                        run_id=run_id,
                        step_id=step_id,
                        output={"error": str(e), "requires_approval": True},
                        status=StepStatus.PENDING,
                    )
                    span.set_attribute("step.status", "requires_approval")
                else:
                    raise

            except Exception as e:
                logger.exception(f"Step {step_id} failed")
                await self.client.submit_step_result(
                    run_id=run_id,
                    step_id=step_id,
                    output={"error": str(e)},
                    status=StepStatus.FAILED,
                )
                span.set_attribute("step.status", "failed")

    async def _execute_llm(
        self,
        step_input: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        """Execute an LLM step with tracing and retries."""
        messages = step_input.get("messages", [])
        model = step_input.get("model", "claude-sonnet-4-20250514")
        tools = step_input.get("tools")
        max_tokens = step_input.get("max_tokens", 4096)
        temperature = step_input.get("temperature", 0.7)

        # Build messages from task if no explicit messages provided
        if not messages:
            task = step_input.get("task")
            system_prompt = step_input.get(
                "system_prompt",
                "You are a helpful AI assistant. Complete the requested task.",
            )
            if task:
                messages = [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": str(task)},
                ]
            else:
                # Try to build from any available input
                content = step_input.get("content") or step_input.get("prompt")
                if content:
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": str(content)},
                    ]
                else:
                    # Last resort: use the entire step_input as context
                    import json
                    messages = [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": f"Process this input: {json.dumps(step_input)}"},
                    ]

        # Determine the LLM system from model name
        if "claude" in model.lower():
            system = "anthropic"
        elif "gpt" in model.lower():
            system = "openai"
        else:
            system = "unknown"

        with trace_llm_call(
            model=model,
            system=system,
            max_tokens=max_tokens,
            temperature=temperature,
            run_id=run_id,
            step_id=step_id,
        ) as span:
            # Create retry-wrapped coroutine
            @retry(
                retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
                stop=stop_after_attempt(self.max_retries),
                wait=wait_exponential(
                    multiplier=self.retry_delay_ms / 1000,
                    min=1,
                    max=30,
                ),
                reraise=True,
            )
            async def _call_with_retry() -> Any:
                return await self.llm_executor.complete(
                    messages=messages,
                    model=model,
                    tools=tools,
                    max_tokens=max_tokens,
                    temperature=temperature,
                )

            try:
                response = await _call_with_retry()
            except RetryError as e:
                logger.warning(f"LLM call exhausted {self.max_retries} retries")
                raise e.last_attempt.exception() from e

            # Set response attributes on span
            set_llm_response_attributes(
                span=span,
                model=response.model,
                finish_reason=response.finish_reason,
                input_tokens=response.usage.input_tokens,
                output_tokens=response.usage.output_tokens,
            )

            span.set_attribute("llm.retries", 0)  # Logged for observability

            return {
                "output": response.content,
                "usage": {
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                },
            }

    async def _execute_tool(
        self,
        step_input: dict[str, Any],
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        """Execute a tool step via MCP router with tracing and retries."""
        tool_name = step_input.get("tool_name")
        tool_input = step_input.get("tool_input", {})

        if not tool_name:
            raise ValueError("tool_name is required for tool steps")

        # Ensure MCP router is connected
        await self.connect()

        # Validate input against schema
        errors = self.mcp_router.validate_tool_input(tool_name, tool_input)
        if errors:
            raise ValueError(f"Tool input validation failed: {errors}")

        with trace_tool_call(
            tool_name=tool_name,
            run_id=run_id,
            step_id=step_id,
        ) as span:
            # Create retry-wrapped coroutine for transient failures
            @retry(
                retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
                stop=stop_after_attempt(self.max_retries),
                wait=wait_exponential(
                    multiplier=self.retry_delay_ms / 1000,
                    min=1,
                    max=30,
                ),
                reraise=True,
            )
            async def _call_with_retry() -> Any:
                return await self.mcp_router.call_tool(
                    tool_name=tool_name,
                    tool_input=tool_input,
                    run_id=run_id,
                )

            try:
                result = await _call_with_retry()
            except RetryError as e:
                logger.warning(f"Tool call exhausted {self.max_retries} retries")
                raise e.last_attempt.exception() from e

            span.set_attribute("tool.server", result.server or "unknown")
            span.set_attribute("tool.success", result.success)

            if not result.success:
                raise RuntimeError(f"Tool call failed: {result.error}")

            return {
                "output": {
                    "result": result.output,
                    "server": result.server,
                    "tool": result.tool,
                },
            }

    async def _execute_retrieval(self, step_input: dict[str, Any]) -> dict[str, Any]:
        """Execute a retrieval step.

        TODO: Integrate with vector store / RAG system
        """
        query = step_input.get("query", "")
        collection = step_input.get("collection")
        top_k = step_input.get("top_k", 5)

        logger.info(f"Retrieval query: {query[:50]}... (top_k={top_k})")

        # Placeholder - would integrate with pgvector or similar
        return {
            "output": {
                "documents": [],
                "query": query,
                "collection": collection,
                "message": "Retrieval not yet implemented",
            },
        }

    async def _execute_sandbox(self, step_input: dict[str, Any]) -> dict[str, Any]:
        """Execute code in a sandbox.

        TODO: Integrate with container-based sandbox execution
        """
        code = step_input.get("code", "")
        language = step_input.get("language", "python")

        logger.info(f"Sandbox execution: {language} code ({len(code)} chars)")

        # Placeholder - would integrate with secure sandbox
        return {
            "output": {
                "status": "not_implemented",
                "language": language,
                "message": "Sandbox execution not yet implemented",
            },
        }
