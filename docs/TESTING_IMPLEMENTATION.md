# FerrumDeck Test Implementation Guide

This guide provides practical templates and examples for implementing tests from the testing plan.

---

## Quick Start

```bash
# Install test dependencies
make install

# Run all tests
make test

# Run specific test categories
make test-rust           # Rust unit + integration
make test-python         # Python unit + integration
make test-integration    # Full integration suite
make test-e2e            # End-to-end tests
make test-security       # Security-focused tests

# Run with coverage
make test-coverage
```

---

## 1. Rust Test Templates

### 1.1 Unit Test Template

```rust
// rust/crates/fd-policy/src/engine.rs

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Test fixtures
    fn create_test_allowlist() -> ToolAllowlist {
        ToolAllowlist {
            allowed_tools: vec!["read_file".to_string()],
            approval_required: vec!["write_file".to_string()],
            denied_tools: vec!["delete_file".to_string()],
        }
    }

    // POL-ENG-001: Deny by default
    #[test]
    fn test_deny_by_default() {
        let allowlist = create_test_allowlist();
        let result = allowlist.check("unknown_tool");
        assert_eq!(result, ToolAllowlistResult::Denied);
    }

    // POL-ENG-002: Allowed tool passes
    #[test]
    fn test_allowed_tool_passes() {
        let allowlist = create_test_allowlist();
        let result = allowlist.check("read_file");
        assert_eq!(result, ToolAllowlistResult::Allowed);
    }

    // POL-ENG-003: Denied tool blocks
    #[test]
    fn test_denied_tool_blocks() {
        let allowlist = create_test_allowlist();
        let result = allowlist.check("delete_file");
        assert_eq!(result, ToolAllowlistResult::Denied);
    }

    // POL-ENG-004: Approval required
    #[test]
    fn test_approval_required() {
        let allowlist = create_test_allowlist();
        let result = allowlist.check("write_file");
        assert_eq!(result, ToolAllowlistResult::RequiresApproval);
    }

    // POL-ENG-005: Denied takes precedence
    #[test]
    fn test_denied_takes_precedence() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["some_tool".to_string()],
            approval_required: vec!["some_tool".to_string()],
            denied_tools: vec!["some_tool".to_string()],
        };
        let result = allowlist.check("some_tool");
        assert_eq!(result, ToolAllowlistResult::Denied);
    }
}
```

### 1.2 Async Test Template

```rust
// rust/crates/fd-policy/src/airlock/velocity.rs

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::time::{sleep, Duration};

    fn create_test_config() -> VelocityConfig {
        VelocityConfig {
            enabled: true,
            max_cost_cents: 100,
            window_seconds: 10,
            loop_threshold: 3,
        }
    }

    fn create_test_context(run_id: &RunId, tool: &str, input: serde_json::Value) -> InspectionContext {
        InspectionContext {
            run_id: run_id.clone(),
            tool_name: tool.to_string(),
            tool_input: input,
            estimated_cost_cents: Some(10),
        }
    }

    // AIR-VEL-001: Velocity within limit
    #[tokio::test]
    async fn test_velocity_within_limit() {
        let tracker = VelocityTracker::new(create_test_config());
        let run_id = RunId::new();
        let ctx = create_test_context(&run_id, "tool", json!({}));

        // Record a few calls
        for _ in 0..5 {
            tracker.record(&ctx).await;
        }

        let result = tracker.check(&ctx).await;
        assert!(result.is_none()); // No violation
    }

    // AIR-VEL-003: Loop detection trigger
    #[tokio::test]
    async fn test_loop_detection_trigger() {
        let tracker = VelocityTracker::new(create_test_config());
        let run_id = RunId::new();
        let ctx = create_test_context(&run_id, "tool", json!({"same": "input"}));

        // Record 3 identical calls (at threshold)
        for _ in 0..3 {
            tracker.record(&ctx).await;
        }

        // 4th check should trigger
        let result = tracker.check(&ctx).await;
        assert!(result.is_some());
        assert_eq!(result.unwrap().violation_type, ViolationType::LoopDetection);
    }
}
```

### 1.3 Integration Test Template

