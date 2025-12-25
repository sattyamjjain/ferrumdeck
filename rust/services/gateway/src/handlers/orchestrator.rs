//! Workflow DAG Orchestrator
//!
//! Manages the execution of workflow steps using the DAG scheduler.
//! Handles step completion callbacks and triggers dependent steps.
//!
//! Note: This module is implemented but not yet wired into handlers.
//! It will be integrated in a future phase.

#![allow(dead_code)]

use fd_dag::{
    DagScheduler, SchedulerState, StepCompletionResult, StepDefinition,
    StepStatus as DagStepStatus, StepType as DagStepType, WorkflowDag,
};
use fd_storage::models::{
    CreateWorkflowStepExecution, UpdateWorkflowRun, UpdateWorkflowStepExecution, WorkflowRunStatus,
    WorkflowStepExecutionStatus, WorkflowStepType,
};
use fd_storage::queue::{JobContext, QueueMessage, StepJob};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, instrument, warn};
use ulid::Ulid;

use super::ApiError;
use crate::state::{AppState, Repos};

/// In-memory cache of active workflow schedulers
type SchedulerCache = Arc<RwLock<HashMap<String, DagScheduler>>>;

/// Workflow orchestrator that manages DAG execution
#[derive(Clone)]
pub struct WorkflowOrchestrator {
    state: AppState,
    schedulers: SchedulerCache,
}

impl WorkflowOrchestrator {
    /// Create a new orchestrator
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            schedulers: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    fn repos(&self) -> &Repos {
        self.state.repos()
    }

