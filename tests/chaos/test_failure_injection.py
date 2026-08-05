"""Failure-injection chaos tests (CHAOS-001..008).

Every test here was a **simulated no-op**: it injected no fault ("in a real
chaos test, we would kill Postgres / restart the gateway ... for now") and
asserted ``status_code in (200, 201, 500, 502, 503)`` — a range wide enough to
pass under normal operation *and* under failure. That asserts nothing about how
the system degrades.

A real chaos test has to actually inject the fault and then assert the *specific*
degraded behaviour (DB down -> gateway returns 503 AND the queued job survives
AND it drains on recovery). That needs fault-injection plumbing this suite does
not have — Docker to kill/pause a dependency, ``tc`` for latency, cgroups for
memory — which is exactly the "cannot be made behavioural without new plumbing"
case. Each scenario is therefore skipped with the plumbing it needs, listed on
#6, instead of left as a green tautology.
"""

import pytest

_NEEDS = (
    "needs real fault injection (Docker kill/pause, tc latency, cgroups) to "
    "assert degraded behaviour rather than a simulated no-op — see #6"
)


@pytest.mark.skip(reason="CHAOS-001 DB-unavailable: " + _NEEDS)
def test_database_unavailable() -> None:  # pragma: no cover
    ...


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