```rust
// rust/tests/integration/database.rs

use sqlx::PgPool;
use fd_storage::{RunsRepo, CreateRun};
use fd_core::RunId;

async fn setup_test_db() -> PgPool {
    let database_url = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://localhost/ferrumdeck_test".to_string());

    let pool = PgPool::connect(&database_url).await.unwrap();

    // Run migrations
    sqlx::migrate!("../../db/migrations")
        .run(&pool)
        .await
        .unwrap();

    pool
}

// INT-DB-002: Run lifecycle
#[tokio::test]
async fn test_run_lifecycle() {
    let pool = setup_test_db().await;
    let repo = RunsRepo::new(pool.clone());

    // Create
    let run = repo.create(CreateRun {
        agent_version_id: "agv_test".to_string(),
        input: json!({"task": "test"}),
        ..Default::default()
    }).await.unwrap();

    assert_eq!(run.status, RunStatus::Created);

    // Update status
    repo.update_status(&run.id, RunStatus::Running).await.unwrap();
    let updated = repo.get(&run.id).await.unwrap().unwrap();
    assert_eq!(updated.status, RunStatus::Running);

    // Complete
    repo.update_status(&run.id, RunStatus::Completed).await.unwrap();
    let completed = repo.get(&run.id).await.unwrap().unwrap();
    assert_eq!(completed.status, RunStatus::Completed);

    // Cleanup
    sqlx::query!("DELETE FROM runs WHERE id = $1", run.id.to_string())
        .execute(&pool)
        .await
        .unwrap();
}

// INT-DB-006: Tenant isolation
#[tokio::test]
async fn test_tenant_isolation() {
    let pool = setup_test_db().await;
    let repo = RunsRepo::new(pool.clone());

    // Create runs for different tenants
    let run1 = repo.create(CreateRun {
        tenant_id: "tenant_1".to_string(),
        ..Default::default()
    }).await.unwrap();

    let run2 = repo.create(CreateRun {
        tenant_id: "tenant_2".to_string(),
        ..Default::default()
    }).await.unwrap();

    // Query as tenant_1
    let runs = repo.list_for_tenant("tenant_1", Default::default()).await.unwrap();

    assert!(runs.iter().any(|r| r.id == run1.id));
    assert!(!runs.iter().any(|r| r.id == run2.id));

    // Cleanup
    sqlx::query!("DELETE FROM runs WHERE id IN ($1, $2)",
        run1.id.to_string(), run2.id.to_string())
        .execute(&pool)
        .await
        .unwrap();
}
```

### 1.4 Handler Test Template

```rust
// rust/services/gateway/src/handlers/runs_test.rs

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use tower::ServiceExt;
use serde_json::json;

use crate::routes::build_router;
use crate::state::AppState;

async fn setup_test_app() -> axum::Router {
    let state = AppState::test_default().await;
    build_router(state)
}

fn auth_header() -> (&'static str, &'static str) {
    ("Authorization", "Bearer test_api_key")
}

// GW-RUN-001: Create run request
#[tokio::test]
async fn test_create_run_request() {
    let app = setup_test_app().await;

    let request = Request::builder()
        .method("POST")
        .uri("/v1/runs")
        .header("Content-Type", "application/json")
        .header(auth_header().0, auth_header().1)
        .body(Body::from(json!({
            "agent_id": "safe-pr-agent",
            "input": {"task": "test"}
        }).to_string()))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);

    let body: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap()
    ).unwrap();

    assert!(body["id"].as_str().unwrap().starts_with("run_"));
    assert_eq!(body["status"], "queued");
}

// GW-RUN-005: Get run not found
#[tokio::test]
async fn test_get_run_not_found() {
    let app = setup_test_app().await;

    let request = Request::builder()
        .method("GET")
        .uri("/v1/runs/run_nonexistent")
        .header(auth_header().0, auth_header().1)
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

// GW-AUTH-001: Valid API key
#[tokio::test]
async fn test_valid_api_key() {
    let app = setup_test_app().await;

    let request = Request::builder()
        .method("GET")
        .uri("/v1/runs")
        .header("Authorization", "Bearer valid_test_key")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_ne!(response.status(), StatusCode::UNAUTHORIZED);
}

// GW-AUTH-002: Invalid API key
#[tokio::test]
async fn test_invalid_api_key() {
    let app = setup_test_app().await;

    let request = Request::builder()
        .method("GET")
        .uri("/v1/runs")
        .header("Authorization", "Bearer invalid_key_xxx")
        .body(Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
```

