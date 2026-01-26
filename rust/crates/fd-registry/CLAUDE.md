# fd-registry

<!-- AUTO-MANAGED: module-description -->
## Purpose

Version-controlled registry for agents, tools, and prompts. Supports semantic versioning and immutable version history.

**Role**: Configuration management - defines what agents and tools are available and their capabilities.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-registry/src/
├── lib.rs          # Public exports
├── agent.rs        # Agent definitions and versioning
├── tool.rs         # Tool definitions and schemas
└── version.rs      # Semantic version utilities
```

**Registry Entities**:
- **Agent**: Name, system prompt, allowed tools, budget limits
- **AgentVersion**: Immutable snapshot of agent config
- **Tool**: Name, MCP server, input schema, policies

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Agent Definition
```rust
pub struct Agent {
    pub id: AgentId,
    pub name: String,
    pub system_prompt: String,
    pub allowed_tools: Vec<String>,
    pub budget_limit: Option<Decimal>,
    pub active_version: Option<String>,
}
```

### Tool Schema
```rust
pub struct Tool {
    pub id: ToolId,
    pub name: String,          // e.g., "github.create_pr"
    pub server: String,        // MCP server name
    pub input_schema: Value,   // JSON Schema
    pub requires_approval: bool,
}
```

### Versioning
- Uses semver format: `1.0.0`, `1.1.0`, etc.
- Versions are immutable once created
- `active_version` points to current production version

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `serde_json` | Schema storage |
| `fd-core` | Typed IDs |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## API Examples

### Register New Agent
```bash
curl -X POST http://localhost:8080/api/v1/agents \
  -d '{"name": "pr-reviewer", "system_prompt": "...", "allowed_tools": ["github.*"]}'
```

### Create Agent Version
```bash
curl -X POST http://localhost:8080/api/v1/agents/agt_xxx/versions \
  -d '{"version": "1.0.0"}'
```

<!-- END MANUAL -->
