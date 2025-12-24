//! DAG Scheduler for managing workflow execution state

use std::collections::{HashMap, HashSet};
use tracing::{debug, info, instrument, warn};

use crate::{DagError, StepDefinition, StepStatus, WorkflowDag};

/// Result of a step completion
#[derive(Debug, Clone)]
pub struct StepCompletionResult {
    /// Steps that are now ready to execute
    pub ready_steps: Vec<String>,
    /// Whether the workflow is complete
    pub workflow_complete: bool,
    /// Whether the workflow has failed
    pub workflow_failed: bool,
    /// Error message if failed
    pub error: Option<String>,
}

/// Scheduler for managing workflow DAG execution
#[derive(Debug)]
pub struct DagScheduler {
    /// The workflow DAG
    dag: WorkflowDag,
    /// Current status of each step
    step_status: HashMap<String, StepStatus>,
    /// Step outputs (for condition evaluation)
    step_outputs: HashMap<String, serde_json::Value>,
    /// On-error policy: "fail" or "continue"
    on_error: String,
    /// Maximum iterations (for loop detection)
    #[allow(dead_code)]
    max_iterations: u32,
    /// Current iteration count
    #[allow(dead_code)]
    iteration_count: u32,
}

impl DagScheduler {
    /// Create a new scheduler for a workflow DAG
    pub fn new(dag: WorkflowDag, on_error: &str, max_iterations: u32) -> Self {
        let step_status: HashMap<String, StepStatus> = dag
            .step_ids()
            .into_iter()
            .map(|id| (id.clone(), StepStatus::Pending))
            .collect();

        Self {
            dag,
            step_status,
            step_outputs: HashMap::new(),
            on_error: on_error.to_string(),
            max_iterations,
            iteration_count: 0,
        }
    }

    /// Build a scheduler from step definitions
    pub fn from_steps(
        steps: Vec<StepDefinition>,
        on_error: &str,
        max_iterations: u32,
    ) -> Result<Self, DagError> {
        let dag = WorkflowDag::build(steps)?;
        Ok(Self::new(dag, on_error, max_iterations))
    }

    /// Get the underlying DAG
    pub fn dag(&self) -> &WorkflowDag {
        &self.dag
    }

    /// Get current status of a step
    pub fn step_status(&self, step_id: &str) -> Option<StepStatus> {
        self.step_status.get(step_id).copied()
    }

    /// Get all step statuses
    pub fn all_step_status(&self) -> &HashMap<String, StepStatus> {
        &self.step_status
    }

    /// Get output of a completed step
    pub fn step_output(&self, step_id: &str) -> Option<&serde_json::Value> {
        self.step_outputs.get(step_id)
    }

    /// Get steps that are ready to execute
    #[instrument(skip(self))]
    pub fn get_ready_steps(&self) -> Vec<String> {
        let completed: HashSet<String> = self
            .step_status
            .iter()
            .filter(|(_, status)| status.is_successful())
            .map(|(id, _)| id.clone())
            .collect();

        let pending: HashSet<String> = self
            .step_status
            .iter()
            .filter(|(_, status)| **status == StepStatus::Pending)
            .map(|(id, _)| id.clone())
            .collect();

        let mut ready = Vec::new();
        for step_id in &pending {
            if let Some(step) = self.dag.get_step(step_id) {
                let all_deps_satisfied = step.depends_on.iter().all(|dep| completed.contains(dep));
                if all_deps_satisfied {
                    ready.push(step_id.clone());
                }
            }
        }

        debug!(ready_count = ready.len(), "Computed ready steps");
        ready
    }

    /// Get the initial steps to execute (entry points)
    pub fn get_initial_steps(&self) -> Vec<String> {
        self.dag.entry_points().to_vec()
    }

    /// Mark a step as running
    #[instrument(skip(self))]
    pub fn mark_running(&mut self, step_id: &str) -> Result<(), DagError> {
        if !self.step_status.contains_key(step_id) {
            return Err(DagError::StepNotFound(step_id.to_string()));
        }
        self.step_status.insert(step_id.to_string(), StepStatus::Running);
        debug!(step_id, "Marked step as running");
        Ok(())
    }