---

## 2. Python Test Templates

### 2.1 Unit Test Template

```python
# python/packages/fd-worker/tests/test_executor.py

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from fd_worker.executor import StepExecutor
from fd_worker.exceptions import PolicyDeniedError, BudgetExceededError


class TestStepExecutor:
    """Tests for PY-EXE-* test cases."""

    @pytest.fixture
    def mock_client(self):
        """Mock control plane client."""
        client = AsyncMock()
        client.get_step.return_value = {
            "id": "stp_test",
            "run_id": "run_test",
            "step_type": "llm",
            "input": {"messages": [{"role": "user", "content": "Hello"}]},
        }
        client.submit_step_result.return_value = {"status": "completed"}
        return client

    @pytest.fixture
    def mock_llm(self):
        """Mock LLM executor."""
        llm = AsyncMock()
        llm.complete.return_value = {
            "content": "Hello!",
            "input_tokens": 10,
            "output_tokens": 5,
            "tool_calls": [],
        }
        return llm

    @pytest.fixture
    def executor(self, mock_client, mock_llm):
        """Create executor with mocks."""
        with patch("fd_worker.executor.ControlPlaneClient", return_value=mock_client):
            with patch("fd_worker.executor.LLMExecutor", return_value=mock_llm):
                executor = StepExecutor(
                    control_plane_url="http://localhost:8080",
                    api_key="test_key",
                )
                executor._client = mock_client
                executor._llm = mock_llm
                yield executor

    # PY-EXE-001: Execute LLM step
    @pytest.mark.asyncio
    async def test_execute_llm_step(self, executor, mock_client, mock_llm):
        """Test LLM step execution."""
        job = {
            "run_id": "run_test",
            "step_id": "stp_test",
            "step_type": "llm",
        }

        await executor.execute(job)

        mock_llm.complete.assert_called_once()
        mock_client.submit_step_result.assert_called_once()

    # PY-EXE-002: Execute tool step
    @pytest.mark.asyncio
    async def test_execute_tool_step(self, executor, mock_client):
        """Test tool step execution."""
        mock_client.get_step.return_value = {
            "id": "stp_test",
            "run_id": "run_test",
            "step_type": "tool",
            "tool_name": "read_file",
            "tool_input": {"path": "/test.txt"},
        }
        mock_client.check_tool_policy.return_value = {
            "decision": "allowed",
        }

        with patch.object(executor, "_mcp_router") as mock_router:
            mock_router.call_tool.return_value = {"content": "file contents"}

            await executor.execute({
                "run_id": "run_test",
                "step_id": "stp_test",
                "step_type": "tool",
            })

            mock_router.call_tool.assert_called_once_with(
                "read_file",
                {"path": "/test.txt"},
            )

    # PY-EXE-003: Policy denied raises
    @pytest.mark.asyncio
    async def test_policy_denied_raises(self, executor, mock_client):
        """Test that denied tools raise PolicyDeniedError."""
        mock_client.get_step.return_value = {
            "id": "stp_test",
            "run_id": "run_test",
            "step_type": "tool",
            "tool_name": "delete_file",
            "tool_input": {"path": "/important.txt"},
        }
        mock_client.check_tool_policy.return_value = {
            "decision": "denied",
            "reason": "Tool not allowed",
        }

        with pytest.raises(PolicyDeniedError) as exc_info:
            await executor.execute({
                "run_id": "run_test",
                "step_id": "stp_test",
                "step_type": "tool",
            })

        assert exc_info.value.tool_name == "delete_file"

    # PY-EXE-005: Budget exceeded raises
    @pytest.mark.asyncio
    async def test_budget_exceeded_raises(self, executor, mock_client, mock_llm):
        """Test that budget exceeded raises BudgetExceededError."""
        mock_client.submit_step_result.side_effect = BudgetExceededError(
            budget_type="input_tokens",
            current=100000,
            limit=50000,
        )

        with pytest.raises(BudgetExceededError) as exc_info:
            await executor.execute({
                "run_id": "run_test",
                "step_id": "stp_test",
                "step_type": "llm",
            })

        assert exc_info.value.budget_type == "input_tokens"
```

