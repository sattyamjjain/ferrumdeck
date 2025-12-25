//! Handler tests for gateway API endpoints
//!
//! These tests verify the behavior of API handlers including:
//! - Run creation, retrieval, cancellation
//! - Policy enforcement
//! - Budget checking
//! - Approval flows

#[cfg(test)]
mod run_tests {
    use crate::handlers::runs::{
        CreateRunRequest, ListRunsQuery, RunResponse, SubmitStepResultRequest,
    };

    #[test]
    fn test_run_response_serialization() {
        let response = RunResponse {
            id: "run_01JTEST".to_string(),
            project_id: "proj_01".to_string(),
            agent_version_id: "av_01".to_string(),
            status: "pending".to_string(),
            input: serde_json::json!({"task": "test"}),
            output: None,
            input_tokens: 0,
            output_tokens: 0,
            tool_calls: 0,
            cost_cents: 0,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            started_at: None,
            completed_at: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("run_01JTEST"));
        assert!(json.contains("pending"));
    }

    #[test]
    fn test_create_run_request_deserialization() {
        let json = r#"{
            "agent_id": "agent_01",
            "input": {"task": "test task"}
        }"#;

        let request: CreateRunRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.agent_id, "agent_01");
        assert!(request.agent_version.is_none());
    }

    #[test]
    fn test_create_run_request_with_version() {
        let json = r#"{
            "agent_id": "agent_01",
            "agent_version": "av_01",
            "input": {"task": "test task"},
            "config": {"max_tokens": 1000}
        }"#;

        let request: CreateRunRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.agent_id, "agent_01");
        assert_eq!(request.agent_version, Some("av_01".to_string()));
        assert!(request.config.get("max_tokens").is_some());
    }

    #[test]
    fn test_list_runs_query_defaults() {
        let query: ListRunsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(query.limit, 20);
        assert_eq!(query.offset, 0);
        assert!(query.project_id.is_none());
    }

    #[test]
    fn test_submit_step_result_request() {
        let json = r#"{
            "status": "completed",
            "output": {"result": "success"},
            "input_tokens": 100,
            "output_tokens": 200
        }"#;

        let request: SubmitStepResultRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.status, "completed");
        assert_eq!(request.input_tokens, Some(100));
        assert_eq!(request.output_tokens, Some(200));
    }

    #[test]
    fn test_submit_step_result_failed() {
        let json = r#"{
            "status": "failed",
            "error": {"message": "Tool execution failed"}
        }"#;

        let request: SubmitStepResultRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.status, "failed");
        assert!(request.error.is_some());
    }

    #[test]
    fn test_check_tool_request() {
        use crate::handlers::runs::CheckToolRequest;

        let json = r#"{"tool_name": "read_file"}"#;
        let request: CheckToolRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.tool_name, "read_file");
    }

    #[test]
    fn test_check_tool_response_serialization() {
        use crate::handlers::runs::CheckToolResponse;

        let response = CheckToolResponse {
            allowed: true,
            requires_approval: false,
            decision_id: "dec_01".to_string(),
            reason: "Tool is in allowlist".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("\"allowed\":true"));
        assert!(json.contains("\"requires_approval\":false"));
    }
}

#[cfg(test)]
mod api_error_tests {
    use crate::handlers::ApiError;
    use axum::http::StatusCode;

    #[test]
    fn test_not_found_error() {
        let err = ApiError::not_found("Run", "run_01");
        assert_eq!(err.status, StatusCode::NOT_FOUND);
        assert_eq!(err.code, "NOT_FOUND");
        assert!(err.message.contains("run_01"));
    }

    #[test]
    fn test_bad_request_error() {
        let err = ApiError::bad_request("Invalid input");
        assert_eq!(err.status, StatusCode::BAD_REQUEST);
        assert_eq!(err.code, "BAD_REQUEST");
    }

    #[test]
    fn test_policy_blocked_error() {
        let err = ApiError::policy_blocked("Tool 'dangerous_tool' is not in allowlist");
        assert_eq!(err.status, StatusCode::FORBIDDEN);
        assert_eq!(err.code, "POLICY_BLOCKED");
        assert!(err.message.contains("dangerous_tool"));
    }

    #[test]
    fn test_budget_exceeded_error() {
        let err = ApiError::budget_exceeded("Token limit exceeded: 100000/50000");
        assert_eq!(err.status, StatusCode::FORBIDDEN);
        assert_eq!(err.code, "BUDGET_EXCEEDED");
        assert!(err.message.contains("Token limit"));
    }

    #[test]
    fn test_forbidden_error() {
        let err = ApiError::forbidden("Access denied");
        assert_eq!(err.status, StatusCode::FORBIDDEN);
        assert_eq!(err.code, "FORBIDDEN");
    }

    #[test]
    fn test_internal_error() {
        let err = ApiError::internal("Database connection failed");
        assert_eq!(err.status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(err.code, "INTERNAL_ERROR");
    }
}

#[cfg(test)]
mod workflow_tests {
    use crate::handlers::workflows::{
        CreateWorkflowRequest, CreateWorkflowRunRequest, WorkflowResponse,
    };

