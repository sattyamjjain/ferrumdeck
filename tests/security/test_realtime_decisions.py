"""The realtime decision stream, asserted on outcomes rather than liveness (#5).

Issue #6's complaint about `tests/security` is that it checks a service is up
rather than that it behaves. Every test here asserts something that would still
be false if the feature were broken while the stack was perfectly healthy:

* the event ARRIVES when a tool call is checked;
* the audit row it names is READABLE at the moment the event arrives -- read
  back with no sleep and no retry, because the whole reason the gateway
  publishes from inside the audit write is to make that true;
* a policy denial produces EXACTLY ONE event, not zero and not two;
* a reconnect with `last_event_id` REPLAYS the gap instead of silently
  restarting from now.

`200 OK` proves none of those.
"""

from __future__ import annotations

import contextlib
import json
import threading
import time
from queue import Empty, Queue
from typing import TYPE_CHECKING

import httpx
import pytest

if TYPE_CHECKING:
    from collections.abc import Iterator

from .conftest import GATEWAY_URL, VALID_API_KEY

# Enough to ride out one rate-limit window without making a genuine outage look
# like slowness. The gateway tells us how long to wait; these only bound it.
RATE_LIMIT_RETRIES = 3
RATE_LIMIT_MAX_BACKOFF_S = 65.0
# The connect wait must exceed the worst-case backoff, or the wait expires while
# the reader is still politely sleeping and the failure reads as "the stream
# never connected" instead of "we were rate limited".
CONNECT_TIMEOUT_S = RATE_LIMIT_RETRIES * RATE_LIMIT_MAX_BACKOFF_S + 15.0


def _retry_after(response: httpx.Response) -> float:
    """Seconds to wait, as the gateway itself reported them."""
    try:
        hinted = json.loads(response.read())["error"]["retry_after"]
        return min(float(hinted) + 1.0, RATE_LIMIT_MAX_BACKOFF_S)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return RATE_LIMIT_MAX_BACKOFF_S


def _parse_sse(lines: Iterator[str]) -> Iterator[dict]:
    """Yield one dict per SSE `data:` frame, carrying its `id:` line."""
    event_id: str | None = None
    for raw in lines:
        line = raw.rstrip("\n")
        if line.startswith("id:"):
            event_id = line[3:].strip()
        elif line.startswith("data:"):
            try:
                payload = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                payload.setdefault("id", event_id)
                yield payload
        elif line.startswith(":"):
            continue  # keep-alive comment