### 2.2 Integration Test Template

```python
# tests/integration/test_e2e_workflow.py

import pytest
import asyncio
import httpx
from typing import AsyncGenerator

# Configuration
GATEWAY_URL = "http://localhost:8080"
API_KEY = "test_api_key"


@pytest.fixture
async def client() -> AsyncGenerator[httpx.AsyncClient, None]:
    """Create authenticated HTTP client."""
    async with httpx.AsyncClient(
        base_url=GATEWAY_URL,
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture
async def wait_for_services():
    """Wait for gateway and worker to be ready."""
    async with httpx.AsyncClient() as client:
        for _ in range(30):
            try:
                response = await client.get(f"{GATEWAY_URL}/health")
                if response.status_code == 200:
                    return
            except httpx.ConnectError:
                pass
            await asyncio.sleep(1)
        pytest.fail("Services not ready")


class TestE2EWorkflow:
    """End-to-end workflow tests."""

    # E2E-RUN-001: Create and complete run
    @pytest.mark.asyncio
    async def test_create_and_complete_run(self, client, wait_for_services):
        """Test full run lifecycle from creation to completion."""
        # Create run
        response = await client.post("/v1/runs", json={
            "agent_id": "test-agent",
            "input": {"task": "Simple task"},
        })
        assert response.status_code == 201
        run = response.json()
        run_id = run["id"]

        # Wait for completion (with timeout)
        for _ in range(60):
            response = await client.get(f"/v1/runs/{run_id}")
            assert response.status_code == 200
            run = response.json()

            if run["status"] in ["completed", "failed"]:
                break

            await asyncio.sleep(1)

        assert run["status"] == "completed"
        assert run["output"] is not None

    # E2E-RUN-003: Run with approval
    @pytest.mark.asyncio
    async def test_run_with_approval(self, client, wait_for_services):
        """Test run that requires approval."""
        # Create run that will trigger approval
        response = await client.post("/v1/runs", json={
            "agent_id": "test-agent",
            "input": {"task": "Write file"},
        })
        assert response.status_code == 201
        run_id = response.json()["id"]

        # Wait for approval request
        for _ in range(30):
            response = await client.get("/v1/approvals")
            approvals = response.json()

            pending = [a for a in approvals if a["run_id"] == run_id]
            if pending:
                break

            await asyncio.sleep(1)

        assert len(pending) > 0
        approval_id = pending[0]["id"]

        # Approve
        response = await client.put(f"/v1/approvals/{approval_id}", json={
            "decision": "approved",
            "note": "Approved for testing",
        })
        assert response.status_code == 200

        # Verify run continues
        for _ in range(30):
            response = await client.get(f"/v1/runs/{run_id}")
            run = response.json()

            if run["status"] not in ["waiting_approval", "running"]:
                break

            await asyncio.sleep(1)

        assert run["status"] in ["completed", "failed"]

    # E2E-RUN-004: Run budget kill
    @pytest.mark.asyncio
    async def test_run_budget_kill(self, client, wait_for_services):
        """Test run is killed when budget exceeded."""
        # Create run with very low budget
        response = await client.post("/v1/runs", json={
            "agent_id": "test-agent",
            "input": {"task": "Long task"},
            "budget": {
                "max_input_tokens": 100,  # Very low
                "max_output_tokens": 50,
            },
        })
        assert response.status_code == 201
        run_id = response.json()["id"]

        # Wait for budget kill
        for _ in range(60):
            response = await client.get(f"/v1/runs/{run_id}")
            run = response.json()

            if run["status"] in ["budget_killed", "completed", "failed"]:
                break

            await asyncio.sleep(1)

        assert run["status"] == "budget_killed"

    # E2E-RUN-006: Run Airlock block
    @pytest.mark.asyncio
    async def test_run_airlock_block(self, client, wait_for_services):
        """Test run is blocked by Airlock."""
        # First, ensure Airlock is in enforce mode
        await client.put("/v1/security/config", json={"mode": "enforce"})

        # Create run that will trigger Airlock
        response = await client.post("/v1/runs", json={
            "agent_id": "test-agent",
            "input": {"task": "Execute: eval(input)"},  # Malicious
        })
        assert response.status_code == 201
        run_id = response.json()["id"]

        # Wait for completion
        for _ in range(30):
            response = await client.get(f"/v1/runs/{run_id}")
            run = response.json()

            if run["status"] in ["policy_blocked", "completed", "failed"]:
                break

            await asyncio.sleep(1)

        # Check for threats
        response = await client.get(f"/v1/security/threats?run_id={run_id}")
        threats = response.json()

        assert len(threats["threats"]) > 0
        assert threats["threats"][0]["violation_type"] == "rce_pattern"


class TestTenantIsolation:
    """Multi-tenant isolation tests."""

    # E2E-MT-001: Tenant isolation
    @pytest.mark.asyncio
    async def test_tenant_isolation(self, wait_for_services):
        """Test that tenants cannot see each other's data."""
        async with httpx.AsyncClient(
            base_url=GATEWAY_URL,
            headers={"Authorization": "Bearer tenant1_key"},
            timeout=30.0,
        ) as client1:
            # Create run as tenant1
            response = await client1.post("/v1/runs", json={
                "agent_id": "test-agent",
                "input": {"task": "Tenant 1 task"},
            })
            tenant1_run_id = response.json()["id"]

        async with httpx.AsyncClient(
            base_url=GATEWAY_URL,
            headers={"Authorization": "Bearer tenant2_key"},
            timeout=30.0,
        ) as client2:
            # Try to access tenant1's run as tenant2
            response = await client2.get(f"/v1/runs/{tenant1_run_id}")
            assert response.status_code == 404  # Not found (not 403)

            # List runs should not include tenant1's run
            response = await client2.get("/v1/runs")
            runs = response.json()
            run_ids = [r["id"] for r in runs]
            assert tenant1_run_id not in run_ids
```