    /// Mark a step as completed and compute next steps
    #[instrument(skip(self, output))]
    pub fn complete_step(
        &mut self,
        step_id: &str,
        output: serde_json::Value,
    ) -> Result<StepCompletionResult, DagError> {
        if !self.step_status.contains_key(step_id) {
            return Err(DagError::StepNotFound(step_id.to_string()));
        }

        self.step_status.insert(step_id.to_string(), StepStatus::Completed);
        self.step_outputs.insert(step_id.to_string(), output);

        info!(step_id, "Step completed");

        // Compute ready steps
        let ready_steps = self.get_ready_steps();

        // Check if workflow is complete
        let all_terminal = self
            .step_status
            .values()
            .all(|status| status.is_terminal());

        let workflow_complete = all_terminal && ready_steps.is_empty();

        if workflow_complete {
            info!("Workflow completed successfully");
        }

        Ok(StepCompletionResult {
            ready_steps,
            workflow_complete,
            workflow_failed: false,
            error: None,
        })
    }

    /// Mark a step as failed and compute next steps based on on_error policy
    #[instrument(skip(self))]
    pub fn fail_step(
        &mut self,
        step_id: &str,
        error: &str,
    ) -> Result<StepCompletionResult, DagError> {
        if !self.step_status.contains_key(step_id) {
            return Err(DagError::StepNotFound(step_id.to_string()));
        }

        self.step_status.insert(step_id.to_string(), StepStatus::Failed);
        warn!(step_id, error, "Step failed");

        if self.on_error == "fail" {
            // Cancel all pending steps
            for (_id, status) in self.step_status.iter_mut() {
                if *status == StepStatus::Pending || *status == StepStatus::Ready {
                    *status = StepStatus::Cancelled;
                }
            }

            return Ok(StepCompletionResult {
                ready_steps: vec![],
                workflow_complete: false,
                workflow_failed: true,
                error: Some(format!("Step '{}' failed: {}", step_id, error)),
            });
        }

        // on_error == "continue": skip dependent steps and continue
        self.skip_dependents(step_id);

        let ready_steps = self.get_ready_steps();
        let all_terminal = self.step_status.values().all(|status| status.is_terminal());
        let workflow_complete = all_terminal && ready_steps.is_empty();

        Ok(StepCompletionResult {
            ready_steps,
            workflow_complete,
            workflow_failed: false,
            error: None,
        })
    }

    /// Skip a step (e.g., due to condition not met)
    #[instrument(skip(self))]
    pub fn skip_step(&mut self, step_id: &str) -> Result<StepCompletionResult, DagError> {
        if !self.step_status.contains_key(step_id) {
            return Err(DagError::StepNotFound(step_id.to_string()));
        }

        self.step_status.insert(step_id.to_string(), StepStatus::Skipped);
        debug!(step_id, "Step skipped");

        let ready_steps = self.get_ready_steps();
        let all_terminal = self.step_status.values().all(|status| status.is_terminal());
        let workflow_complete = all_terminal && ready_steps.is_empty();

        Ok(StepCompletionResult {
            ready_steps,
            workflow_complete,
            workflow_failed: false,
            error: None,
        })
    }

    /// Mark a step as waiting for approval
    pub fn mark_waiting_approval(&mut self, step_id: &str) -> Result<(), DagError> {
        if !self.step_status.contains_key(step_id) {
            return Err(DagError::StepNotFound(step_id.to_string()));
        }
        self.step_status.insert(step_id.to_string(), StepStatus::WaitingApproval);
        debug!(step_id, "Step waiting for approval");
        Ok(())
    }

    /// Resume a step after approval granted
    pub fn resume_after_approval(&mut self, step_id: &str) -> Result<(), DagError> {
        if !self.step_status.contains_key(step_id) {
            return Err(DagError::StepNotFound(step_id.to_string()));
        }
        self.step_status.insert(step_id.to_string(), StepStatus::Running);
        debug!(step_id, "Step resumed after approval");
        Ok(())
    }

