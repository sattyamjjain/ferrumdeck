"""FerrumDeck - AgentOps Control Plane.

This is the workspace root package. Actual implementations are in:
- fd-runtime: Agent execution primitives
- fd-worker: Queue consumer and step execution
- fd-mcp-router: Deny-by-default MCP tool router
- fd-evals: Evaluation harness

This is the workspace-root umbrella; it tracks the Rust workspace version (kept
in sync with root Cargo.toml by the `version-release-consistency` CI check). It
is installable from source only — not published to PyPI.
"""

__version__ = "0.8.0"
