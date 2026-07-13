"""Airlock security types and response handling.

This module provides types for the Airlock security layer responses
from the control plane. Airlock performs runtime inspection of tool
call payloads before execution.
"""

from dataclasses import dataclass
from enum import Enum
from typing import Any


class RiskLevel(str, Enum):
    """Risk level for security violations."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @classmethod
    def from_string(cls, value: str) -> "RiskLevel":
        """Parse risk level from string."""
        try:
            return cls(value.lower())
        except ValueError:
            return cls.LOW


class ViolationType(str, Enum):
    """Type of security violation detected by Airlock."""

    RCE_PATTERN = "rcepattern"
    VELOCITY_BREACH = "velocitybreach"
    LOOP_DETECTION = "loopdetection"
    EXFILTRATION_ATTEMPT = "exfiltrationattempt"
    IP_ADDRESS_USED = "ipaddressused"

    @classmethod
    def from_string(cls, value: str | None) -> "ViolationType | None":
        """Parse violation type from string."""
        if not value:
            return None
        normalized = value.lower().replace("_", "")
        try:
            return cls(normalized)
        except ValueError:
            return None


@dataclass
class AirlockResponse:
    """Response from Airlock security inspection.

    Attributes:
        allowed: Whether the tool call is allowed.
        requires_approval: Whether approval is required.
        decision_id: Unique ID for the policy decision.
        reason: Human-readable explanation.
        risk_score: Risk score from 0-100.
        risk_level: Categorized risk level.
        violation_type: Type of violation (if any).
        violation_details: Details about the violation.
        blocked_by_airlock: True if blocked by Airlock (vs policy).
        shadow_mode: True if Airlock is in shadow mode (log-only).
    """

    allowed: bool
    requires_approval: bool
    decision_id: str
    reason: str
    risk_score: int = 0
    risk_level: RiskLevel = RiskLevel.LOW
    violation_type: ViolationType | None = None
    violation_details: str | None = None
    blocked_by_airlock: bool = False
    shadow_mode: bool = False
    # Reversibility-ladder rung the control plane chose (R1-R3 ladder). Carried
    # so the data plane's enforcement-decision GenAI span can report the same
    # rung the gateway did. `allow_and_log` (R1) | `allow_under_budget` (R2) |
    # `require_approval` (R3); None for older gateways that omit it.
    response_level: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "AirlockResponse":
        """Create from API response dictionary."""
        return cls(
            allowed=data.get("allowed", False),
            requires_approval=data.get("requires_approval", False),
            decision_id=data.get("decision_id", ""),
            reason=data.get("reason", ""),
            risk_score=data.get("risk_score", 0),
            risk_level=RiskLevel.from_string(data.get("risk_level", "low")),
            violation_type=ViolationType.from_string(data.get("violation_type")),
            violation_details=data.get("violation_details"),
            blocked_by_airlock=data.get("blocked_by_airlock", False),
            shadow_mode=data.get("shadow_mode", False),
            response_level=data.get("response_level"),
        )

    @property
    def rung(self) -> str | None:
        """The R1/R2/R3 label for the chosen reversibility rung, or None.

        Mirrors ``ResponseLevel::rung`` on the Rust side.
        """
        return {
            "allow_and_log": "R1",
            "allow_under_budget": "R2",
            "require_approval": "R3",
        }.get(self.response_level or "")

    @property
    def is_security_violation(self) -> bool:
        """Check if this response indicates a security violation."""
        return self.violation_type is not None

    @property
    def is_high_risk(self) -> bool:
        """Check if this is a high or critical risk."""
        return self.risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "allowed": self.allowed,
            "requires_approval": self.requires_approval,
            "decision_id": self.decision_id,
            "reason": self.reason,
            "risk_score": self.risk_score,
            "risk_level": self.risk_level.value,
            "violation_type": self.violation_type.value if self.violation_type else None,
            "violation_details": self.violation_details,
            "blocked_by_airlock": self.blocked_by_airlock,
            "shadow_mode": self.shadow_mode,
            "response_level": self.response_level,
        }