### 2.3 Security Test Template

```python
# tests/security/test_airlock.py

import pytest
import httpx


GATEWAY_URL = "http://localhost:8080"
API_KEY = "test_api_key"


@pytest.fixture
async def client():
    async with httpx.AsyncClient(
        base_url=GATEWAY_URL,
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=30.0,
    ) as client:
        yield client


class TestAirlockRCE:
    """Test Airlock RCE pattern detection."""

    @pytest.mark.parametrize("payload,pattern_name", [
        ("eval(user_input)", "eval"),
        ("exec(code)", "exec"),
        ("os.system('rm -rf /')", "os.system"),
        ("subprocess.run(['ls'])", "subprocess"),
        ("pickle.loads(data)", "pickle.loads"),
        ("__import__('os')", "__import__"),
        ("compile(code, '', 'exec')", "compile"),
    ])
    @pytest.mark.asyncio
    async def test_rce_patterns_blocked(self, client, payload, pattern_name):
        """SEC-AIR-001 to SEC-AIR-007: Test RCE patterns are blocked."""
        response = await client.post("/v1/runs/test_run/check-tool", json={
            "tool_name": "write_file",
            "tool_input": {"content": payload},
        })

        result = response.json()

        # In enforce mode, should be blocked
        if result.get("airlock", {}).get("mode") == "enforce":
            assert result["allowed"] is False
            assert "rce_pattern" in str(result.get("airlock", {}).get("violation_type", ""))

    @pytest.mark.asyncio
    async def test_base64_encoded_bypass_blocked(self, client):
        """SEC-AIR-007: Base64 encoded attacks blocked."""
        import base64
        encoded = base64.b64encode(b"eval(input)").decode()

        response = await client.post("/v1/runs/test_run/check-tool", json={
            "tool_name": "write_file",
            "tool_input": {"content": f"base64.b64decode('{encoded}')"},
        })

        # Should detect the eval pattern
        result = response.json()
        # Verify detection logic


class TestAirlockExfiltration:
    """Test Airlock exfiltration prevention."""

    @pytest.mark.asyncio
    async def test_unauthorized_domain_blocked(self, client):
        """SEC-AIR-010: Non-whitelist domain blocked."""
        response = await client.post("/v1/runs/test_run/check-tool", json={
            "tool_name": "http_get",
            "tool_input": {"url": "https://evil.com/steal"},
        })

        result = response.json()
        if result.get("airlock", {}).get("mode") == "enforce":
            assert result["allowed"] is False

    @pytest.mark.asyncio
    async def test_raw_ip_blocked(self, client):
        """SEC-AIR-011: Raw IP blocked."""
        response = await client.post("/v1/runs/test_run/check-tool", json={
            "tool_name": "http_get",
            "tool_input": {"url": "http://192.168.1.100/api"},
        })

        result = response.json()
        if result.get("airlock", {}).get("mode") == "enforce":
            assert result["allowed"] is False


class TestInputValidation:
    """Test input validation security."""

    @pytest.mark.asyncio
    async def test_sql_injection_blocked(self, client):
        """SEC-INP-001: SQL injection blocked."""
        response = await client.post("/v1/runs", json={
            "agent_id": "'; DROP TABLE runs; --",
            "input": {"task": "test"},
        })

        # Should either reject or sanitize
        assert response.status_code in [400, 422]  # Validation error

    @pytest.mark.asyncio
    async def test_path_traversal_blocked(self, client):
        """SEC-INP-004: Path traversal blocked."""
        response = await client.post("/v1/runs/test/check-tool", json={
            "tool_name": "read_file",
            "tool_input": {"path": "../../../../etc/passwd"},
        })

        result = response.json()
        # Should be blocked or sanitized
        assert "etc/passwd" not in str(result.get("result", ""))

    @pytest.mark.asyncio
    async def test_oversized_payload_rejected(self, client):
        """SEC-INP-006: Large payload rejected."""
        large_payload = "x" * (10 * 1024 * 1024)  # 10MB

        response = await client.post("/v1/runs", json={
            "agent_id": "test-agent",
            "input": {"task": large_payload},
        })

        assert response.status_code in [400, 413, 422]  # Payload too large
```

