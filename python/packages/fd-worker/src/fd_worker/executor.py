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
from fd_worker.agentic import AgenticExecutor
from fd_worker.llm import LLMExecutor
from fd_worker.validation import OutputValidator

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

        # Store MCP configs for agentic executor
        self._mcp_servers = mcp_servers or []
        self._tool_allowlist = tool_allowlist or ToolAllowlist()

        self.mcp_router = MCPRouter(
            servers=self._mcp_servers,
            allowlist=self._tool_allowlist,
        )
        self._mcp_connected = False

        # Agentic executor for full LLM + Tool loops
        self._agentic_executor: AgenticExecutor | None = None
        self._agentic_connected = False

        # Retry configuration from environment or defaults
        self.max_retries = max_retries or int(os.getenv("WORKER_MAX_RETRIES", "3"))
        self.retry_delay_ms = retry_delay_ms or int(os.getenv("WORKER_RETRY_DELAY_MS", "1000"))

        # Artifact storage
        self.artifact_store = artifact_store or create_artifact_store("local")

        # Output validator for LLM02 mitigation
        self.output_validator = OutputValidator(
            check_suspicious_patterns=True,
            max_string_length=100_000,
            max_nesting_depth=20,
        )

    async def connect(self) -> None:
        """Connect to MCP servers."""
        if not self._mcp_connected:
            await self.mcp_router.connect()
            self._mcp_connected = True

    async def connect_agentic(self) -> AgenticExecutor:
        """Connect the agentic executor for full LLM + Tool loops."""
        if not self._agentic_connected or self._agentic_executor is None:
            self._agentic_executor = AgenticExecutor(
                mcp_configs=self._mcp_servers,
                allowlist=self._tool_allowlist,
                max_iterations=int(os.getenv("AGENTIC_MAX_ITERATIONS", "10")),
            )
            await self._agentic_executor.connect()
            self._agentic_connected = True
            logger.info("Agentic executor connected")
        return self._agentic_executor

    async def disconnect(self) -> None:
        """Disconnect from MCP servers."""
        if self._mcp_connected:
            await self.mcp_router.disconnect()
            self._mcp_connected = False

        if self._agentic_connected and self._agentic_executor:
            await self._agentic_executor.disconnect()
            self._agentic_connected = False
            self._agentic_executor = None

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
                # Tool requires approval or validation error
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
                    # Validation or input error
                    logger.warning(f"Step {step_id} validation error: {e}")
                    await self.client.submit_step_result(
                        run_id=run_id,
                        step_id=step_id,
                        output={"error": str(e)},
                        status=StepStatus.FAILED,
                    )
                    span.set_attribute("step.status", "failed")

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
        """Execute an LLM step with tracing and retries.

        If MCP servers are configured and agentic_mode is enabled (default when
        servers exist), this runs a full agentic loop: LLM → Tool → LLM → ... → Response.
        Otherwise, performs a single LLM call.
        """
        model = step_input.get("model", "claude-sonnet-4-20250514")
        max_tokens = step_input.get("max_tokens", 4096)
        temperature = step_input.get("temperature", 0.7)

        # Extract task and system prompt
        task = step_input.get("task")
        system_prompt = step_input.get(
            "system_prompt",
            "You are a helpful AI assistant. Complete the requested task.",
        )

        logger.info(f"LLM step: task={task[:50] if task else None}... mcp_servers={len(self._mcp_servers)}")

        # Check if we should use agentic mode
        # Default to agentic when we have MCP servers configured
        agentic_mode = step_input.get("agentic_mode", len(self._mcp_servers) > 0)

        if agentic_mode and self._mcp_servers and task:
            # Use full agentic loop with tool support
            return await self._execute_agentic(
                task=task,
                system_prompt=system_prompt,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
                run_id=run_id,
                step_id=step_id,
            )

        # Fall back to simple LLM call (no tools)
        return await self._execute_llm_simple(
            step_input=step_input,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
            run_id=run_id,
            step_id=step_id,
        )

    async def _execute_agentic(
        self,
        task: str,
        system_prompt: str,
        model: str,
        max_tokens: int,
        temperature: float,
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        """Execute an agentic loop with tool support."""
        logger.info(f"Starting agentic execution for run={run_id} step={step_id}")

        # Connect agentic executor (lazy initialization)
        executor = await self.connect_agentic()

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
            # Run the agentic loop
            result = await executor.run(
                task=task,
                system_prompt=system_prompt,
                model=model,
                max_tokens=max_tokens,
                temperature=temperature,
            )

            # Set tracing attributes
            span.set_attribute("agentic.iterations", result.iterations)
            span.set_attribute("agentic.tool_calls_count", len(result.tool_calls_made))
            span.set_attribute("agentic.status", result.status)

            set_llm_response_attributes(
                span=span,
                model=model,
                finish_reason=result.status,
                input_tokens=result.total_usage.input_tokens,
                output_tokens=result.total_usage.output_tokens,
            )

            logger.info(
                f"Agentic execution completed: "
                f"iterations={result.iterations}, "
                f"tool_calls={len(result.tool_calls_made)}, "
                f"status={result.status}"
            )

            # Build detailed output including tool call history
            output = {
                "response": result.final_response,
                "tool_calls": result.tool_calls_made,
                "iterations": result.iterations,
                "status": result.status,
            }

            if result.error:
                output["error"] = result.error

            return {
                "output": output,
                "usage": {
                    "input_tokens": result.total_usage.input_tokens,
                    "output_tokens": result.total_usage.output_tokens,
                },
            }

    async def _execute_llm_simple(
        self,
        step_input: dict[str, Any],
        model: str,
        max_tokens: int,
        temperature: float,
        run_id: str,
        step_id: str,
    ) -> dict[str, Any]:
        """Execute a simple LLM call without tool support."""
        logger.info(f"Using simple LLM mode (no agentic). step_input keys: {list(step_input.keys())}")
        messages = step_input.get("messages", [])
        tools = step_input.get("tools")

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
                        {
                            "role": "user",
                            "content": f"Process this input: {json.dumps(step_input)}",
                        },
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

        # LLM02 Mitigation: Validate and sanitize tool call before execution
        validation_result = self.output_validator.validate_tool_call(tool_name, tool_input)
        if not validation_result.valid:
            logger.warning(f"Tool call validation failed: {validation_result.errors}")
            raise ValueError(f"Tool call validation failed: {validation_result.errors}")

        if validation_result.warnings:
            logger.warning(f"Tool call validation warnings: {validation_result.warnings}")

        # Use sanitized input from validation
        tool_input = validation_result.sanitized["tool_input"]

        # Check tool policy with control plane BEFORE execution
        # This raises PermissionError if denied, ValueError if requires approval
        logger.info(f"Checking policy for tool: {tool_name}")
        await self.client.check_tool_policy(run_id, tool_name)

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

        Supports multiple retrieval backends:
        - httpx: Remote retrieval API (default)
        - local: Simple keyword matching for testing

        Input schema:
        - query: str - The search query
        - collection: str - Collection/namespace to search
        - top_k: int - Number of results to return (default: 5)
        - backend: str - Retrieval backend ("httpx", "local")
        - endpoint: str - API endpoint for httpx backend
        """
        query = step_input.get("query", "")
        collection = step_input.get("collection", "default")
        top_k = step_input.get("top_k", 5)
        backend = step_input.get("backend", "httpx")
        endpoint = step_input.get("endpoint", os.getenv("RETRIEVAL_ENDPOINT"))

        if not query:
            raise ValueError("query is required for retrieval steps")

        logger.info(f"Retrieval query: {query[:50]}... (top_k={top_k}, backend={backend})")

        if backend == "httpx" and endpoint:
            # Remote retrieval via HTTP API
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.post(
                        endpoint,
                        json={
                            "query": query,
                            "collection": collection,
                            "top_k": top_k,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    return {
                        "output": {
                            "documents": data.get("documents", []),
                            "query": query,
                            "collection": collection,
                            "total_found": data.get("total", len(data.get("documents", []))),
                        },
                    }
            except httpx.HTTPError as e:
                logger.warning(f"Retrieval API error: {e}")
                return {
                    "output": {
                        "documents": [],
                        "query": query,
                        "collection": collection,
                        "error": str(e),
                    },
                }

        elif backend == "local":
            # Local keyword matching for testing/development
            documents = step_input.get("documents", [])
            query_lower = query.lower()

            # Simple keyword scoring
            scored_docs = []
            for doc in documents:
                content = doc.get("content", "").lower()
                score = sum(1 for word in query_lower.split() if word in content)
                if score > 0:
                    scored_docs.append((score, doc))

            scored_docs.sort(key=lambda x: x[0], reverse=True)
            top_docs = [doc for _, doc in scored_docs[:top_k]]

            return {
                "output": {
                    "documents": top_docs,
                    "query": query,
                    "collection": collection,
                    "total_found": len(top_docs),
                },
            }

        else:
            # No backend configured - return empty results
            logger.warning(f"No retrieval backend configured (backend={backend})")
            return {
                "output": {
                    "documents": [],
                    "query": query,
                    "collection": collection,
                    "message": "No retrieval backend configured",
                },
            }

    async def _execute_sandbox(self, step_input: dict[str, Any]) -> dict[str, Any]:
        """Execute code in a secure sandbox.

        Supports two modes:
        - subprocess: Direct Python subprocess (development only)
        - docker: Docker container isolation (production)

        Input schema:
        - code: str - The code to execute
        - language: str - Programming language (python, bash)
        - timeout_seconds: int - Execution timeout (default: 30)
        - mode: str - Execution mode ("subprocess", "docker")
        - env: dict - Environment variables to pass
        - files: dict - Files to create in working directory

        Security Notes:
        - Docker mode uses resource limits and network isolation
        - Subprocess mode should only be used in development
        """
        import asyncio
        import tempfile
        from pathlib import Path

        code = step_input.get("code", "")
        language = step_input.get("language", "python")
        timeout_seconds = step_input.get("timeout_seconds", 30)
        mode = step_input.get("mode", os.getenv("SANDBOX_MODE", "subprocess"))
        env = step_input.get("env", {})
        files = step_input.get("files", {})

        if not code:
            raise ValueError("code is required for sandbox steps")

        logger.info(f"Sandbox execution: {language} code ({len(code)} chars, mode={mode})")

        # Create temporary directory for execution
        with tempfile.TemporaryDirectory() as tmpdir:
            tmppath = Path(tmpdir)

            # Write any input files
            for filename, content in files.items():
                filepath = tmppath / filename
                filepath.parent.mkdir(parents=True, exist_ok=True)
                with filepath.open("w") as f:
                    f.write(content)

            # Write the code file
            if language == "python":
                code_file = tmppath / "script.py"
                cmd = ["python", str(code_file)]
            elif language == "bash":
                code_file = tmppath / "script.sh"
                cmd = ["bash", str(code_file)]
            else:
                raise ValueError(f"Unsupported language: {language}")

            with code_file.open("w") as f:
                f.write(code)

            if mode == "docker":
                # Docker-based isolation
                docker_image = step_input.get("docker_image", "python:3.12-slim")

                docker_cmd = [
                    "docker",
                    "run",
                    "--rm",
                    "--network=none",  # No network access
                    "--memory=256m",  # Memory limit
                    "--cpus=0.5",  # CPU limit
                    "--read-only",  # Read-only filesystem
                    "--tmpfs=/tmp:size=64m",  # Writable /tmp
                    "-v",
                    f"{tmpdir}:/work:ro",  # Mount code read-only
                    "-w",
                    "/work",
                ]

                # Add environment variables
                for key, value in env.items():
                    docker_cmd.extend(["-e", f"{key}={value}"])

                docker_cmd.extend([docker_image, *cmd])
                final_cmd = docker_cmd
            else:
                # Direct subprocess (development mode)
                final_cmd = cmd

            process = None
            try:
                process = await asyncio.create_subprocess_exec(
                    *final_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    cwd=tmpdir if mode != "docker" else None,
                    env={**os.environ, **env} if mode != "docker" else None,
                )

                stdout, stderr = await asyncio.wait_for(
                    process.communicate(),
                    timeout=timeout_seconds,
                )

                return {
                    "output": {
                        "status": "completed",
                        "exit_code": process.returncode,
                        "stdout": stdout.decode("utf-8", errors="replace"),
                        "stderr": stderr.decode("utf-8", errors="replace"),
                        "language": language,
                        "mode": mode,
                    },
                }

            except TimeoutError:
                # Kill the process on timeout
                if process is not None and process.returncode is None:
                    process.kill()
                    await process.wait()

                return {
                    "output": {
                        "status": "timeout",
                        "exit_code": -1,
                        "stdout": "",
                        "stderr": f"Execution timed out after {timeout_seconds} seconds",
                        "language": language,
                        "mode": mode,
                    },
                }

            except FileNotFoundError:
                if mode == "docker":
                    return {
                        "output": {
                            "status": "error",
                            "exit_code": -1,
                            "stdout": "",
                            "stderr": "Docker not available. Set SANDBOX_MODE=subprocess for development.",
                            "language": language,
                            "mode": mode,
                        },
                    }
                raise
