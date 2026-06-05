"""Receiver-attestation for self-reported tool/service spans.

FerrumDeck spans are **agent-self-reported**: the agent (or worker on its
behalf) describes what it did. That is useful but unverifiable — the span
asserts "I called tool X", and nothing cross-checks the claim.

This module adds an **optional, off-by-default** cross-check: a receiver
(the tool/service that actually handled the call) issues a minimal,
Sello-style signed *receipt*, and the trace plane verifies that the receipt
(a) carries a valid receiver signature, and (b) references the *same call*
the self-reported span claims (same tool name + the same per-call token
binding). A span with a matching, verified receipt is marked
``attested = True``; a span with no receipt or a mismatch is marked
``attested = False`` and flagged "self-reported, unverified".

Design constraints (deliberate):

- **Additive signal, not enforcement.** Unattested spans are never dropped.
  Most spans are unattested today; that is expected.
- **Off by default.** When :class:`AttestationConfig.enabled` is ``False``
  (the default), the verification path is skipped entirely and existing
  pipelines are byte-for-byte unaffected.
- **The trace plane never decrypts the payload.** The receipt references an
  *owner-encrypted* payload (an opaque ``payload_ref``); attestation proves
  *binding*, not *contents*. See the README trust-model section for what
  this does and does NOT prove.

Signature scheme: the default is HMAC-SHA256 over a canonical projection of
the receipt's bound fields, keyed per receiver. HMAC is symmetric (shared
secret): a valid signature proves the receipt was produced by a party
holding the receiver's key, not third-party non-repudiation. The
:class:`ReceiptVerifier` interface is intentionally scheme-agnostic so an
asymmetric scheme (e.g. Ed25519) can drop in later without touching callers.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
from dataclasses import dataclass
from datetime import datetime  # noqa: TC003 — Pydantic resolves this annotation at runtime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# OTel attribute keys for the attestation signal.
#
# These are additive `ferrumdeck.attestation.*` keys. A Rust mirror lives in
# `fd_otel::genai::attrs` (kept in sync, same as the cost/firing-rate keys)
# so any OTLP consumer — Jaeger, the dashboard, a custom collector — reads
# one schema regardless of which plane wrote the span.
# ---------------------------------------------------------------------------
FD_ATTESTED = "ferrumdeck.attestation.attested"
FD_ATTESTATION_STATUS = "ferrumdeck.attestation.status"
FD_ATTESTATION_RECEIVER = "ferrumdeck.attestation.receiver_id"
FD_ATTESTATION_CALL_TOKEN = "ferrumdeck.attestation.call_token"
FD_ATTESTATION_SCHEME = "ferrumdeck.attestation.scheme"
# Human-facing flag the trace view surfaces verbatim. True whenever the span
# could not be cross-checked against a verified receiver receipt.
FD_SELF_REPORTED_UNVERIFIED = "ferrumdeck.attestation.self_reported_unverified"

DEFAULT_SCHEME = "hmac-sha256"

# Env switch — OFF by default. Any of {"1", "true", "yes", "on"} (case
# insensitive) enables verification. Anything else (including unset) leaves
# it disabled so existing pipelines are unaffected.
ENV_ENABLED = "FD_ATTESTATION_ENABLED"
_TRUTHY = frozenset({"1", "true", "yes", "on"})


class AttestationStatus(str, Enum):
    """Outcome of cross-checking a span against a receiver receipt."""

    # Receipt present, signature valid, and it binds to this exact call.
    ATTESTED = "attested"
    # No receipt was supplied for the call (the common case today).
    UNVERIFIED_NO_RECEIPT = "unverified_no_receipt"
    # A receipt was supplied but its signature did not verify.
    UNVERIFIED_SIGNATURE_INVALID = "unverified_signature_invalid"
    # Signature verified, but the receipt binds to a different call than the
    # span claims (tool name and/or call token disagree).
    UNVERIFIED_MISMATCH = "unverified_mismatch"
    # The receipt's receiver_id has no verification key in the keyring.
    UNVERIFIED_UNKNOWN_RECEIVER = "unverified_unknown_receiver"

    @property
    def attested(self) -> bool:
        return self is AttestationStatus.ATTESTED


class ToolCallReceipt(BaseModel):
    """A minimal Sello-style signed receipt for one tool/service call.

    The receiver (the service that actually handled the call) produces this
    out-of-band and hands it back to the caller, which can attach it to the
    self-reported span. The trace plane only ever *verifies* it.
    """

    # The receiver/service that signed this receipt.
    receiver_id: str
    # The tool/service call name this receipt attests to — must match the
    # span's claimed tool name.
    tool_name: str
    # Token binding: a per-call correlation token. The agent puts the same
    # token on its self-reported span; the receiver echoes it into the
    # receipt. Equality of this token is what ties receipt ⇄ span together.
    call_token: str
    # Owner-encrypted payload reference: an opaque pointer to the (encrypted)
    # request/response payload. The trace plane never dereferences or
    # decrypts it — it is part of the signed binding only.
    payload_ref: str
    # Hex-encoded receiver signature over the canonical projection.
    signature: str
    # Signature scheme identifier; defaults to HMAC-SHA256.
    scheme: str = DEFAULT_SCHEME
    # When the receiver issued the receipt (optional, advisory).
    issued_at: datetime | None = Field(default=None)

    def signed_fields(self) -> dict[str, Any]:
        """The exact field set covered by the signature.

        ``signature`` itself is excluded. ``issued_at`` is included (in
        ISO-8601) so a receipt cannot be replayed with a forged timestamp.
        """
        return {
            "receiver_id": self.receiver_id,
            "tool_name": self.tool_name,
            "call_token": self.call_token,
            "payload_ref": self.payload_ref,
            "scheme": self.scheme,
            "issued_at": self.issued_at.isoformat() if self.issued_at else None,
        }


def canonical_message(fields: dict[str, Any]) -> bytes:
    """Deterministic byte projection of the signed fields.

    Sorted keys + compact separators so the same logical receipt always
    hashes to the same bytes on every machine and every run — the signing
    and verifying sides must agree exactly.
    """
    return json.dumps(fields, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sign_receipt(
    *,
    receiver_id: str,
    tool_name: str,
    call_token: str,
    payload_ref: str,
    key: bytes,
    scheme: str = DEFAULT_SCHEME,
    issued_at: datetime | None = None,
) -> ToolCallReceipt:
    """Produce a signed receipt (for receivers + tests).

    Only HMAC-SHA256 is implemented today; an unknown scheme raises so a
    caller never silently emits an unsigned-looking receipt.
    """
    if scheme != DEFAULT_SCHEME:
        raise ValueError(f"unsupported signature scheme: {scheme!r}")
    fields = {
        "receiver_id": receiver_id,
        "tool_name": tool_name,
        "call_token": call_token,
        "payload_ref": payload_ref,
        "scheme": scheme,
        "issued_at": issued_at.isoformat() if issued_at else None,
    }
    signature = hmac.new(key, canonical_message(fields), hashlib.sha256).hexdigest()
    return ToolCallReceipt(
        receiver_id=receiver_id,
        tool_name=tool_name,
        call_token=call_token,
        payload_ref=payload_ref,
        signature=signature,
        scheme=scheme,
        issued_at=issued_at,
    )


@dataclass(frozen=True)
class AttestationResult:
    """The verdict for a single span ⇄ receipt cross-check."""

    attested: bool
    status: AttestationStatus
    reason: str
    receiver_id: str | None = None
    call_token: str | None = None
    scheme: str | None = None

    @property
    def self_reported_unverified(self) -> bool:
        """True whenever the span could not be verified against a receipt."""
        return not self.attested


@dataclass
class AttestationConfig:
    """Switch for the optional attestation path. OFF by default."""

    enabled: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> AttestationConfig:
        source = env if env is not None else os.environ
        raw = source.get(ENV_ENABLED, "").strip().lower()
        return cls(enabled=raw in _TRUTHY)


class ReceiptVerifier:
    """Verifies receiver receipts against a per-receiver key ring.

    Scheme-agnostic by construction: today it implements HMAC-SHA256, but the
    public ``verify`` contract takes the expected call binding and returns an
    :class:`AttestationResult`, so a future asymmetric verifier is a drop-in
    replacement.
    """

    def __init__(self, keyring: dict[str, bytes] | None = None) -> None:
        # receiver_id -> verification key (HMAC shared secret today).
        self._keyring: dict[str, bytes] = dict(keyring or {})

    def register_receiver(self, receiver_id: str, key: bytes) -> None:
        """Add or replace a receiver's verification key."""
        self._keyring[receiver_id] = key

    def has_receiver(self, receiver_id: str) -> bool:
        return receiver_id in self._keyring

    def verify(
        self,
        receipt: ToolCallReceipt | None,
        *,
        expected_tool_name: str,
        expected_call_token: str | None,
    ) -> AttestationResult:
        """Cross-check a receipt against the call a span claims to describe.

        Never raises and never drops anything — it always returns a verdict.
        A ``None`` receipt is the common "no receipt today" case and yields
        an honest ``unverified_no_receipt`` result.
        """
        if receipt is None:
            return AttestationResult(
                attested=False,
                status=AttestationStatus.UNVERIFIED_NO_RECEIPT,
                reason="self-reported, unverified (no receiver receipt supplied)",
                receiver_id=None,
                call_token=expected_call_token,
            )

        key = self._keyring.get(receipt.receiver_id)
        if key is None:
            return AttestationResult(
                attested=False,
                status=AttestationStatus.UNVERIFIED_UNKNOWN_RECEIVER,
                reason=(
                    "self-reported, unverified "
                    f"(no verification key for receiver {receipt.receiver_id!r})"
                ),
                receiver_id=receipt.receiver_id,
                call_token=receipt.call_token,
                scheme=receipt.scheme,
            )

        # Verify the signature first — an invalid signature means we cannot
        # trust ANY field on the receipt, including its binding claims.
        if not self._signature_valid(receipt, key):
            return AttestationResult(
                attested=False,
                status=AttestationStatus.UNVERIFIED_SIGNATURE_INVALID,
                reason="self-reported, unverified (receiver signature did not verify)",
                receiver_id=receipt.receiver_id,
                call_token=receipt.call_token,
                scheme=receipt.scheme,
            )

        # Signature is good; now confirm it binds to *this* call.
        tool_ok = receipt.tool_name == expected_tool_name
        token_ok = expected_call_token is not None and receipt.call_token == expected_call_token
        if not (tool_ok and token_ok):
            return AttestationResult(
                attested=False,
                status=AttestationStatus.UNVERIFIED_MISMATCH,
                reason=(
                    "self-reported, unverified "
                    "(verified receipt does not bind to this call: "
                    f"tool={'ok' if tool_ok else 'mismatch'}, "
                    f"token={'ok' if token_ok else 'mismatch'})"
                ),
                receiver_id=receipt.receiver_id,
                call_token=receipt.call_token,
                scheme=receipt.scheme,
            )

        return AttestationResult(
            attested=True,
            status=AttestationStatus.ATTESTED,
            reason="receiver receipt verified and bound to this call",
            receiver_id=receipt.receiver_id,
            call_token=receipt.call_token,
            scheme=receipt.scheme,
        )

    @staticmethod
    def _signature_valid(receipt: ToolCallReceipt, key: bytes) -> bool:
        if receipt.scheme != DEFAULT_SCHEME:
            # Unknown scheme: cannot verify ⇒ treat as invalid (honest).
            return False
        expected = hmac.new(
            key, canonical_message(receipt.signed_fields()), hashlib.sha256
        ).hexdigest()
        # Constant-time compare to avoid timing oracles on the signature.
        return hmac.compare_digest(expected, receipt.signature)


__all__ = [
    "DEFAULT_SCHEME",
    "ENV_ENABLED",
    "FD_ATTESTATION_CALL_TOKEN",
    "FD_ATTESTATION_RECEIVER",
    "FD_ATTESTATION_SCHEME",
    "FD_ATTESTATION_STATUS",
    "FD_ATTESTED",
    "FD_SELF_REPORTED_UNVERIFIED",
    "AttestationConfig",
    "AttestationResult",
    "AttestationStatus",
    "ReceiptVerifier",
    "ToolCallReceipt",
    "canonical_message",
    "sign_receipt",
]
