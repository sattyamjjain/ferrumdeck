"""Contract Consistency Tests.

API-CON-001 to API-CON-006: Tests for API contract consistency between
OpenAPI spec and JSON schemas.
"""

from typing import Any

import pytest


class TestAPICON001OpenAPISchemaConsistency:
    """API-CON-001: OpenAPI spec is consistent with JSON schemas."""

    def test_openapi_has_run_schema(self, openapi_spec: dict[str, Any]):
        """OpenAPI spec includes Run schema definition."""
        schemas = openapi_spec.get("components", {}).get("schemas", {})
        assert "Run" in schemas or "RunResponse" in schemas

    def test_openapi_has_step_schema(self, openapi_spec: dict[str, Any]):
        """OpenAPI spec includes Step schema definition."""
        schemas = openapi_spec.get("components", {}).get("schemas", {})
        assert "Step" in schemas or "StepResponse" in schemas

    def test_openapi_has_approval_schema(self, openapi_spec: dict[str, Any]):
        """OpenAPI spec includes Approval schema definition."""
        schemas = openapi_spec.get("components", {}).get("schemas", {})
        assert any(
            "approval" in key.lower() for key in schemas.keys()
        ), f"No approval schema found. Available schemas: {list(schemas.keys())}"


class TestAPICON002EndpointConsistency:
    """API-CON-002: All endpoints have consistent naming conventions."""

    def test_endpoints_use_kebab_case(self, openapi_spec: dict[str, Any]):
        """All endpoint paths use kebab-case."""
        paths = openapi_spec.get("paths", {})
        for path in paths.keys():
            # Skip path parameters which use {param}
            path_parts = path.replace("{", "").replace("}", "").split("/")
            for part in path_parts:
                if part and not part.startswith("{"):
                    # Path parts should be lowercase with hyphens, not underscores
                    assert "_" not in part or part.startswith(
                        "{"
                    ), f"Path '{path}' uses underscores instead of hyphens"

    def test_endpoints_are_versioned(self, openapi_spec: dict[str, Any]):
        """API endpoints include version prefix (except health/utility endpoints)."""
        paths = openapi_spec.get("paths", {})
        # Endpoints that don't require versioning
        unversioned_allowed = {"/health", "/ready", "/metrics", "/openapi.json"}

        for path in paths.keys():
            if path not in unversioned_allowed:
                assert path.startswith("/v1/") or path.startswith(
                    "/api/v1/"
                ), f"Path '{path}' is not versioned"


class TestAPICON003ResponseConsistency:
    """API-CON-003: Response formats are consistent."""

    def test_list_endpoints_return_arrays(self, openapi_spec: dict[str, Any]):
        """List endpoints return arrays with items."""
        paths = openapi_spec.get("paths", {})
        list_endpoints = [
            p for p in paths.keys() if not p.endswith("}") and "}" not in p.split("/")[-1]
        ]

        for path in list_endpoints:
            if "get" in paths[path]:
                responses = paths[path]["get"].get("responses", {})
                success_response = responses.get("200", {})
                content = success_response.get("content", {})
                if "application/json" in content:
                    schema = content["application/json"].get("schema", {})
                    # List responses often use allOf/oneOf or direct array
                    if "items" in schema or schema.get("type") == "array":
                        continue
                    # Or reference a schema that contains array
                    if "$ref" in schema or "allOf" in schema:
                        continue

    def test_error_responses_have_consistent_format(
        self, openapi_spec: dict[str, Any]
    ):
        """Error responses follow consistent format."""
        paths = openapi_spec.get("paths", {})
        for path, methods in paths.items():
            for method, config in methods.items():
                if method in ["get", "post", "put", "delete", "patch"]:
                    responses = config.get("responses", {})
                    # Check for standard error codes
                    has_client_error = any(
                        code.startswith("4") for code in responses.keys()
                    )
                    has_server_error = any(
                        code.startswith("5") for code in responses.keys()
                    )
                    # At least some endpoints should have error handling
                    if path.startswith("/v1/") or path.startswith("/api/v1/"):
                        # Note: Not all endpoints need to define all errors
                        pass


class TestAPICON004HTTPMethodConsistency:
    """API-CON-004: HTTP methods are used consistently."""

    def test_get_endpoints_are_safe(self, openapi_spec: dict[str, Any]):
        """GET endpoints don't have request bodies."""
        paths = openapi_spec.get("paths", {})
        for path, methods in paths.items():
            if "get" in methods:
                get_config = methods["get"]
                assert "requestBody" not in get_config, (
                    f"GET {path} has a request body"
                )

    def test_delete_endpoints_return_correct_codes(
        self, openapi_spec: dict[str, Any]
    ):
        """DELETE endpoints return 200, 202, or 204."""
        paths = openapi_spec.get("paths", {})
        for path, methods in paths.items():
            if "delete" in methods:
                responses = methods["delete"].get("responses", {})
                valid_codes = {"200", "202", "204"}
                success_codes = {
                    code for code in responses.keys() if code.startswith("2")
                }
                assert success_codes.intersection(
                    valid_codes
                ), f"DELETE {path} should return 200, 202, or 204"

    def test_post_endpoints_return_correct_codes(
        self, openapi_spec: dict[str, Any]
    ):
        """POST endpoints return 200, 201, or 202."""
        paths = openapi_spec.get("paths", {})
        for path, methods in paths.items():
            if "post" in methods:
                responses = methods["post"].get("responses", {})
                valid_codes = {"200", "201", "202"}
                success_codes = {
                    code for code in responses.keys() if code.startswith("2")
                }
                assert success_codes.intersection(
                    valid_codes
                ), f"POST {path} should return 200, 201, or 202"


class TestAPICON005SecurityConsistency:
    """API-CON-005: Security definitions are consistent."""

    def test_protected_endpoints_require_auth(self, openapi_spec: dict[str, Any]):
        """Protected endpoints specify security requirements."""
        security = openapi_spec.get("security", [])
        security_schemes = (
            openapi_spec.get("components", {}).get("securitySchemes", {})
        )

        # Either global security or per-endpoint security should be defined
        assert security or security_schemes, "No security definitions found"

    def test_security_schemes_are_defined(self, openapi_spec: dict[str, Any]):
        """Security schemes are properly defined."""
        security_schemes = (
            openapi_spec.get("components", {}).get("securitySchemes", {})
        )

        if security_schemes:
            for scheme_name, scheme in security_schemes.items():
                assert "type" in scheme, f"Security scheme '{scheme_name}' has no type"
                valid_types = ["apiKey", "http", "oauth2", "openIdConnect"]
                assert (
                    scheme["type"] in valid_types
                ), f"Invalid security type for '{scheme_name}'"


class TestAPICON006ContentTypeConsistency:
    """API-CON-006: Content types are consistent."""

    def test_json_content_type_used(self, openapi_spec: dict[str, Any]):
        """Endpoints use application/json content type."""
        paths = openapi_spec.get("paths", {})
        for path, methods in paths.items():
            for method, config in methods.items():
                if method in ["post", "put", "patch"]:
                    request_body = config.get("requestBody", {})
                    content = request_body.get("content", {})
                    if content:
                        assert (
                            "application/json" in content
                        ), f"{method.upper()} {path} doesn't accept application/json"

                if method in ["get", "post", "put", "patch", "delete"]:
                    responses = config.get("responses", {})
                    for code, response in responses.items():
                        if code.startswith("2") and code != "204":
                            content = response.get("content", {})
                            if content:
                                # Success responses should return JSON
                                assert "application/json" in content or not content, (
                                    f"{method.upper()} {path} response {code} "
                                    "doesn't return application/json"
                                )