    /// Skip all steps that depend on a failed step
    fn skip_dependents(&mut self, failed_step_id: &str) {
        let mut to_skip = vec![];
        let mut visited = HashSet::new();
        let mut queue = vec![failed_step_id.to_string()];

        while let Some(step_id) = queue.pop() {
            if visited.contains(&step_id) {
                continue;
            }
            visited.insert(step_id.clone());

            for child_id in self.dag.children(&step_id) {
                if !visited.contains(child_id) {
                    queue.push(child_id.clone());
                    to_skip.push(child_id.clone());
                }
            }
        }

        for step_id in to_skip {
            if let Some(status) = self.step_status.get_mut(&step_id) {
                if *status == StepStatus::Pending {
                    *status = StepStatus::Skipped;
                    debug!(step_id = %step_id, "Skipped dependent step");
                }
            }
        }
    }

    /// Evaluate a condition expression against step outputs
    #[instrument(skip(self))]
    pub fn evaluate_condition(&self, condition: &str) -> bool {
        // Simple condition evaluation
        // Format: $.step_id.field == value
        if condition.is_empty() {
            return true;
        }

        // Parse condition
        for (op_str, _) in &[("==", true), ("!=", true), (">=", true), ("<=", true)] {
            if let Some(idx) = condition.find(op_str) {
                let left = condition[..idx].trim();
                let right = condition[idx + op_str.len()..].trim();

                let left_val = self.resolve_path(left);
                let right_val = self.parse_literal(right);

                let result = match *op_str {
                    "==" => left_val == right_val,
                    "!=" => left_val != right_val,
                    _ => true, // For >= and <= we'd need numeric comparison
                };

                debug!(
                    condition,
                    ?left_val,
                    ?right_val,
                    result,
                    "Evaluated condition"
                );
                return result;
            }
        }

        true
    }

    /// Resolve a JSONPath-like expression
    fn resolve_path(&self, path: &str) -> Option<serde_json::Value> {
        if !path.starts_with("$.") {
            return Some(serde_json::Value::String(path.to_string()));
        }

        let parts: Vec<&str> = path[2..].split('.').collect();
        if parts.is_empty() {
            return None;
        }

        let step_id = parts[0];
        let output = self.step_outputs.get(step_id)?;

        let mut current = output.clone();
        for part in &parts[1..] {
            current = current.get(part)?.clone();
        }

        Some(current)
    }

    /// Parse a literal value
    fn parse_literal(&self, s: &str) -> Option<serde_json::Value> {
        let s = s.trim();

        if s == "true" {
            return Some(serde_json::Value::Bool(true));
        }
        if s == "false" {
            return Some(serde_json::Value::Bool(false));
        }
        if s == "null" {
            return Some(serde_json::Value::Null);
        }
        if let Ok(n) = s.parse::<i64>() {
            return Some(serde_json::Value::Number(n.into()));
        }
        if let Ok(f) = s.parse::<f64>() {
            return serde_json::Number::from_f64(f).map(serde_json::Value::Number);
        }
        if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
            return Some(serde_json::Value::String(s[1..s.len() - 1].to_string()));
        }

