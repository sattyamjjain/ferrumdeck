"""Failure-injection chaos tests (CHAOS-001..008).

CHAOS-001 injects a **real** fault and asserts a **behaviour**: with Postgres
paused, the policy plane must fail *closed* — it must not authorize a tool it can
no longer check. Fail-open under dependency loss is the failure mode an auditor
asks about first, so this one real test is worth more than five simulated ones.

The rest still inject no fault. A meaningful version of each needs fault-injection
plumbing this suite does not have — Docker to kill/pause a dependency (done for
CHAOS-001), ``tc`` for latency, cgroups for memory — so they stay explicit skips
naming what they need, on #6, rather than green ``status_code in (...)``
tautologies.
"""

import os
import subprocess

import httpx
import pytest

SEED_AGENT_ID = os.getenv("FD_SEED_AGENT_ID", "agt_01JFVX0000000000000000001")
POSTGRES_CONTAINER = os.getenv("POSTGRES_CONTAINER", "ferrumdeck-postgres-1")

_NEEDS = (
    "needs real fault injection (Docker kill/pause, tc latency, cgroups) to "
    "assert degraded behaviour rather than a simulated no-op — see #6"
)


def _docker(*args: str) -> tuple[bool, str]:
    """Run a docker subcommand; return (ok, combined output). Never raises."""
    try:
        r = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=30)
        return r.returncode == 0, (r.stdout + r.stderr).strip()
    except Exception as e:  # docker missing / timeout
        return False, str(e)


# ==========================================================================
# CHAOS-001: Database unavailable — the policy plane must FAIL CLOSED.
# ==========================================================================
class TestDatabaseUnavailableFailsClosed:
    """With Postgres paused, authorizing a tool must not return an affirmative
    allow. Deny-by-default means: if the control plane cannot read the agent's
    allowlist/policy, it must deny (allowed=false) or error — never fail OPEN by
    allowing a tool it could not verify against current policy.
    """

    def test_check_tool_fails_closed_when_postgres_paused(self, api_client: httpx.Client) -> None:
        docker_ok, _ = _docker("ps")
        if not docker_ok:
            pytest.skip("Docker not available to inject the Postgres-pause fault (see #6)")

        # The run must be created BEFORE the DB is paused — creating it needs the DB.
        run_resp = api_client.post(
            "/v1/runs", json={"agent_id": SEED_AGENT_ID, "input": {"task": "chaos-db"}}
        )
        assert run_resp.status_code in (200, 201), (
            f"setup: could not create run: {run_resp.status_code} {run_resp.text}"
        )
        run_id = run_resp.json()["id"]

        paused, out = _docker("pause", POSTGRES_CONTAINER)
        if not paused:
            pytest.skip(
                f"could not pause {POSTGRES_CONTAINER} ({out}); is the dev stack up "
                "(make quickstart)? (see #6)"
            )
        try:
            # Authorize a tool while the DB is unreachable. The policy plane must
            # not return an affirmative allow it cannot justify.
            try:
                resp = api_client.post(
                    f"/v1/runs/{run_id}/check-tool",
                    json={"tool_name": "git_read", "tool_input": {"path": "README.md"}},
                    timeout=15.0,
                )
            except httpx.TimeoutException:
                # The gateway blocked on the unavailable DB rather than returning.
                # No allow was issued, so it did not fail open (a clean 503 would
                # be nicer — tracked on #6). Not a fail-open; the test passes.
                return

            allowed_true = False
            if resp.status_code == 200:
                try:
                    allowed_true = resp.json().get("allowed") is True
                except Exception:
                    allowed_true = False

            assert not allowed_true, (
                "FAILED OPEN: check-tool returned allowed=true while Postgres was "
                "paused, authorizing a tool it could not verify against current "
                f"policy. status={resp.status_code} body={resp.text[:300]}"
            )
        finally:
            # Always restore the dependency, even if the assertion failed.
            _docker("unpause", POSTGRES_CONTAINER)


# ==========================================================================
# The remaining scenarios still need fault-injection plumbing (#6).
# ==========================================================================
@pytest.mark.skip(reason="CHAOS-002 Redis-unavailable: " + _NEEDS)
def test_redis_unavailable() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-003 worker-crash mid-job (redelivery): " + _NEEDS)
def test_worker_crash() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-004 gateway-restart (in-flight retry): " + _NEEDS)
def test_gateway_restart() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-005 network-partition (worker reconnect): " + _NEEDS)
def test_network_partition() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-006 slow-database (timeout handling): " + _NEEDS)
def test_slow_database() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-007 full-disk (graceful degradation): " + _NEEDS)
def test_full_disk() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-008 memory-pressure (OOM handling): " + _NEEDS)
def test_memory_pressure() -> None:  # pragma: no cover
    ...