---

## 3. Frontend Test Templates

### 3.1 Component Test Setup

```typescript
// nextjs/jest.config.js
module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
  collectCoverageFrom: [
    'src/components/**/*.tsx',
    'src/hooks/**/*.ts',
    '!**/*.d.ts',
  ],
};
```

```typescript
// nextjs/jest.setup.ts
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { ReactElement } from 'react';

// Custom render with providers
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

export function renderWithProviders(ui: ReactElement) {
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  );
}
```

### 3.2 Component Test Template

```typescript
// nextjs/src/components/runs/__tests__/run-list.test.tsx

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../../jest.setup';
import { RunList } from '../run-list';
import { useRuns } from '@/hooks/use-runs';

// Mock the hook
jest.mock('@/hooks/use-runs');
const mockUseRuns = useRuns as jest.MockedFunction<typeof useRuns>;

const mockRuns = [
  {
    id: 'run_001',
    status: 'completed',
    agent_id: 'safe-pr-agent',
    created_at: '2024-01-15T10:00:00Z',
    cost_cents: 25,
  },
  {
    id: 'run_002',
    status: 'running',
    agent_id: 'safe-pr-agent',
    created_at: '2024-01-15T11:00:00Z',
    cost_cents: 10,
  },
];

describe('RunList', () => {
  beforeEach(() => {
    mockUseRuns.mockReturnValue({
      data: mockRuns,
      isLoading: false,
      error: null,
    } as any);
  });

  // UI-RUN-001: Renders run list
  it('renders run list', () => {
    renderWithProviders(<RunList />);

    expect(screen.getByText('run_001')).toBeInTheDocument();
    expect(screen.getByText('run_002')).toBeInTheDocument();
  });

  // UI-RUN-002: Shows loading state
  it('shows loading state', () => {
    mockUseRuns.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as any);

    renderWithProviders(<RunList />);

    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
  });

  // UI-RUN-003: Shows empty state
  it('shows empty state', () => {
    mockUseRuns.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as any);

    renderWithProviders(<RunList />);

    expect(screen.getByText(/no runs found/i)).toBeInTheDocument();
  });

  // UI-RUN-004: Renders status badges
  it('renders status badges with correct colors', () => {
    renderWithProviders(<RunList />);

    const completedBadge = screen.getByText('completed');
    const runningBadge = screen.getByText('running');

    expect(completedBadge).toHaveClass('bg-green-500');
    expect(runningBadge).toHaveClass('bg-yellow-500');
  });

  // UI-RUN-006: Filters by status
  it('filters by status', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RunList />);

    const statusFilter = screen.getByRole('combobox', { name: /status/i });
    await user.click(statusFilter);
    await user.click(screen.getByText('Completed'));

    expect(mockUseRuns).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed' })
    );
  });
});
```