class StreamReader:
    """Read a gateway SSE channel on a background thread into a queue."""

    def __init__(self, channel: str, last_event_id: str | None = None) -> None:
        self.queue: Queue[dict] = Queue()
        self.error: BaseException | None = None
        self._stop = threading.Event()
        self._channel = channel
        self._last_event_id = last_event_id
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self) -> None:
        params = {}
        if self._last_event_id is not None:
            params["last_event_id"] = self._last_event_id
        # The gateway rate-limits by requests per minute, and this suite opens a
        # fresh stream per test. A 429 is correct backpressure, not a defect, so
        # honour it the way any real client would rather than raising the limit
        # in CI and pretending the limiter is not there.
        for attempt in range(RATE_LIMIT_RETRIES):
            if self._connect_once(attempt):
                return

    def _connect_once(self, attempt: int) -> bool:
        """Return True when the stream ran (or failed for a non-429 reason)."""
        params = {}
        if self._last_event_id is not None:
            params["last_event_id"] = self._last_event_id
        try:
            with (
                httpx.Client(base_url=GATEWAY_URL, timeout=30.0) as client,
                client.stream(
                    "GET",
                    f"/v1/events/{self._channel}",
                    params=params,
                    headers={
                        "Authorization": f"Bearer {VALID_API_KEY}",
                        "Accept": "text/event-stream",
                    },
                ) as response,
            ):
                if response.status_code == 429 and attempt < RATE_LIMIT_RETRIES - 1:
                    time.sleep(_retry_after(response))
                    return False
                if response.status_code != 200:
                    self.error = AssertionError(
                        f"stream returned {response.status_code}: {response.read()!r}"
                    )
                    return True
                for event in _parse_sse(response.iter_lines()):
                    self.queue.put(event)
                    if self._stop.is_set():
                        return True
        except BaseException as exc:  # surfaced to the test via self.error
            self.error = exc
        return True

    def __enter__(self) -> StreamReader:
        self._thread.start()
        # Block until the gateway confirms the subscription.
        #
        # NOT a sleep. Subscription happens when the HTTP body starts flowing,
        # and until then anything published goes to nobody -- with no cursor to
        # replay from, it is simply lost. Sleeping an arbitrary interval and
        # hoping is how a test like this becomes flaky and then gets declared as
        # a known failure. The gateway emits `stream.connected` as its first
        # frame precisely so there is a real signal to wait for.
        self.await_event("stream.connected", timeout=CONNECT_TIMEOUT_S)
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()

    def await_event(self, event_type: str, timeout: float = 20.0) -> dict:
        """Return the first event of `event_type`, or fail with what did arrive."""
        seen: list[str] = []
        deadline = timeout
        while deadline > 0:
            step = min(2.0, deadline)
            try:
                event = self.queue.get(timeout=step)
            except Empty:
                deadline -= step
                continue
            deadline -= step
            if self.error:
                raise self.error
            if event.get("type") == event_type:
                return event
            seen.append(str(event.get("type")))
        if self.error:
            raise self.error
        pytest.fail(
            f"no {event_type!r} arrived within {timeout}s. Events seen: {seen or 'none'}. "
            "A connected stream that stays silent looks identical to one with nothing "
            "to say, which is why this asserts arrival rather than connection."
        )

    def drain(self, settle: float = 3.0) -> list[dict]:
        """Everything queued, after waiting `settle` for stragglers."""
        out: list[dict] = []
        deadline = settle
        while deadline > 0:
            with contextlib.suppress(Empty):
                out.append(self.queue.get(timeout=min(0.5, deadline)))
            deadline -= 0.5
        return out


class TestDecisionEventNamesADurableRecord:
    def test_the_audit_row_is_readable_the_moment_the_event_arrives(
        self, api_client: httpx.Client, created_run: str, check_tool
    ) -> None:
        """The claim SSE is worth having for.

        The gateway publishes from INSIDE the spawned audit write, after the row
        commits. If it published where the decision is computed instead, the
        record id below would resolve to nothing -- and a consumer cannot tell
        "not written yet" from "never written", so it would have to treat every
        event as unverifiable.

        Read back with no sleep and no retry: a retry loop here would hide
        exactly the bug this test exists to catch.
        """
        with StreamReader(f"run:{created_run}") as stream:
            check_tool(created_run, "git_read", {"path": "README.md"})
            event = stream.await_event("policy.response.recorded")

        payload = event["payload"]
        record_id = payload.get("record_id")
        assert record_id, f"the event must name the record it is about: {payload}"

        resolved = api_client.get(f"/v1/audit/{record_id}")
        assert resolved.status_code == 200, (
            f"event named audit record {record_id}, which is not readable "
            f"({resolved.status_code}). The publish happened before the write was durable."
        )
        row = resolved.json()
        assert row["id"] == record_id
        assert row["action"].startswith("policy."), row["action"]

    def test_the_event_carries_the_decision_rule_latency_and_record(
        self, created_run: str, check_tool
    ) -> None:
        """The four fields #5 asks for, each asserted for meaning, not presence."""
        with StreamReader(f"run:{created_run}") as stream:
            check_tool(created_run, "git_read", {"path": "README.md"})
            payload = stream.await_event("policy.response.recorded")["payload"]

        assert payload["decision"] in {
            "Allow",
            "AllowWithWarning",
            "RequiresApproval",
            "Deny",
        }, payload["decision"]

        # `rule` may legitimately be null: no verdict matched and deny-by-default
        # refused the call. What it must never be is absent, which would be
        # indistinguishable from "we did not record which rule fired".
        assert "rule" in payload

        latency = payload["latency_ms"]
        assert isinstance(latency, int) and latency >= 0, latency
        # In-path enforcement is the product claim; a check taking a minute would
        # mean the measurement is of something other than the check.
        assert latency < 60_000, f"implausible enforcement latency: {latency}ms"

        assert payload["record_id"]
        assert payload["run_id"] == created_run
        # Without this an operator cannot tell a blocked call from a logged one.
        assert isinstance(payload["shadow_mode"], bool)


