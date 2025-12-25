//! DAG Scheduler for Workflow Orchestration
//!
//! Provides deterministic workflow execution with:
//! - Topological sorting for step ordering
//! - Cycle detection
//! - Dependency resolution
//! - Fanout/fanin pattern support
//! - Ready step computation

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use thiserror::Error;
use tracing::{debug, instrument};

mod scheduler;

pub use scheduler::{DagScheduler, SchedulerState, StepCompletionResult};

/// DAG-related errors
#[derive(Debug, Error)]
pub enum DagError {
    #[error("Cycle detected in workflow DAG: {0}")]
    CycleDetected(String),

    #[error("Missing dependency: step '{step}' depends on '{dependency}' which does not exist")]
    MissingDependency { step: String, dependency: String },

    #[error("No entry points found in workflow (all steps have dependencies)")]
    NoEntryPoints,

    #[error("Step not found: {0}")]
    StepNotFound(String),

    #[error("Invalid step configuration: {0}")]
    InvalidConfiguration(String),
}

/// Step type in workflow
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Llm,
    Tool,
    Condition,
    Loop,
    Parallel,
    Approval,
}

impl std::fmt::Display for StepType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StepType::Llm => write!(f, "llm"),
            StepType::Tool => write!(f, "tool"),
            StepType::Condition => write!(f, "condition"),
            StepType::Loop => write!(f, "loop"),
            StepType::Parallel => write!(f, "parallel"),
            StepType::Approval => write!(f, "approval"),
        }
    }
}

/// Step definition in a workflow DAG
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepDefinition {
    /// Unique step identifier
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Type of step
    #[serde(rename = "type")]
    pub step_type: StepType,
    /// Step configuration (model, prompt, tool name, etc.)
    #[serde(default)]
    pub config: serde_json::Value,
    /// List of step IDs this step depends on
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Optional condition expression for conditional execution
    #[serde(default)]
    pub condition: Option<String>,
    /// Timeout in milliseconds
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    /// Retry configuration
    #[serde(default)]
    pub retry: Option<RetryConfig>,
}

fn default_timeout() -> u64 {
    30000
}

/// Retry configuration for a step
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    #[serde(default = "default_max_attempts")]
    pub max_attempts: u32,
    #[serde(default = "default_delay_ms")]
    pub delay_ms: u64,
    #[serde(default = "default_backoff_multiplier")]
    pub backoff_multiplier: f64,
}

fn default_max_attempts() -> u32 {
    3
}

fn default_delay_ms() -> u64 {
    1000
}

fn default_backoff_multiplier() -> f64 {
    2.0
}

/// Step execution status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Ready,
    Running,
    Completed,
    Failed,
    Skipped,
    WaitingApproval,
    Cancelled,
}

impl StepStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            StepStatus::Completed | StepStatus::Failed | StepStatus::Skipped | StepStatus::Cancelled
        )
    }

    pub fn is_successful(&self) -> bool {
        matches!(self, StepStatus::Completed | StepStatus::Skipped)
    }
}

/// Workflow DAG representation
#[derive(Debug, Clone)]
pub struct WorkflowDag {
    /// All steps indexed by ID
    steps: HashMap<String, StepDefinition>,
    /// Adjacency list: step_id -> list of steps that depend on it (children)
    children: HashMap<String, Vec<String>>,
    /// Reverse adjacency: step_id -> list of steps it depends on (parents)
    parents: HashMap<String, Vec<String>>,
    /// Steps with no dependencies (entry points)
    entry_points: Vec<String>,
    /// Topologically sorted order
    topological_order: Vec<String>,
}

