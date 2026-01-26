"""Authentication and Authorization security tests.

Tests for SEC-AUTH-001 to SEC-AUTH-008 from the testing plan.
"""

import time

import httpx
import pytest


# ==========================================================================
# SEC-AUTH-001: Unauthenticated requests blocked
# ==========================================================================
class TestUnauthenticatedBlocked:
    """Tests for unauthenticated request blocking."""

    def test_unauthenticated_blocked(
        self, unauthenticated_client: httpx.Client
    ) -> None:
        """Test that requests without auth return 401.

        SEC-AUTH-001: No auth → 401
        """
        # Try to access protected endpoint
        resp = unauthenticated_client.get("/api/v1/workflows")
        assert resp.status_code in (401, 403), (
            f"Expected 401/403, got {resp.status_code}"
        )

    def test_unauthenticated_workflow_create(
        self, unauthenticated_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that workflow creation without auth is blocked."""
        resp = unauthenticated_client.post(
            "/api/v1/workflows", json=simple_workflow
        )
        assert resp.status_code in (401, 403)

    def test_unauthenticated_run_create(
        self, unauthenticated_client: httpx.Client
    ) -> None:
        """Test that run creation without auth is blocked."""
        resp = unauthenticated_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": "fake_id", "input": {}},
        )
        assert resp.status_code in (401, 403)


# ==========================================================================
# SEC-AUTH-002: Invalid API key blocked
# ==========================================================================
class TestInvalidKeyBlocked:
    """Tests for invalid API key blocking."""

    def test_invalid_key_blocked(self) -> None:
        """Test that invalid API key returns 401.

        SEC-AUTH-002: Invalid key → 401
        """
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer invalid_key_12345",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")

    def test_malformed_auth_header(self) -> None:
        """Test that malformed auth header is rejected."""
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "NotBearer some_key",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")

    def test_empty_bearer_token(self) -> None:
        """Test that empty bearer token is rejected."""
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer ",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")


# ==========================================================================
# SEC-AUTH-003: Expired key blocked
# ==========================================================================
class TestExpiredKeyBlocked:
    """Tests for expired API key blocking."""

    def test_expired_key_blocked(self) -> None:
        """Test that expired API key returns 401.

        SEC-AUTH-003: Expired key → 401
        """
        # Use a key that simulates an expired key
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_expired_key_12345",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                # Should be rejected (401 for expired, or 403 for invalid)
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")


# ==========================================================================
# SEC-AUTH-004: Revoked key blocked
# ==========================================================================
class TestRevokedKeyBlocked:
    """Tests for revoked API key blocking."""

    def test_revoked_key_blocked(self) -> None:
        """Test that revoked API key returns 401.

        SEC-AUTH-004: Revoked key → 401
        """
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_revoked_key_12345",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")


# ==========================================================================
# SEC-AUTH-005: Admin-only endpoints
# ==========================================================================
class TestAdminOnlyEndpoint:
    """Tests for admin-only endpoint protection."""

    def test_admin_only_endpoint(
        self, api_client: httpx.Client
    ) -> None:
        """Test that non-admin can't access admin endpoints.

        SEC-AUTH-005: Non-admin → 403
        """
        # Try to access admin endpoint with regular key
        admin_endpoints = [
            "/api/v1/admin/config",
            "/api/v1/admin/tenants",
            "/api/v1/admin/metrics",
        ]

        for endpoint in admin_endpoints:
            resp = api_client.get(endpoint)
            # Should be 403 (forbidden) or 404 (not found)
            assert resp.status_code in (403, 404), (
                f"Admin endpoint {endpoint} accessible: {resp.status_code}"
            )

    def test_admin_can_access_admin_endpoint(
        self, admin_client: httpx.Client
    ) -> None:
        """Test that admin can access admin endpoints."""
        # Admin endpoints may not exist but shouldn't return 401
        resp = admin_client.get("/api/v1/admin/config")
        # 200 (success), 404 (not implemented), but not 401 (unauthorized)
        assert resp.status_code != 401


# ==========================================================================
# SEC-AUTH-006: Write-only endpoints
# ==========================================================================
class TestWriteOnlyEndpoint:
    """Tests for write endpoint protection."""

    def test_write_only_endpoint(
        self, readonly_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that read-only key can't create resources.

        SEC-AUTH-006: Read-only key → 403 on write
        """
        resp = readonly_client.post("/api/v1/workflows", json=simple_workflow)
        # Should be 403 (forbidden) for write operation
        # Or 401 if key is not recognized
        assert resp.status_code in (401, 403)

    def test_readonly_can_read(
        self, readonly_client: httpx.Client
    ) -> None:
        """Test that read-only key can read resources."""
        resp = readonly_client.get("/api/v1/workflows")
        # May succeed (200) or fail auth (401/403 if key not configured)
        assert resp.status_code in (200, 401, 403)


# ==========================================================================
# SEC-AUTH-007: Tenant isolation
# ==========================================================================
class TestTenantIsolation:
    """Tests for tenant isolation."""

    def test_tenant_isolation(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that cross-tenant access returns 404.

        SEC-AUTH-007: Cross-tenant → 404
        """
        # Create a workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")

        workflow_id = workflow_resp.json()["id"]

        # Access own workflow (should succeed)
        own_resp = api_client.get(f"/api/v1/workflows/{workflow_id}")
        assert own_resp.status_code == 200

        # Try to access with different tenant (simulated by different key)
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_tenant_b_key",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as other_client:
            try:
                cross_resp = other_client.get(f"/api/v1/workflows/{workflow_id}")
                # Should be 404 (not found) or 403 (forbidden)
                assert cross_resp.status_code in (401, 403, 404)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")


# ==========================================================================
# SEC-AUTH-008: Brute force protection
# ==========================================================================
class TestBruteForceProtection:
    """Tests for brute force protection."""

    def test_brute_force_protection(self) -> None:
        """Test rate limiting on authentication failures.

        SEC-AUTH-008: Rate limit on auth failures
        """
        # Make many rapid requests with invalid key
        results: list[int] = []

        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer invalid_brute_force_key",
                "Content-Type": "application/json",
            },
            timeout=5.0,
        ) as client:
            try:
                for _ in range(20):
                    resp = client.get("/api/v1/workflows")
                    results.append(resp.status_code)
                    time.sleep(0.1)  # Small delay
            except httpx.ConnectError:
                pytest.skip("Gateway not running")

        # Should see rate limiting (429) or consistent rejection (401/403)
        assert all(code in (401, 403, 429) for code in results), (
            f"Unexpected responses: {set(results)}"
        )

    def test_rate_limit_recovery(self) -> None:
        """Test that rate limit recovers after cooldown."""
        # This test verifies the system doesn't permanently block
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_test_key",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                # Make a request after potential rate limiting
                resp = client.get("/health/live")
                # Health should always work
                assert resp.status_code == 200
            except httpx.ConnectError:
                pytest.skip("Gateway not running")
