"""Recovery chaos tests (CHAOS-R-001..006).

Like the failure-injection suite, every test here injected no real fault: it
created a workflow/run under normal conditions and asserted the run stayed
queryable (``status_code == 200``). That asserts the service is up, not that it
*recovered* from anything.

A real recovery test has to take the dependency down, bring it back, and assert
the specific recovery (a job queued while Postgres was down drains once it
returns; a worker killed mid-job has its job redelivered). That needs the same
Docker/network fault-injection plumbing the failure-injection suite lacks, so
each scenario is skipped with the plumbing it needs, listed on #6, rather than
left as a liveness assertion dressed up as recovery.
"""

import pytest

_NEEDS = (
    "needs real fault injection + recovery (Docker stop/start, worker kill) to "
    "assert the system recovered rather than that it was never down — see #6"
)


@pytest.mark.skip(reason="CHAOS-R-001 database-recovery: " + _NEEDS)
def test_database_recovery() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-R-002 db-connection-pool-recovery: " + _NEEDS)
def test_database_connection_pool_recovery() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-R-003 redis-recovery: " + _NEEDS)
def test_redis_recovery() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-R-004 redis-stream-recovery: " + _NEEDS)
def test_redis_stream_recovery() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-R-005 worker-recovery + job-redelivery: " + _NEEDS)
def test_worker_recovery() -> None:  # pragma: no cover
    ...


@pytest.mark.skip(reason="CHAOS-R-006 partial-failure / graceful-degradation: " + _NEEDS)
def test_partial_failure() -> None:  # pragma: no cover
    ...