    #[test]
    fn test_create_workflow_request() {
        let json = r#"{
            "name": "My Workflow",
            "description": "Test workflow",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "name": "First Step",
                        "type": "llm",
                        "config": {}
                    }
                ]
            }
        }"#;

        let request: CreateWorkflowRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "My Workflow");
        assert_eq!(request.version, "1.0.0");
        assert_eq!(request.max_iterations, 10); // default
        assert_eq!(request.on_error, "fail"); // default
    }

    #[test]
    fn test_create_workflow_with_custom_params() {
        let json = r#"{
            "name": "My Workflow",
            "version": "2.0.0",
            "definition": {"steps": []},
            "max_iterations": 100,
            "on_error": "continue"
        }"#;

        let request: CreateWorkflowRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.max_iterations, 100);
        assert_eq!(request.on_error, "continue");
    }

    #[test]
    fn test_workflow_response_serialization() {
        let response = WorkflowResponse {
            id: "wf_01".to_string(),
            project_id: "proj_01".to_string(),
            name: "Test Workflow".to_string(),
            description: Some("A test".to_string()),
            version: "1.0.0".to_string(),
            status: "active".to_string(),
            definition: serde_json::json!({"steps": []}),
            max_iterations: 10,
            on_error: "fail".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            updated_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("wf_01"));
        assert!(json.contains("Test Workflow"));
    }

    #[test]
    fn test_create_workflow_run_request() {
        let json = r#"{
            "workflow_id": "wf_01",
            "input": {"data": "test input"}
        }"#;

        let request: CreateWorkflowRunRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.workflow_id, "wf_01");
        assert!(request.input.get("data").is_some());
    }

    #[test]
    fn test_workflow_run_response_serialization() {
        use crate::handlers::workflows::WorkflowRunResponse;

        let response = WorkflowRunResponse {
            id: "wfr_01".to_string(),
            workflow_id: "wf_01".to_string(),
            project_id: "proj_01".to_string(),
            status: "running".to_string(),
            input: serde_json::json!({}),
            output: None,
            error: None,
            current_step_id: Some("step_01".to_string()),
            step_results: serde_json::json!({}),
            input_tokens: 0,
            output_tokens: 0,
            tool_calls: 0,
            cost_cents: 0,
            created_at: "2024-01-01T00:00:00Z".to_string(),
            started_at: Some("2024-01-01T00:00:01Z".to_string()),
            completed_at: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("wfr_01"));
        assert!(json.contains("running"));
    }

    #[test]
    fn test_step_execution_response_serialization() {
        use crate::handlers::workflows::WorkflowStepExecutionResponse;

        let response = WorkflowStepExecutionResponse {
            id: "wfse_01".to_string(),
            workflow_run_id: "wfr_01".to_string(),
            step_id: "step_01".to_string(),
            step_type: "llm".to_string(),
            status: "completed".to_string(),
            input: serde_json::json!({"prompt": "test"}),
            output: Some(serde_json::json!({"response": "result"})),
            error: None,
            attempt: 1,
            input_tokens: Some(100),
            output_tokens: Some(50),
            started_at: Some("2024-01-01T00:00:00Z".to_string()),
            completed_at: Some("2024-01-01T00:00:01Z".to_string()),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("wfse_01"));
        assert!(json.contains("completed"));
    }
}

#[cfg(test)]
mod approval_tests {
    use crate::handlers::approvals::{
        ApprovalResponse, ListApprovalsQuery, ResolveApprovalRequest,
    };

    #[test]
    fn test_list_approvals_query_defaults() {
        let query: ListApprovalsQuery = serde_json::from_str("{}").unwrap();
        assert_eq!(query.limit, 50);
    }

    #[test]
    fn test_resolve_approval_request_approve() {
        let json = r#"{
            "approved": true,
            "note": "Looks good"
        }"#;

        let request: ResolveApprovalRequest = serde_json::from_str(json).unwrap();
        assert!(request.approved);
        assert_eq!(request.note, Some("Looks good".to_string()));
    }

    #[test]
    fn test_resolve_approval_request_reject() {
        let json = r#"{
            "approved": false,
            "note": "Too risky"
        }"#;

        let request: ResolveApprovalRequest = serde_json::from_str(json).unwrap();
        assert!(!request.approved);
    }

    #[test]
    fn test_approval_response_serialization() {
        let response = ApprovalResponse {
            id: "apr_01".to_string(),
            run_id: "run_01".to_string(),
            step_id: "step_01".to_string(),
            action_type: "tool_call".to_string(),
            action_details: serde_json::json!({"tool": "delete_file"}),
            reason: "Destructive operation requires approval".to_string(),
            status: "pending".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            expires_at: Some("2024-01-01T01:00:00Z".to_string()),
            resolved_by: None,
            resolved_at: None,
            resolution_note: None,
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("apr_01"));
        assert!(json.contains("pending"));
        assert!(json.contains("delete_file"));
    }
}