    /// Start a workflow run
    #[instrument(skip(self, input))]
    pub async fn start_workflow(
        &self,
        run_id: &str,
        workflow_id: &str,
        project_id: &str,
        tenant_id: &str,
        input: serde_json::Value,
    ) -> Result<Vec<String>, ApiError> {
        // Get workflow definition
        let workflow = self
            .repos()
            .workflows()
            .get(workflow_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Workflow", workflow_id))?;

        // Parse steps from workflow definition
        let steps = self.parse_workflow_steps(&workflow.definition)?;

        // Build DAG and create scheduler
        let dag = WorkflowDag::build(steps.clone())
            .map_err(|e| ApiError::bad_request(format!("Invalid workflow DAG: {}", e)))?;

        let scheduler = DagScheduler::new(dag, &workflow.on_error, workflow.max_iterations as u32);

        // Get initial steps
        let initial_steps = scheduler.get_initial_steps();

        if initial_steps.is_empty() {
            return Err(ApiError::bad_request(
                "Workflow has no entry points (all steps have dependencies)",
            ));
        }

        // Store scheduler
        {
            let mut cache = self.schedulers.write().await;
            cache.insert(run_id.to_string(), scheduler);
        }

        // Create step executions and enqueue jobs for initial steps
        for step_id in &initial_steps {
            if let Some(step) = steps.iter().find(|s| &s.id == step_id) {
                self.create_and_enqueue_step(run_id, step, project_id, tenant_id, &input)
                    .await?;
            }
        }

        // Update run status to running
        self.repos()
            .workflows()
            .update_run_status(run_id, WorkflowRunStatus::Running)
            .await?;

        info!(
            run_id,
            workflow_id,
            initial_steps_count = initial_steps.len(),
            "Started workflow"
        );

        Ok(initial_steps)
    }

    /// Handle step completion and trigger dependent steps
    #[instrument(skip(self, output))]
    pub async fn complete_step(
        &self,
        run_id: &str,
        step_id: &str,
        execution_id: &str,
        output: serde_json::Value,
        input_tokens: Option<i32>,
        output_tokens: Option<i32>,
    ) -> Result<StepCompletionResult, ApiError> {
        // Ensure scheduler is available (restore from DB if needed)
        self.get_or_restore_scheduler(run_id).await?;

        // Get scheduler
        let result = {
            let mut cache = self.schedulers.write().await;
            let scheduler = cache
                .get_mut(run_id)
                .ok_or_else(|| ApiError::internal("Scheduler not found after restore"))?;

            scheduler
                .complete_step(step_id, output.clone())
                .map_err(|e| ApiError::internal(format!("DAG error: {}", e)))?
        };

        // Update step execution in DB
        self.repos()
            .workflows()
            .update_step_execution(
                execution_id,
                UpdateWorkflowStepExecution {
                    status: Some(WorkflowStepExecutionStatus::Completed),
                    output: Some(output.clone()),
                    input_tokens,
                    output_tokens,
                    completed_at: Some(chrono::Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        // Update run step results
        self.repos()
            .workflows()
            .update_run_step_results(run_id, step_id, output.clone())
            .await?;

        // Update run usage
        if let (Some(in_tok), Some(out_tok)) = (input_tokens, output_tokens) {
            self.repos()
                .workflows()
                .increment_run_usage(run_id, in_tok, out_tok, 0, 0)
                .await?;
        }

        // Handle workflow completion or continuation
        if result.workflow_complete {
            self.complete_workflow(run_id, Some(output)).await?;
        } else if result.workflow_failed {
            self.fail_workflow(run_id, result.error.as_deref().unwrap_or("Unknown error"))
                .await?;
        } else {
            // Enqueue ready steps
            self.enqueue_ready_steps(run_id, &result.ready_steps)
                .await?;
        }

        info!(
            run_id,
            step_id,
            ready_steps = ?result.ready_steps,
            workflow_complete = result.workflow_complete,
            "Step completed"
        );

        Ok(result)
    }

    /// Handle step failure
    #[instrument(skip(self))]
    pub async fn fail_step(
        &self,
        run_id: &str,
        step_id: &str,
        execution_id: &str,
        error: &str,
    ) -> Result<StepCompletionResult, ApiError> {
        // Ensure scheduler is available (restore from DB if needed)
        self.get_or_restore_scheduler(run_id).await?;

        // Get scheduler and handle failure
        let result = {
            let mut cache = self.schedulers.write().await;
            let scheduler = cache
                .get_mut(run_id)
                .ok_or_else(|| ApiError::internal("Scheduler not found after restore"))?;

            scheduler
                .fail_step(step_id, error)
                .map_err(|e| ApiError::internal(format!("DAG error: {}", e)))?
        };

        // Update step execution in DB
        self.repos()
            .workflows()
            .update_step_execution(
                execution_id,
                UpdateWorkflowStepExecution {
                    status: Some(WorkflowStepExecutionStatus::Failed),
                    error: Some(serde_json::json!({ "message": error })),
                    completed_at: Some(chrono::Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        // Handle workflow failure or continuation
        if result.workflow_failed {
            self.fail_workflow(run_id, error).await?;
        } else if result.workflow_complete {
            // Workflow complete with some failures (continue policy)
            self.complete_workflow(run_id, None).await?;
        } else {
            // Continue with ready steps
            self.enqueue_ready_steps(run_id, &result.ready_steps)
                .await?;
        }

        warn!(
            run_id,
            step_id,
            error,
            workflow_failed = result.workflow_failed,
            "Step failed"
        );

        Ok(result)
    }

    /// Skip a step (e.g., condition not met)
    #[instrument(skip(self))]
    pub async fn skip_step(
        &self,
        run_id: &str,
        step_id: &str,
        execution_id: &str,
        reason: &str,
    ) -> Result<StepCompletionResult, ApiError> {
        // Ensure scheduler is available (restore from DB if needed)
        self.get_or_restore_scheduler(run_id).await?;

        let result = {
            let mut cache = self.schedulers.write().await;
            let scheduler = cache
                .get_mut(run_id)
                .ok_or_else(|| ApiError::internal("Scheduler not found after restore"))?;

            scheduler
                .skip_step(step_id)
                .map_err(|e| ApiError::internal(format!("DAG error: {}", e)))?
        };

        // Update step execution in DB
        self.repos()
            .workflows()
            .update_step_execution(
                execution_id,
                UpdateWorkflowStepExecution {
                    status: Some(WorkflowStepExecutionStatus::Skipped),
                    output: Some(serde_json::json!({ "skipped": true, "reason": reason })),
                    completed_at: Some(chrono::Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        if result.workflow_complete {
            self.complete_workflow(run_id, None).await?;
        } else {
            self.enqueue_ready_steps(run_id, &result.ready_steps)
                .await?;
        }

        debug!(run_id, step_id, reason, "Step skipped");

        Ok(result)
    }

    /// Mark step as waiting for approval
    pub async fn mark_waiting_approval(
        &self,
        run_id: &str,
        step_id: &str,
        execution_id: &str,
    ) -> Result<(), ApiError> {
        // Ensure scheduler is available (restore from DB if needed)
        self.get_or_restore_scheduler(run_id).await?;

        {
            let mut cache = self.schedulers.write().await;
            let scheduler = cache
                .get_mut(run_id)
                .ok_or_else(|| ApiError::internal("Scheduler not found after restore"))?;

            scheduler
                .mark_waiting_approval(step_id)
                .map_err(|e| ApiError::internal(format!("DAG error: {}", e)))?;
        }

        // Update step execution
        self.repos()
            .workflows()
            .update_step_execution(
                execution_id,
                UpdateWorkflowStepExecution {
                    status: Some(WorkflowStepExecutionStatus::WaitingApproval),
                    ..Default::default()
                },
            )
            .await?;

        // Update run status
        self.repos()
            .workflows()
            .update_run(
                run_id,
                UpdateWorkflowRun {
                    status: Some(WorkflowRunStatus::WaitingApproval),
                    current_step_id: Some(step_id.to_string()),
                    ..Default::default()
                },
            )
            .await?;

        info!(run_id, step_id, "Step waiting for approval");

        Ok(())
    }

    /// Get execution layers for a workflow run (for visualization)
    pub async fn get_execution_layers(&self, run_id: &str) -> Result<Vec<Vec<String>>, ApiError> {
        // Ensure scheduler is available (restore from DB if needed)
        self.get_or_restore_scheduler(run_id).await?;

        let cache = self.schedulers.read().await;
        let scheduler = cache
            .get(run_id)
            .ok_or_else(|| ApiError::internal("Scheduler not found after restore"))?;

        Ok(scheduler.execution_layers())
    }

    /// Clean up scheduler for completed run
    pub async fn cleanup(&self, run_id: &str) {
        let mut cache = self.schedulers.write().await;
        cache.remove(run_id);
        debug!(run_id, "Cleaned up scheduler");
    }

    /// Get or restore scheduler for a workflow run
    /// This enables surviving gateway restarts by reconstructing scheduler from DB
    async fn get_or_restore_scheduler(&self, run_id: &str) -> Result<(), ApiError> {
        // Check if already in cache
        {
            let cache = self.schedulers.read().await;
            if cache.contains_key(run_id) {
                return Ok(());
            }
        }

        // Restore from database
        let run = self
            .repos()
            .workflows()
            .get_run(run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("WorkflowRun", run_id))?;

        // Skip if terminal
        if run.status.is_terminal() {
            return Err(ApiError::bad_request(format!(
                "Workflow run is already terminal: {:?}",
                run.status
            )));
        }

        // Get workflow definition
        let workflow = self
            .repos()
            .workflows()
            .get(&run.workflow_id)
            .await?
            .ok_or_else(|| ApiError::internal("Workflow not found for run"))?;

        // Parse steps and build DAG
        let steps = self.parse_workflow_steps(&workflow.definition)?;
        let dag = WorkflowDag::build(steps)
            .map_err(|e| ApiError::bad_request(format!("Invalid workflow DAG: {}", e)))?;

        // Get step executions to restore state
        let executions = self
            .repos()
            .workflows()
            .list_step_executions_by_run(run_id)
            .await?;

        // Build scheduler state from executions
        let mut step_status = std::collections::HashMap::new();
        let mut step_outputs = std::collections::HashMap::new();

        // Initialize all steps as pending
        for step_id in dag.step_ids() {
            step_status.insert(step_id.clone(), DagStepStatus::Pending);
        }

        // Update from executions
        for exec in executions {
            let status = match exec.status {
                WorkflowStepExecutionStatus::Pending => DagStepStatus::Pending,
                WorkflowStepExecutionStatus::Running => DagStepStatus::Running,
                WorkflowStepExecutionStatus::WaitingApproval => DagStepStatus::WaitingApproval,
                WorkflowStepExecutionStatus::Completed => DagStepStatus::Completed,
                WorkflowStepExecutionStatus::Failed => DagStepStatus::Failed,
                WorkflowStepExecutionStatus::Skipped => DagStepStatus::Skipped,
                WorkflowStepExecutionStatus::Retrying => DagStepStatus::Running,
            };
            step_status.insert(exec.step_id.clone(), status);
            if let Some(output) = exec.output {
                step_outputs.insert(exec.step_id, output);
            }
        }

        let state = SchedulerState {
            step_status,
            step_outputs,
            on_error: workflow.on_error,
            max_iterations: workflow.max_iterations as u32,
            iteration_count: 0,
        };

        let scheduler = DagScheduler::from_dag_with_state(dag, state);

        // Store in cache
        {
            let mut cache = self.schedulers.write().await;
            cache.insert(run_id.to_string(), scheduler);
        }

        info!(run_id, "Restored scheduler from database");
        Ok(())
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /// Parse workflow steps from JSON definition
    fn parse_workflow_steps(
        &self,
        definition: &serde_json::Value,
    ) -> Result<Vec<StepDefinition>, ApiError> {
        let steps_value = definition
            .get("steps")
            .ok_or_else(|| ApiError::bad_request("Workflow definition missing 'steps' field"))?;

        let steps: Vec<StepDefinition> = serde_json::from_value(steps_value.clone())
            .map_err(|e| ApiError::bad_request(format!("Invalid steps definition: {}", e)))?;

        Ok(steps)
    }

    /// Create step execution in DB and enqueue job
    async fn create_and_enqueue_step(
        &self,
        run_id: &str,
        step: &StepDefinition,
        project_id: &str,
        tenant_id: &str,
        _input: &serde_json::Value,
    ) -> Result<String, ApiError> {
        let execution_id = format!("wfse_{}", Ulid::new());
        let step_type = convert_step_type(&step.step_type);

        // Create step execution
        let create = CreateWorkflowStepExecution {
            id: execution_id.clone(),
            workflow_run_id: run_id.to_string(),
            step_id: step.id.clone(),
            step_type,
            input: step.config.clone(),
            attempt: 1,
            span_id: None,
        };

        self.repos()
            .workflows()
            .create_step_execution(create)
            .await?;

        // Enqueue job
        let job = StepJob {
            run_id: run_id.to_string(),
            step_id: step.id.clone(),
            step_type: step.step_type.to_string(),
            input: step.config.clone(),
            context: JobContext {
                tenant_id: tenant_id.to_string(),
                project_id: project_id.to_string(),
                trace_id: None,
                span_id: None,
            },
        };

        let message = QueueMessage::new(&execution_id, job);
        self.state.enqueue_step(&message).await?;

        debug!(run_id, step_id = %step.id, execution_id, "Created and enqueued step");

        Ok(execution_id)
    }

    /// Enqueue ready steps
    async fn enqueue_ready_steps(&self, run_id: &str, step_ids: &[String]) -> Result<(), ApiError> {
        // Get run info
        let run = self
            .repos()
            .workflows()
            .get_run(run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("WorkflowRun", run_id))?;

        // Get workflow for step definitions
        let workflow = self
            .repos()
            .workflows()
            .get(&run.workflow_id)
            .await?
            .ok_or_else(|| ApiError::internal("Workflow not found for run"))?;

        let steps = self.parse_workflow_steps(&workflow.definition)?;

        for step_id in step_ids {
            if let Some(step) = steps.iter().find(|s| &s.id == step_id) {
                self.create_and_enqueue_step(
                    run_id,
                    step,
                    &run.project_id,
                    &run.project_id, // tenant_id same as project_id for now
                    &run.input,
                )
                .await?;
            }
        }

        Ok(())
    }

    /// Complete workflow run
    async fn complete_workflow(
        &self,
        run_id: &str,
        output: Option<serde_json::Value>,
    ) -> Result<(), ApiError> {
        self.repos()
            .workflows()
            .update_run(
                run_id,
                UpdateWorkflowRun {
                    status: Some(WorkflowRunStatus::Completed),
                    output,
                    completed_at: Some(chrono::Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        // Cleanup scheduler
        self.cleanup(run_id).await;

        info!(run_id, "Workflow completed");
        Ok(())
    }

    /// Fail workflow run
    async fn fail_workflow(&self, run_id: &str, error: &str) -> Result<(), ApiError> {
        self.repos()
            .workflows()
            .update_run(
                run_id,
                UpdateWorkflowRun {
                    status: Some(WorkflowRunStatus::Failed),
                    error: Some(serde_json::json!({ "message": error })),
                    completed_at: Some(chrono::Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        // Cleanup scheduler
        self.cleanup(run_id).await;

        error!(run_id, error, "Workflow failed");
        Ok(())
    }
}

/// Convert fd-dag StepType to fd-storage WorkflowStepType
fn convert_step_type(step_type: &DagStepType) -> WorkflowStepType {
    match step_type {
        DagStepType::Llm => WorkflowStepType::Llm,
        DagStepType::Tool => WorkflowStepType::Tool,
        DagStepType::Condition => WorkflowStepType::Condition,
        DagStepType::Loop => WorkflowStepType::Loop,
        DagStepType::Parallel => WorkflowStepType::Parallel,
        DagStepType::Approval => WorkflowStepType::Approval,
    }
}