        Some(serde_json::Value::String(s.to_string()))
    }

    /// Check if workflow is complete (all steps terminal)
    pub fn is_complete(&self) -> bool {
        self.step_status.values().all(|s| s.is_terminal())
    }

    /// Check if workflow has failed
    pub fn has_failed(&self) -> bool {
        self.step_status.values().any(|s| *s == StepStatus::Failed)
    }

    /// Get a summary of step statuses
    pub fn status_summary(&self) -> HashMap<StepStatus, usize> {
        let mut summary = HashMap::new();
        for status in self.step_status.values() {
            *summary.entry(*status).or_insert(0) += 1;
        }
        summary
    }

    /// Get execution layers (for visualization)
    pub fn execution_layers(&self) -> Vec<Vec<String>> {
        self.dag.execution_layers()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::StepType;

    fn make_step(id: &str, depends_on: Vec<&str>) -> StepDefinition {
        StepDefinition {
            id: id.to_string(),
            name: id.to_string(),
            step_type: StepType::Llm,
            config: serde_json::json!({}),
            depends_on: depends_on.into_iter().map(String::from).collect(),
            condition: None,
            timeout_ms: 30000,
            retry: None,
        }
    }

    #[test]
    fn test_scheduler_basic_flow() {
        let steps = vec![
            make_step("a", vec![]),
            make_step("b", vec!["a"]),
            make_step("c", vec!["b"]),
        ];

        let mut scheduler = DagScheduler::from_steps(steps, "fail", 10).unwrap();

        // Initial state
        let ready = scheduler.get_ready_steps();
        assert_eq!(ready, vec!["a"]);

        // Mark a running
        scheduler.mark_running("a").unwrap();
        assert_eq!(scheduler.step_status("a"), Some(StepStatus::Running));

        // Complete a
        let result = scheduler
            .complete_step("a", serde_json::json!({"done": true}))
            .unwrap();
        assert_eq!(result.ready_steps, vec!["b"]);
        assert!(!result.workflow_complete);

        // Complete b
        scheduler.mark_running("b").unwrap();
        let result = scheduler
            .complete_step("b", serde_json::json!({}))
            .unwrap();
        assert_eq!(result.ready_steps, vec!["c"]);
        assert!(!result.workflow_complete);

        // Complete c
        scheduler.mark_running("c").unwrap();
        let result = scheduler.complete_step("c", serde_json::json!({})).unwrap();
        assert!(result.ready_steps.is_empty());
        assert!(result.workflow_complete);
    }

    #[test]
    fn test_scheduler_fail_policy() {
        let steps = vec![
            make_step("a", vec![]),
            make_step("b", vec!["a"]),
            make_step("c", vec!["a"]),
        ];

        let mut scheduler = DagScheduler::from_steps(steps, "fail", 10).unwrap();

        scheduler.mark_running("a").unwrap();
        let result = scheduler.fail_step("a", "test error").unwrap();

        assert!(result.workflow_failed);
        assert!(result.ready_steps.is_empty());
        assert_eq!(scheduler.step_status("b"), Some(StepStatus::Cancelled));
        assert_eq!(scheduler.step_status("c"), Some(StepStatus::Cancelled));
    }

    #[test]
    fn test_scheduler_continue_policy() {
        let steps = vec![
            make_step("a", vec![]),
            make_step("b", vec!["a"]),
            make_step("c", vec![]),  // Independent step
        ];

        let mut scheduler = DagScheduler::from_steps(steps, "continue", 10).unwrap();

        scheduler.mark_running("a").unwrap();
        let result = scheduler.fail_step("a", "test error").unwrap();

        assert!(!result.workflow_failed);
        // c should still be ready since it doesn't depend on a
        assert_eq!(result.ready_steps, vec!["c"]);
        // b should be skipped since it depends on failed a
        assert_eq!(scheduler.step_status("b"), Some(StepStatus::Skipped));
    }

    #[test]
    fn test_scheduler_parallel_execution() {
        let steps = vec![
            make_step("init", vec![]),
            make_step("a", vec!["init"]),
            make_step("b", vec!["init"]),
            make_step("c", vec!["init"]),
            make_step("final", vec!["a", "b", "c"]),
        ];

        let mut scheduler = DagScheduler::from_steps(steps, "fail", 10).unwrap();

        // Complete init
        scheduler.mark_running("init").unwrap();
        let result = scheduler.complete_step("init", serde_json::json!({})).unwrap();

        // a, b, c should all be ready (fanout)
        let mut ready = result.ready_steps.clone();
        ready.sort();
        assert_eq!(ready, vec!["a", "b", "c"]);

        // Complete a, b, c
        for step in ["a", "b", "c"] {
            scheduler.mark_running(step).unwrap();
            scheduler.complete_step(step, serde_json::json!({})).unwrap();
        }

        // final should now be ready (fanin)
        let ready = scheduler.get_ready_steps();
        assert_eq!(ready, vec!["final"]);
    }
}
