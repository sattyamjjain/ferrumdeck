# FerrumDeck Documentation

Welcome to the FerrumDeck documentation. FerrumDeck is a production-grade platform for running agentic AI workflows with deterministic governance.

## Getting Started

- [Quick Start](../README.md#quick-start) - Get up and running in minutes
- [Architecture Overview](architecture/overview.md) - Understand the system design
- [Local Development](runbooks/local-dev.md) - Set up your development environment

## Core Concepts

### Control Plane (Rust)

The control plane is the source of truth for all governance, orchestration, and audit operations:

- **Gateway API**: HTTP endpoints for run management, registry access
- **Policy Engine**: Enforces tool allowlists, budgets, approval gates
- **Registry**: Stores versioned agents, tools, and prompts
- **Audit Log**: Immutable event trail for compliance

### Data Plane (Python)

The data plane executes agent steps with full observability:

- **Workers**: Queue consumers that execute steps
- **LLM Executor**: Unified LLM interface via litellm
- **MCP Router**: Deny-by-default tool execution
- **Sandbox**: Isolated code execution (future)

### Key Abstractions

| Concept | Description |
|---------|-------------|
| **Run** | A single execution of an agent workflow |
| **Step** | One unit of work (LLM call, tool invocation, etc.) |
| **Agent** | A configured persona with allowed tools and prompts |
| **Tool** | An external capability (via MCP or custom) |
| **Policy** | Rules governing what actions are allowed |

## Architecture

```
Clients → Gateway → Policy Engine → Run Orchestrator
                                          │
                                    Redis Queue
                                          │
                                    Python Worker
                                          │
                              ┌───────────┼───────────┐
                              │           │           │
                           LLM Call   Tool Call   Sandbox
```

## Security Model

FerrumDeck is designed with the assumption that **prompt injection cannot be fully prevented**. Instead, we focus on **containment**:

1. **Deny-by-default tools**: Only explicitly allowed tools can be called
2. **Budget enforcement**: Runs are killed when limits are exceeded
3. **Approval gates**: Sensitive actions require human approval
4. **Audit trail**: Every action is logged immutably

See [Threat Model](architecture/threat-model.md) for details.

## API Reference

- [OpenAPI Specification](../contracts/openapi/control-plane.openapi.yaml)
- [JSON Schemas](../contracts/jsonschema/)

## Development

- [Contributing](../CONTRIBUTING.md)
- [Architecture Decision Records](adr/)
- [Runbooks](runbooks/)

## Support

- [GitHub Issues](https://github.com/ferrumdeck/ferrumdeck/issues)
- [Discussions](https://github.com/ferrumdeck/ferrumdeck/discussions)
