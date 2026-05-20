# Policy-decision regression fixtures

Drop a JSON file in this directory to extend the regression gate. Each
fixture is a single decision the policy engine is expected to make.

Schema:

```json
{
  "name": "human-readable label printed on assertion failure",
  "tool_name": "name passed to PolicyEngine::evaluate_tool_call",
  "expected_decision": "allow" | "deny" | "requires_approval",
  "expected_reason_contains": "substring expected in decision.reason, or null"
}
```

The engine under test is configured by
`rust/crates/fd-policy/tests/policy_regression.rs`. Update the allowlist in
that file when you add tools that aren't already on it. Run the gate with:

```
cargo test -p fd-policy --test policy_regression
```