impl WorkflowDag {
    /// Build a DAG from a list of step definitions
    #[instrument(skip(steps))]
    pub fn build(steps: Vec<StepDefinition>) -> Result<Self, DagError> {
        let mut step_map: HashMap<String, StepDefinition> = HashMap::new();
        let mut children: HashMap<String, Vec<String>> = HashMap::new();
        let mut parents: HashMap<String, Vec<String>> = HashMap::new();

        // Index steps
        for step in steps {
            children.insert(step.id.clone(), Vec::new());
            parents.insert(step.id.clone(), step.depends_on.clone());
            step_map.insert(step.id.clone(), step);
        }

        // Validate dependencies and build adjacency lists
        for (step_id, step) in &step_map {
            for dep in &step.depends_on {
                if !step_map.contains_key(dep) {
                    return Err(DagError::MissingDependency {
                        step: step_id.clone(),
                        dependency: dep.clone(),
                    });
                }
                children.get_mut(dep).unwrap().push(step_id.clone());
            }
        }

        // Compute topological order using Kahn's algorithm
        // This will detect cycles (including the case where all nodes are in a cycle,
        // which results in no entry points)
        let topological_order = Self::topological_sort(&step_map, &children)?;

        // Find entry points (steps with no dependencies)
        let entry_points: Vec<String> = step_map
            .iter()
            .filter(|(_, s)| s.depends_on.is_empty())
            .map(|(id, _)| id.clone())
            .collect();

        // If topological sort succeeded but there are no entry points, something is wrong
        // (This shouldn't happen in practice if topological sort worked)
        if entry_points.is_empty() && !step_map.is_empty() {
            return Err(DagError::NoEntryPoints);
        }

        debug!(
            steps = step_map.len(),
            entry_points = entry_points.len(),
            "Built workflow DAG"
        );

        Ok(Self {
            steps: step_map,
            children,
            parents,
            entry_points,
            topological_order,
        })
    }

    /// Topological sort using Kahn's algorithm
    fn topological_sort(
        steps: &HashMap<String, StepDefinition>,
        children: &HashMap<String, Vec<String>>,
    ) -> Result<Vec<String>, DagError> {
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut order: Vec<String> = Vec::new();

        // Initialize in-degrees
        for (id, step) in steps {
            in_degree.insert(id.clone(), step.depends_on.len());
            if step.depends_on.is_empty() {
                queue.push_back(id.clone());
            }
        }

        while let Some(step_id) = queue.pop_front() {
            order.push(step_id.clone());

            if let Some(deps) = children.get(&step_id) {
                for child_id in deps {
                    if let Some(deg) = in_degree.get_mut(child_id) {
                        *deg -= 1;
                        if *deg == 0 {
                            queue.push_back(child_id.clone());
                        }
                    }
                }
            }
        }

        // Check for cycles
        if order.len() != steps.len() {
            // Find steps involved in cycle
            let in_order: HashSet<_> = order.iter().collect();
            let cycle_steps: Vec<_> = steps
                .keys()
                .filter(|k| !in_order.contains(k))
                .cloned()
                .collect();
            return Err(DagError::CycleDetected(cycle_steps.join(", ")));
        }

        Ok(order)
    }

    /// Get step definition by ID
    pub fn get_step(&self, id: &str) -> Option<&StepDefinition> {
        self.steps.get(id)
    }

    /// Get all step IDs
    pub fn step_ids(&self) -> Vec<&String> {
        self.steps.keys().collect()
    }

    /// Get entry points (steps with no dependencies)
    pub fn entry_points(&self) -> &[String] {
        &self.entry_points
    }

    /// Get the topologically sorted order
    pub fn topological_order(&self) -> &[String] {
        &self.topological_order
    }