#[cfg(test)]
mod registry_tests {
    use crate::handlers::registry::{
        AgentResponse, AgentVersionResponse, CreateAgentRequest, CreateAgentVersionRequest,
        CreateToolRequest, ToolResponse,
    };

    #[test]
    fn test_create_agent_request() {
        let json = r#"{
            "name": "My Agent",
            "slug": "my-agent",
            "description": "A helpful agent",
            "project_id": "proj_01"
        }"#;

        let request: CreateAgentRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "My Agent");
        assert_eq!(request.slug, "my-agent");
        assert_eq!(request.project_id, "proj_01");
    }

    #[test]
    fn test_create_agent_version_request() {
        let json = r#"{
            "version": "1.0.0",
            "model": "claude-sonnet-4-20250514",
            "system_prompt": "You are a helpful assistant",
            "model_params": {"temperature": 0.7},
            "allowed_tools": ["read_file", "write_file"]
        }"#;

        let request: CreateAgentVersionRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.version, "1.0.0");
        assert_eq!(request.model, "claude-sonnet-4-20250514");
        assert!(request.system_prompt.contains("helpful"));
        assert_eq!(request.allowed_tools.len(), 2);
    }

    #[test]
    fn test_create_tool_request() {
        let json = r#"{
            "name": "fetch_url",
            "slug": "fetch-url",
            "description": "Fetch content from a URL",
            "project_id": "proj_01",
            "mcp_server": "http://localhost:3000",
            "risk_level": "read",
            "input_schema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string"}
                }
            }
        }"#;

        let request: CreateToolRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.name, "fetch_url");
        assert_eq!(request.risk_level, "read");
    }

    #[test]
    fn test_create_tool_with_destructive_risk() {
        let json = r#"{
            "name": "delete_file",
            "slug": "delete-file",
            "description": "Delete a file from disk",
            "mcp_server": "http://localhost:3000",
            "risk_level": "destructive",
            "input_schema": {}
        }"#;

        let request: CreateToolRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.risk_level, "destructive");
        assert!(request.project_id.is_none()); // Optional
    }

    #[test]
    fn test_agent_response_serialization() {
        let response = AgentResponse {
            id: "agt_01".to_string(),
            project_id: "proj_01".to_string(),
            name: "Test Agent".to_string(),
            slug: "test-agent".to_string(),
            description: Some("A test agent".to_string()),
            status: "active".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            latest_version: Some(AgentVersionResponse {
                id: "agv_01".to_string(),
                version: "1.0.0".to_string(),
                model: "claude-sonnet-4-20250514".to_string(),
                allowed_tools: vec!["read_file".to_string()],
                created_at: "2024-01-01T00:00:00Z".to_string(),
            }),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("agt_01"));
        assert!(json.contains("active"));
        assert!(json.contains("claude-sonnet-4-20250514"));
    }

    #[test]
    fn test_tool_response_serialization() {
        let response = ToolResponse {
            id: "tol_01".to_string(),
            project_id: Some("proj_01".to_string()),
            name: "Test Tool".to_string(),
            slug: "test-tool".to_string(),
            description: Some("A test tool".to_string()),
            mcp_server: "http://localhost:3000".to_string(),
            status: "active".to_string(),
            risk_level: "write".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("tol_01"));
        assert!(json.contains("write"));
    }
}

#[cfg(test)]
mod health_tests {
    use crate::handlers::health::{
        ComponentHealth, ComponentStatus, HealthResponse, ReadinessResponse,
    };

    #[test]
    fn test_health_response_serialization() {
        let response = HealthResponse {
            status: "healthy",
            version: "0.1.0",
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("healthy"));
        assert!(json.contains("0.1.0"));
    }

    #[test]
    fn test_readiness_response_healthy() {
        let response = ReadinessResponse {
            status: "ready",
            version: "0.1.0",
            components: ComponentStatus {
                database: ComponentHealth {
                    status: "healthy",
                    latency_ms: Some(5),
                    error: None,
                },
                redis: ComponentHealth {
                    status: "healthy",
                    latency_ms: Some(2),
                    error: None,
                },
            },
        };

        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("ready"));
        assert!(json.contains("database"));
        assert!(json.contains("redis"));
    }

    #[test]
    fn test_readiness_response_unhealthy() {
        let response = ReadinessResponse {
            status: "not_ready",
            version: "0.1.0",
            components: ComponentStatus {
                database: ComponentHealth {
                    status: "healthy",
                    latency_ms: Some(5),
                    error: None,
                },
                redis: ComponentHealth {
                    status: "unhealthy",
                    latency_ms: None,
                    error: Some("Connection refused".to_string()),
                },
            },
        };

        assert_eq!(response.status, "not_ready");
        assert_eq!(response.components.redis.status, "unhealthy");
        assert!(response.components.redis.error.is_some());
    }
}