### 3.3 Hook Test Template

```typescript
// nextjs/src/hooks/__tests__/use-runs.test.ts

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRuns, useRun } from '../use-runs';

// Mock fetch
global.fetch = jest.fn();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

describe('useRuns', () => {
  beforeEach(() => {
    queryClient.clear();
    (fetch as jest.Mock).mockClear();
  });

  // UI-HRN-001: useRuns fetches list
  it('fetches runs list', async () => {
    const mockRuns = [{ id: 'run_001', status: 'completed' }];
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockRuns,
    });

    const { result } = renderHook(() => useRuns(), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockRuns);
    });

    expect(fetch).toHaveBeenCalledWith('/api/v1/runs', expect.anything());
  });

  // UI-HRN-003: useRun fetches single
  it('fetches single run', async () => {
    const mockRun = { id: 'run_001', status: 'running' };
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockRun,
    });

    const { result } = renderHook(() => useRun('run_001'), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockRun);
    });

    expect(fetch).toHaveBeenCalledWith('/api/v1/runs/run_001', expect.anything());
  });

  // UI-HRN-004: useRun stops polling
  it('stops polling when terminal status', async () => {
    const mockRun = { id: 'run_001', status: 'completed' };
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    });

    const { result } = renderHook(() => useRun('run_001'), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.status).toBe('completed');
    });

    // After initial fetch, should not refetch (polling stopped)
    const fetchCallCount = (fetch as jest.Mock).mock.calls.length;

    // Wait and verify no additional fetches
    await new Promise(resolve => setTimeout(resolve, 3000));
    expect((fetch as jest.Mock).mock.calls.length).toBe(fetchCallCount);
  });
});
```

---

## 4. Performance Test Templates

### 4.1 Load Test (k6)

```javascript
// tests/performance/load_test.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const errorRate = new Rate('errors');
const createRunTrend = new Trend('create_run_duration');

export const options = {
  stages: [
    { duration: '1m', target: 10 },   // Ramp up
    { duration: '5m', target: 50 },   // Sustained load
    { duration: '1m', target: 100 },  // Peak
    { duration: '1m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95th percentile < 2s
    errors: ['rate<0.01'],             // Error rate < 1%
  },
};

const BASE_URL = __ENV.GATEWAY_URL || 'http://localhost:8080';
const API_KEY = __ENV.API_KEY || 'test_key';

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`,
};

// PERF-LD-001: Concurrent runs
export default function () {
  // Create run
  const createRes = http.post(
    `${BASE_URL}/v1/runs`,
    JSON.stringify({
      agent_id: 'load-test-agent',
      input: { task: `Load test ${Date.now()}` },
    }),
    { headers }
  );

  createRunTrend.add(createRes.timings.duration);

  const createSuccess = check(createRes, {
    'create run status is 201': (r) => r.status === 201,
    'create run has id': (r) => JSON.parse(r.body).id !== undefined,
  });

  errorRate.add(!createSuccess);

  if (createSuccess) {
    const runId = JSON.parse(createRes.body).id;

    // Poll for completion
    let attempts = 0;
    while (attempts < 30) {
      const getRes = http.get(`${BASE_URL}/v1/runs/${runId}`, { headers });

      check(getRes, {
        'get run status is 200': (r) => r.status === 200,
      });

      const status = JSON.parse(getRes.body).status;
      if (['completed', 'failed', 'budget_killed'].includes(status)) {
        break;
      }

      sleep(1);
      attempts++;
    }
  }

  sleep(1);
}
```

### 4.2 Latency Benchmark (Rust)

```rust
// rust/benches/policy_benchmark.rs

