"""Tests for optional receiver-attestation of self-reported spans."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from fd_runtime.attestation import (
    DEFAULT_SCHEME,
    ENV_ENABLED,
    AttestationConfig,
    AttestationStatus,
    ReceiptVerifier,
    ToolCallReceipt,
    canonical_message,
    sign_receipt,
)

RECEIVER = "github-mcp"
KEY = b"receiver-shared-secret-0123456789"
TOOL = "github_create_pr"
TOKEN = "call_tok_abc123"
PAYLOAD_REF = "enc://blob/sha256:deadbeef"


def _receipt(**overrides: object) -> ToolCallReceipt:
    params: dict[str, object] = {
        "receiver_id": RECEIVER,
        "tool_name": TOOL,
        "call_token": TOKEN,
        "payload_ref": PAYLOAD_REF,
        "key": KEY,
    }
    params.update(overrides)
    return sign_receipt(**params)  # type: ignore[arg-type]


def _verifier() -> ReceiptVerifier:
    return ReceiptVerifier({RECEIVER: KEY})


# ---------------------------------------------------------------------------
# Config switch (off by default)
# ---------------------------------------------------------------------------


class TestAttestationConfig:
    def test_disabled_by_default(self) -> None:
        assert AttestationConfig().enabled is False

    def test_from_env_unset_is_disabled(self) -> None:
        assert AttestationConfig.from_env({}).enabled is False

    @pytest.mark.parametrize("value", ["1", "true", "TRUE", "Yes", "on"])
    def test_from_env_truthy_enables(self, value: str) -> None:
        assert AttestationConfig.from_env({ENV_ENABLED: value}).enabled is True

    @pytest.mark.parametrize("value", ["0", "false", "no", "off", "", "maybe"])
    def test_from_env_other_stays_disabled(self, value: str) -> None:
        assert AttestationConfig.from_env({ENV_ENABLED: value}).enabled is False


# ---------------------------------------------------------------------------
# Sign / verify round trip
# ---------------------------------------------------------------------------


class TestSignAndVerify:
    def test_canonical_message_is_deterministic(self) -> None:
        fields = {"b": 2, "a": 1, "c": None}
        assert canonical_message(fields) == canonical_message(dict(fields))
        # Sorted keys ⇒ insertion order does not matter.
        assert canonical_message({"a": 1, "b": 2}) == canonical_message({"b": 2, "a": 1})

    def test_valid_receipt_is_attested(self) -> None:
        result = _verifier().verify(_receipt(), expected_tool_name=TOOL, expected_call_token=TOKEN)
        assert result.attested is True
        assert result.status is AttestationStatus.ATTESTED
        assert result.self_reported_unverified is False
        assert result.receiver_id == RECEIVER
        assert result.scheme == DEFAULT_SCHEME

    def test_signed_receipt_carries_expected_scheme(self) -> None:
        assert _receipt().scheme == DEFAULT_SCHEME

    def test_issued_at_is_part_of_signature(self) -> None:
        ts = datetime(2026, 6, 4, tzinfo=UTC)
        receipt = _receipt(issued_at=ts)
        verifier = _verifier()
        # Verifies as issued.
        assert verifier.verify(receipt, expected_tool_name=TOOL, expected_call_token=TOKEN).attested
        # Tampering the timestamp invalidates the signature.
        tampered = receipt.model_copy(update={"issued_at": datetime(2020, 1, 1, tzinfo=UTC)})
        res = verifier.verify(tampered, expected_tool_name=TOOL, expected_call_token=TOKEN)
        assert res.status is AttestationStatus.UNVERIFIED_SIGNATURE_INVALID

    def test_unsupported_scheme_rejected_at_signing(self) -> None:
        with pytest.raises(ValueError, match="unsupported signature scheme"):
            sign_receipt(
                receiver_id=RECEIVER,
                tool_name=TOOL,
                call_token=TOKEN,
                payload_ref=PAYLOAD_REF,
                key=KEY,
                scheme="ed25519",
            )


# ---------------------------------------------------------------------------
# Unverified outcomes — never attested, never raises, never drops
# ---------------------------------------------------------------------------


class TestUnverifiedOutcomes:
    def test_no_receipt_is_unverified(self) -> None:
        result = _verifier().verify(None, expected_tool_name=TOOL, expected_call_token=TOKEN)
        assert result.attested is False
        assert result.status is AttestationStatus.UNVERIFIED_NO_RECEIPT
        assert result.self_reported_unverified is True
        assert "self-reported, unverified" in result.reason

    def test_unknown_receiver_is_unverified(self) -> None:
        verifier = ReceiptVerifier()  # empty keyring
        result = verifier.verify(_receipt(), expected_tool_name=TOOL, expected_call_token=TOKEN)
        assert result.status is AttestationStatus.UNVERIFIED_UNKNOWN_RECEIVER
        assert result.attested is False

    def test_bad_signature_is_unverified(self) -> None:
        # Signed with a different key than the verifier holds.
        forged = sign_receipt(
            receiver_id=RECEIVER,
            tool_name=TOOL,
            call_token=TOKEN,
            payload_ref=PAYLOAD_REF,
            key=b"a-different-key-entirely-9876543210",
        )
        result = _verifier().verify(forged, expected_tool_name=TOOL, expected_call_token=TOKEN)
        assert result.status is AttestationStatus.UNVERIFIED_SIGNATURE_INVALID
        assert result.attested is False

    def test_tool_name_mismatch_is_unverified(self) -> None:
        # Valid signature, but binds to a different tool than the span claims.
        result = _verifier().verify(
            _receipt(), expected_tool_name="some_other_tool", expected_call_token=TOKEN
        )
        assert result.status is AttestationStatus.UNVERIFIED_MISMATCH
        assert result.attested is False
        assert "tool=mismatch" in result.reason

    def test_call_token_mismatch_is_unverified(self) -> None:
        result = _verifier().verify(
            _receipt(), expected_tool_name=TOOL, expected_call_token="call_tok_OTHER"
        )
        assert result.status is AttestationStatus.UNVERIFIED_MISMATCH
        assert result.attested is False
        assert "token=mismatch" in result.reason

    def test_missing_expected_token_is_mismatch(self) -> None:
        # The span did not claim any call token ⇒ cannot bind ⇒ unverified.
        result = _verifier().verify(_receipt(), expected_tool_name=TOOL, expected_call_token=None)
        assert result.status is AttestationStatus.UNVERIFIED_MISMATCH
        assert result.attested is False

    def test_payload_ref_tampering_breaks_binding(self) -> None:
        receipt = _receipt()
        tampered = receipt.model_copy(update={"payload_ref": "enc://blob/sha256:0000"})
        result = _verifier().verify(tampered, expected_tool_name=TOOL, expected_call_token=TOKEN)
        # payload_ref is in the signed projection ⇒ signature no longer verifies.
        assert result.status is AttestationStatus.UNVERIFIED_SIGNATURE_INVALID


# ---------------------------------------------------------------------------
# Verifier keyring management
# ---------------------------------------------------------------------------


class TestVerifierKeyring:
    def test_register_receiver(self) -> None:
        verifier = ReceiptVerifier()
        assert verifier.has_receiver(RECEIVER) is False
        verifier.register_receiver(RECEIVER, KEY)
        assert verifier.has_receiver(RECEIVER) is True
        assert verifier.verify(
            _receipt(), expected_tool_name=TOOL, expected_call_token=TOKEN
        ).attested


# ---------------------------------------------------------------------------
# trace_tool_call integration — off by default, additive when enabled
# ---------------------------------------------------------------------------


def _record_spans():
    """Spin up an isolated tracer + in-memory exporter and return it.

    Returns (exporter, provider). The caller is responsible for getting the
    fd_runtime tracer to use this provider.
    """
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
        InMemorySpanExporter,
    )

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    return exporter, provider


class TestTraceToolCallIntegration:
    def _patch_tracer(self, monkeypatch: pytest.MonkeyPatch, provider) -> None:
        import fd_runtime.tracing as tracing

        monkeypatch.setattr(tracing, "_tracer", provider.get_tracer("test"))

    def test_disabled_writes_no_attestation_attributes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fd_runtime.tracing import trace_tool_call

        exporter, provider = _record_spans()
        self._patch_tracer(monkeypatch, provider)

        # Default config (disabled): even with a verifier + receipt present,
        # nothing attestation-related is written — existing behavior preserved.
        with trace_tool_call(
            TOOL,
            server=RECEIVER,
            receipt=_receipt(),
            call_token=TOKEN,
            verifier=_verifier(),
            attestation=AttestationConfig(),  # disabled
        ):
            pass

        [span] = exporter.get_finished_spans()
        attrs = dict(span.attributes or {})
        assert not any(k.startswith("ferrumdeck.attestation.") for k in attrs)

    def test_enabled_with_valid_receipt_marks_attested(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fd_runtime.tracing import trace_tool_call

        exporter, provider = _record_spans()
        self._patch_tracer(monkeypatch, provider)

        with trace_tool_call(
            TOOL,
            server=RECEIVER,
            receipt=_receipt(),
            call_token=TOKEN,
            verifier=_verifier(),
            attestation=AttestationConfig(enabled=True),
        ):
            pass

        [span] = exporter.get_finished_spans()
        attrs = dict(span.attributes or {})
        assert attrs["ferrumdeck.attestation.attested"] is True
        assert attrs["ferrumdeck.attestation.status"] == "attested"
        assert attrs["ferrumdeck.attestation.self_reported_unverified"] is False
        assert attrs["ferrumdeck.attestation.receiver_id"] == RECEIVER

    def test_enabled_without_receipt_flags_self_reported(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fd_runtime.tracing import trace_tool_call

        exporter, provider = _record_spans()
        self._patch_tracer(monkeypatch, provider)

        # Enabled, but no receipt supplied (the common case today). The span
        # is NOT dropped — it carries the honest "self-reported, unverified"
        # flag.
        with trace_tool_call(
            TOOL,
            server=RECEIVER,
            call_token=TOKEN,
            verifier=_verifier(),
            attestation=AttestationConfig(enabled=True),
        ):
            pass

        [span] = exporter.get_finished_spans()
        attrs = dict(span.attributes or {})
        assert attrs["ferrumdeck.attestation.attested"] is False
        assert attrs["ferrumdeck.attestation.status"] == "unverified_no_receipt"
        assert attrs["ferrumdeck.attestation.self_reported_unverified"] is True

    def test_enabled_with_mismatch_marks_unverified(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from fd_runtime.tracing import trace_tool_call

        exporter, provider = _record_spans()
        self._patch_tracer(monkeypatch, provider)

        # Receipt is for a different tool than the span claims.
        with trace_tool_call(
            "totally_different_tool",
            server=RECEIVER,
            receipt=_receipt(),
            call_token=TOKEN,
            verifier=_verifier(),
            attestation=AttestationConfig(enabled=True),
        ):
            pass

        [span] = exporter.get_finished_spans()
        attrs = dict(span.attributes or {})
        assert attrs["ferrumdeck.attestation.attested"] is False
        assert attrs["ferrumdeck.attestation.status"] == "unverified_mismatch"