class TestExactlyOneEventPerDecision:
    def test_a_denied_tool_call_produces_exactly_one_recorded_event(
        self, created_run: str, check_tool
    ) -> None:
        """Not zero (the push never fired) and not two (double publish).

        `rm -rf /` is not on the seeded agent's allowlist, so deny-by-default
        refuses it. The denial is the interesting case: it is the one an audit
        reader most needs to be able to count.
        """
        with StreamReader(f"run:{created_run}") as stream:
            check_tool(created_run, "definitely_not_allowlisted", {"cmd": "rm -rf /"})
            stream.await_event("policy.response.recorded")
            trailing = stream.drain(settle=3.0)

        extra = [e for e in trailing if e.get("type") == "policy.response.recorded"]
        assert not extra, (
            f"one tool check produced {1 + len(extra)} policy.response.recorded events. "
            "A duplicated decision event double-counts every enforcement figure "
            "built from this stream."
        )

    def test_the_decision_recorded_is_the_denial_that_happened(
        self, created_run: str, check_tool
    ) -> None:
        """The event must describe the call that was actually refused."""
        with StreamReader(f"run:{created_run}") as stream:
            result = check_tool(created_run, "definitely_not_allowlisted", {"cmd": "rm -rf /"})
            payload = stream.await_event("policy.response.recorded")["payload"]

        assert payload["tool_name"] == "definitely_not_allowlisted"
        assert payload["decision"] == "Deny", payload
        # The stream and the synchronous response must not disagree about
        # whether the call was permitted.
        assert result.get("allowed") is False, result


class TestReconnectReplaysTheGap:
    def test_reconnecting_with_last_event_id_replays_what_was_missed(
        self, created_run: str, check_tool
    ) -> None:
        """An SSE stream that drops events on reconnect is worse than polling.

        Disconnect, let a decision happen unobserved, then reconnect with the
        cursor. The missed event must be delivered.
        """
        channel = f"run:{created_run}"

        with StreamReader(channel) as first:
            check_tool(created_run, "git_read", {"path": "a.md"})
            seen = first.await_event("policy.response.recorded")
        cursor = seen["id"]
        assert cursor, "every event must carry an id, or resume is impossible"

        # Disconnected. This decision is published to nobody.
        check_tool(created_run, "git_read", {"path": "missed-while-away.md"})

        with StreamReader(channel, last_event_id=cursor) as resumed:
            replayed = resumed.await_event("policy.response.recorded")

        assert int(replayed["id"]) > int(cursor), (
            "the replayed event must be one this consumer had not seen; got the same id back"
        )
        assert replayed["payload"]["run_id"] == created_run, replayed["payload"]

    def test_a_fresh_connection_does_not_replay_history(self, created_run: str, check_tool) -> None:
        """No cursor means "watch from now", not "send me the buffer".

        Without this, every page load would re-announce old enforcement verdicts
        as if they had just happened.
        """
        check_tool(created_run, "git_read", {"path": "before-connect.md"})

        with StreamReader(f"run:{created_run}") as stream:
            immediate = stream.drain(settle=2.0)

        replayed = [e for e in immediate if e.get("type") == "policy.response.recorded"]
        assert not replayed, (
            f"a cursor-less connection replayed {len(replayed)} historic decision(s); "
            "old verdicts would be re-announced on every page load"
        )