use criterion::{black_box, criterion_group, criterion_main, Criterion};
use fd_policy::{PolicyEngine, ToolAllowlist};
use serde_json::json;

fn create_large_allowlist() -> ToolAllowlist {
    ToolAllowlist {
        allowed_tools: (0..100).map(|i| format!("tool_{}", i)).collect(),
        approval_required: (100..200).map(|i| format!("tool_{}", i)).collect(),
        denied_tools: (200..300).map(|i| format!("tool_{}", i)).collect(),
    }
}

fn benchmark_policy_evaluation(c: &mut Criterion) {
    let allowlist = create_large_allowlist();

    c.bench_function("policy_check_allowed", |b| {
        b.iter(|| {
            black_box(allowlist.check("tool_50"))
        })
    });

    c.bench_function("policy_check_denied", |b| {
        b.iter(|| {
            black_box(allowlist.check("tool_250"))
        })
    });

    c.bench_function("policy_check_unknown", |b| {
        b.iter(|| {
            black_box(allowlist.check("unknown_tool"))
        })
    });
}

fn benchmark_airlock_rce(c: &mut Criterion) {
    use fd_policy::airlock::RcePatternMatcher;

    let matcher = RcePatternMatcher::default();

    c.bench_function("rce_check_clean", |b| {
        b.iter(|| {
            black_box(matcher.check("write_file", &json!({
                "content": "def hello(): print('hello')"
            })))
        })
    });

    c.bench_function("rce_check_malicious", |b| {
        b.iter(|| {
            black_box(matcher.check("write_file", &json!({
                "content": "eval(user_input)"
            })))
        })
    });

    c.bench_function("rce_check_large_payload", |b| {
        let large_content = "x".repeat(100_000);
        b.iter(|| {
            black_box(matcher.check("write_file", &json!({
                "content": large_content
            })))
        })
    });
}

criterion_group!(benches, benchmark_policy_evaluation, benchmark_airlock_rce);
criterion_main!(benches);
```

---

## 5. Test Execution Commands

```bash
# === Unit Tests ===
# Rust unit tests
cargo test --workspace

# Specific crate
cargo test -p fd-policy

# With output
cargo test --workspace -- --nocapture

# Python unit tests
uv run pytest python/packages/fd-worker/tests/ -v
uv run pytest python/packages/fd-evals/tests/ -v

# === Integration Tests ===
# Requires running services
make dev-up

# Rust integration
cargo test --workspace --test '*'

# Python integration
uv run pytest tests/integration/ -v

# === E2E Tests ===
# Start all services first
make quickstart &
sleep 30

# Run E2E
uv run pytest tests/e2e/ -v

# === Security Tests ===
uv run pytest tests/security/ -v

# === Performance Tests ===
# k6 load test
k6 run tests/performance/load_test.js

# Rust benchmarks
cargo bench --workspace

# === Coverage ===
# Rust coverage
cargo tarpaulin --workspace --out Html

# Python coverage
uv run pytest --cov=fd_worker --cov=fd_evals --cov-report=html

# === All Tests ===
make test-all
```

---

## 6. Debugging Failed Tests

### Rust

```bash
# Run single test with output
cargo test test_name -- --nocapture

# Run with debug logging
RUST_LOG=debug cargo test test_name -- --nocapture

# Run with backtrace
RUST_BACKTRACE=1 cargo test test_name
```

### Python

```bash
# Run single test with output
uv run pytest tests/test_file.py::test_name -v -s

# With debugger
uv run pytest tests/test_file.py::test_name --pdb

# Show locals on failure
uv run pytest tests/test_file.py --tb=long -l
```

### Frontend

```bash
# Run single test
npm test -- --testNamePattern="test name"

# Watch mode
npm test -- --watch

# With coverage
npm test -- --coverage
```

---

This implementation guide provides practical templates for every test category in the testing plan. Use these templates as starting points and adapt them to specific test cases.