    /// Get children (dependent steps) of a step
    pub fn children(&self, step_id: &str) -> &[String] {
        self.children.get(step_id).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Get parents (dependencies) of a step
    pub fn parents(&self, step_id: &str) -> &[String] {
        self.parents.get(step_id).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Compute execution layers (steps that can run in parallel)
    pub fn execution_layers(&self) -> Vec<Vec<String>> {
        let mut layers: Vec<Vec<String>> = Vec::new();
        let mut completed: HashSet<String> = HashSet::new();
        let mut remaining: HashSet<String> = self.steps.keys().cloned().collect();

        while !remaining.is_empty() {
            // Find all steps whose dependencies are all satisfied
            let ready: Vec<String> = remaining
                .iter()
                .filter(|id| {
                    self.parents
                        .get(*id)
                        .map(|deps| deps.iter().all(|d| completed.contains(d)))
                        .unwrap_or(true)
                })
                .cloned()
                .collect();

            if ready.is_empty() {
                // Should not happen if topological sort succeeded
                break;
            }

            for id in &ready {
                remaining.remove(id);
                completed.insert(id.clone());
            }

            layers.push(ready);
        }

        layers
    }

    /// Get the number of steps
    pub fn len(&self) -> usize {
        self.steps.len()
    }

    /// Check if DAG is empty
    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }
}

/// Compute steps that are ready to execute given completed steps
#[instrument(skip(dag, completed_steps))]
pub fn compute_ready_steps(dag: &WorkflowDag, completed_steps: &HashSet<String>) -> Vec<String> {
    let mut ready = Vec::new();

    for (step_id, step) in &dag.steps {
        // Skip already completed steps
        if completed_steps.contains(step_id) {
            continue;
        }

        // Check if all dependencies are satisfied
        let all_deps_satisfied = step.depends_on.iter().all(|dep| completed_steps.contains(dep));

        if all_deps_satisfied {
            ready.push(step_id.clone());
        }
    }

    debug!(ready_count = ready.len(), "Computed ready steps");
    ready
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn test_simple_dag() {
        let steps = vec![
            make_step("a", vec![]),
            make_step("b", vec!["a"]),
            make_step("c", vec!["a"]),
            make_step("d", vec!["b", "c"]),
        ];

        let dag = WorkflowDag::build(steps).unwrap();

        assert_eq!(dag.entry_points(), &["a"]);
        assert_eq!(dag.len(), 4);

        // Check topological order - a must come before b, c; b and c before d
        let order = dag.topological_order();
        let pos = |s: &str| order.iter().position(|x| x == s).unwrap();
        assert!(pos("a") < pos("b"));
        assert!(pos("a") < pos("c"));
        assert!(pos("b") < pos("d"));
        assert!(pos("c") < pos("d"));
    }

    #[test]
    fn test_parallel_steps() {
        let steps = vec![
            make_step("init", vec![]),
            make_step("a", vec!["init"]),
            make_step("b", vec!["init"]),
            make_step("c", vec!["init"]),
            make_step("final", vec!["a", "b", "c"]),
        ];

        let dag = WorkflowDag::build(steps).unwrap();
        let layers = dag.execution_layers();

        assert_eq!(layers.len(), 3);
        assert_eq!(layers[0], vec!["init"]);
        assert!(layers[1].contains(&"a".to_string()));
        assert!(layers[1].contains(&"b".to_string()));
        assert!(layers[1].contains(&"c".to_string()));
        assert_eq!(layers[2], vec!["final"]);
    }

    #[test]
    fn test_cycle_detection() {
        let steps = vec![
            make_step("a", vec!["c"]),
            make_step("b", vec!["a"]),
            make_step("c", vec!["b"]),
        ];

        let result = WorkflowDag::build(steps);
        assert!(matches!(result, Err(DagError::CycleDetected(_))));
    }

    #[test]
    fn test_missing_dependency() {
        let steps = vec![make_step("a", vec!["nonexistent"])];

        let result = WorkflowDag::build(steps);
        assert!(matches!(result, Err(DagError::MissingDependency { .. })));
    }

    #[test]
    fn test_ready_steps() {
        let steps = vec![
            make_step("a", vec![]),
            make_step("b", vec!["a"]),
            make_step("c", vec!["a"]),
            make_step("d", vec!["b", "c"]),
        ];

        let dag = WorkflowDag::build(steps).unwrap();

        // Initially only a is ready
        let ready = compute_ready_steps(&dag, &HashSet::new());
        assert_eq!(ready, vec!["a"]);

        // After a completes, b and c are ready
        let completed: HashSet<_> = ["a".to_string()].into_iter().collect();
        let mut ready = compute_ready_steps(&dag, &completed);
        ready.sort();
        assert_eq!(ready, vec!["b", "c"]);

        // After a, b complete, only c is ready (d needs c too)
        let completed: HashSet<_> = ["a".to_string(), "b".to_string()].into_iter().collect();
        let ready = compute_ready_steps(&dag, &completed);
        assert_eq!(ready, vec!["c"]);

        // After a, b, c complete, d is ready
        let completed: HashSet<_> = ["a", "b", "c"].into_iter().map(String::from).collect();
        let ready = compute_ready_steps(&dag, &completed);
        assert_eq!(ready, vec!["d"]);
    }
}
