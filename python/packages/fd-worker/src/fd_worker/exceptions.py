"""Worker-specific exceptions.

This module provides a structured exception hierarchy for the fd-worker package.
All exceptions inherit from WorkerError for easy catching of worker-specific errors.
"""

from typing import Any


class WorkerError(Exception):
    """Base exception for all worker errors."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        self.message = message
        self.details = details or {}
        super().__init__(message)


class StepExecutionError(WorkerError):
    """Error during step execution."""

    def __init__(
        self,
        step_id: str,
        message: str,
        cause: Exception | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.step_id = step_id
        self.cause = cause
        super().__init__(f"Step {step_id} failed: {message}", details)


class PolicyDeniedError(WorkerError):
    """Tool call was denied by policy."""

    def __init__(self, tool_name: str, reason: str):
        self.tool_name = tool_name
        self.reason = reason
        super().__init__(
            f"Tool '{tool_name}' denied by policy: {reason}",
            {"tool_name": tool_name, "reason": reason},
        )


class ApprovalRequiredError(WorkerError):
    """Tool call requires human approval before execution."""

    def __init__(self, tool_name: str, approval_id: str | None = None):
        self.tool_name = tool_name
        self.approval_id = approval_id
        super().__init__(
            f"Tool '{tool_name}' requires approval",
            {"tool_name": tool_name, "approval_id": approval_id},
        )


class BudgetExceededError(WorkerError):
    """Run exceeded budget limits."""

    def __init__(
        self,
        budget_type: str,
        limit: int | float,
        current: int | float,
    ):
        self.budget_type = budget_type
        self.limit = limit
        self.current = current
        super().__init__(
            f"Budget exceeded for {budget_type}: {current}/{limit}",
            {"budget_type": budget_type, "limit": limit, "current": current},
        )


class TransientError(WorkerError):
    """Transient error that may succeed on retry.

    Examples: network timeouts, rate limits, temporary service unavailability.
    """

    def __init__(
        self,
        message: str,
        retry_after: float | None = None,
        details: dict[str, Any] | None = None,
    ):
        self.retry_after = retry_after
        super().__init__(message, details)


class LLMError(WorkerError):
    """Error during LLM API call."""

    def __init__(
        self,
        message: str,
        model: str | None = None,
        cause: Exception | None = None,
    ):
        self.model = model
        self.cause = cause
        super().__init__(message, {"model": model})


class LLMRateLimitError(TransientError, LLMError):
    """LLM API rate limit exceeded."""

    def __init__(
        self,
        model: str,
        retry_after: float | None = None,
    ):
        TransientError.__init__(
            self,
            f"Rate limit exceeded for model {model}",
            retry_after=retry_after,
        )
        self.model = model


class MCPError(WorkerError):
    """Error in MCP (Model Context Protocol) operations."""

    def __init__(
        self,
        message: str,
        server_name: str | None = None,
        tool_name: str | None = None,
    ):
        self.server_name = server_name
        self.tool_name = tool_name
        super().__init__(
            message,
            {"server_name": server_name, "tool_name": tool_name},
        )


class MCPConnectionError(MCPError, TransientError):
    """Failed to connect to MCP server."""

    def __init__(self, server_name: str, cause: Exception | None = None):
        self.cause = cause
        super().__init__(
            f"Failed to connect to MCP server: {server_name}",
            server_name=server_name,
        )


class MCPToolError(MCPError):
    """Error executing MCP tool."""

    def __init__(
        self,
        tool_name: str,
        server_name: str,
        error_message: str,
    ):
        super().__init__(
            f"Tool '{tool_name}' failed: {error_message}",
            server_name=server_name,
            tool_name=tool_name,
        )


class MCPToolTimeoutError(MCPError, TransientError):
    """MCP tool execution timed out."""

    def __init__(
        self,
        tool_name: str,
        server_name: str,
        timeout_seconds: float,
    ):
        self.timeout_seconds = timeout_seconds
        super().__init__(
            f"Tool '{tool_name}' timed out after {timeout_seconds}s",
            server_name=server_name,
            tool_name=tool_name,
        )


class QueueError(WorkerError):
    """Error in queue operations."""

    pass


class QueueConnectionError(QueueError, TransientError):
    """Failed to connect to message queue."""

    def __init__(self, message: str = "Failed to connect to Redis"):
        super().__init__(message)


class ValidationError(WorkerError):
    """Input or output validation failed."""

    def __init__(
        self,
        message: str,
        field: str | None = None,
        value: Any = None,
    ):
        self.field = field
        self.value = value
        super().__init__(message, {"field": field})
