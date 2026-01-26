# fd-dag

<!-- AUTO-MANAGED: module-description -->
## Purpose

DAG (Directed Acyclic Graph) scheduler for workflow orchestration. Manages step dependencies and execution ordering for multi-step agent workflows.

**Role**: Workflow orchestration - determines which steps can run in parallel and which must wait for dependencies.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-dag/src/
├── lib.rs          # DAG types and public API
└── scheduler.rs    # Scheduling logic
```

**Core Types**:
- `DagNode`: Individual step with dependencies
- `DagGraph`: Full workflow graph
- `ExecutionPlan`: Ordered list of executable steps

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### DAG Construction
```rust
let mut dag = DagGraph::new();
dag.add_node("step1", vec![]);           // No dependencies
dag.add_node("step2", vec!["step1"]);    // Depends on step1
dag.add_node("step3", vec!["step1"]);    // Depends on step1
dag.add_node("step4", vec!["step2", "step3"]); // Depends on both
```

### Scheduling
```rust
// Get next executable steps (dependencies satisfied)
let ready = dag.get_ready_steps(&completed_steps);

// Mark step as complete
dag.mark_complete("step1");
```

### Cycle Detection
- DAG validates no cycles on construction
- Returns error if circular dependency detected

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `serde` | Graph serialization |
| `thiserror` | Error types |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Execution Flow

1. Workflow definition parsed into `DagGraph`
2. Scheduler identifies steps with no dependencies
3. Ready steps enqueued to Redis
4. Worker executes and reports completion
5. Scheduler unlocks dependent steps
6. Repeat until all steps complete

## Error Handling

- Step failure can halt dependent steps
- Retry logic is handled by worker (not DAG)
- Partial failures preserved for debugging

<!-- END MANUAL -->
