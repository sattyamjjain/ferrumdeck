"""Per-harness eval dimension (Harness-Bench).

An fd-evals score is *not* a property of the model alone — the same model
under two different harnesses can produce different scores. This module
captures the four dimensions Harness-Bench names so an :class:`EvalRunSummary`
can be reported at the (model × harness) level rather than the model level:

1. **tools available** — which tools the agent could call, and at which
   versions.
2. **permission / policy tier** — the policy tier that governs the run
   (deny-by-default tightness + airlock mode).
3. **state / recovery** — retry policy, max iterations, on-error policy,
   replay seed.
4. **tracing** — OTel exporter target + sample rate + GenAI semconv
   version.

These are pure data — no I/O, no clock, no behavioural override. A
:class:`HarnessConfig` is *recorded* alongside an eval run; the runner does
not consume it.

Backward compatibility: the field is optional on :class:`EvalRunSummary`,
serialised with a Python-side ``Option``-equivalent (``None`` skipped from
``to_dict``). Older eval reports continue to deserialise cleanly.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

# Stable URL anchor for the methodology — surfaces in the runbook and the
# README so downstream consumers can cite the paper without re-fetching this
# docstring. Recorded on every config so the wire shape stays self-describing.
HARNESS_BENCH_ANCHOR = "Harness-Bench"

# Default permission tier label used by fd-evals when the workflow does not
# declare one. Captures FerrumDeck's deny-by-default invariant so a missing
# tier in the report doesn't degrade into "no policy".
DEFAULT_PERMISSION_TIER = "deny_by_default"


@dataclass(frozen=True)
class ToolBinding:
    """A single tool the agent was allowed to call during the eval run."""

    name: str
    version: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"name": self.name}
        if self.version is not None:
            out["version"] = self.version
        return out

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ToolBinding:
        return cls(name=str(data["name"]), version=data.get("version"))


@dataclass(frozen=True)
class StateRecoveryConfig:
    """State + recovery settings the harness enforced for the run."""

    max_retries: int = 0
    max_iterations: int = 0
    on_error: str = "stop"
    # Optional deterministic seed for replay; `None` when the harness did not
    # pin one (i.e. the run is non-deterministic by configuration).
    replay_seed: int | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "max_retries": self.max_retries,
            "max_iterations": self.max_iterations,
            "on_error": self.on_error,
        }
        if self.replay_seed is not None:
            out["replay_seed"] = self.replay_seed
        return out

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> StateRecoveryConfig:
        return cls(
            max_retries=int(data.get("max_retries", 0)),
            max_iterations=int(data.get("max_iterations", 0)),
            on_error=str(data.get("on_error", "stop")),
            replay_seed=data.get("replay_seed"),
        )


@dataclass(frozen=True)
class TracingConfig:
    """OpenTelemetry tracing config in effect for the run."""

    exporter: str = "otlp"
    sample_rate: float = 1.0
    # Pin the GenAI semconv revision the run was produced under so a Jaeger
    # consumer can interpret span attributes deterministically.
    gen_ai_semconv_version: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "exporter": self.exporter,
            "sample_rate": self.sample_rate,
        }
        if self.gen_ai_semconv_version is not None:
            out["gen_ai_semconv_version"] = self.gen_ai_semconv_version
        return out

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TracingConfig:
        return cls(
            exporter=str(data.get("exporter", "otlp")),
            sample_rate=float(data.get("sample_rate", 1.0)),
            gen_ai_semconv_version=data.get("gen_ai_semconv_version"),
        )


@dataclass(frozen=True)
class HarnessConfig:
    """The four Harness-Bench dimensions recorded with every eval run.

    Equality is structural. The :meth:`content_hash` is the canonical handle
    used by :class:`fd_evals.delta.DeltaReport` to label rows in the
    "score by (model × harness)" view; two runs that share a `content_hash`
    share a harness for comparison purposes.
    """

    harness_id: str
    label: str
    permission_tier: str = DEFAULT_PERMISSION_TIER
    tools_available: tuple[ToolBinding, ...] = field(default_factory=tuple)
    state_recovery: StateRecoveryConfig = field(default_factory=StateRecoveryConfig)
    tracing: TracingConfig = field(default_factory=TracingConfig)
    anchor: str = HARNESS_BENCH_ANCHOR

    def to_dict(self) -> dict[str, Any]:
        return {
            "harness_id": self.harness_id,
            "label": self.label,
            "permission_tier": self.permission_tier,
            "tools_available": [t.to_dict() for t in self.tools_available],
            "state_recovery": self.state_recovery.to_dict(),
            "tracing": self.tracing.to_dict(),
            "anchor": self.anchor,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> HarnessConfig:
        tools_raw = data.get("tools_available") or []
        tools = tuple(ToolBinding.from_dict(t) for t in tools_raw)
        state_raw = data.get("state_recovery") or {}
        tracing_raw = data.get("tracing") or {}
        return cls(
            harness_id=str(data["harness_id"]),
            label=str(data.get("label", data["harness_id"])),
            permission_tier=str(data.get("permission_tier", DEFAULT_PERMISSION_TIER)),
            tools_available=tools,
            state_recovery=StateRecoveryConfig.from_dict(state_raw),
            tracing=TracingConfig.from_dict(tracing_raw),
            anchor=str(data.get("anchor", HARNESS_BENCH_ANCHOR)),
        )

    def content_hash(self) -> str:
        """SHA-256 over a stable JSON projection of the harness dimensions.

        Excludes the human-readable ``label`` so a relabelling rename is not
        a structural change. Tool list is sorted by `name` before hashing so
        an evaluator that reports tools in a different order still hashes to
        the same harness.
        """
        sorted_tools = sorted(self.tools_available, key=lambda t: t.name)
        projection: dict[str, Any] = {
            "harness_id": self.harness_id,
            "permission_tier": self.permission_tier,
            "tools_available": [t.to_dict() for t in sorted_tools],
            "state_recovery": self.state_recovery.to_dict(),
            "tracing": self.tracing.to_dict(),
        }
        encoded = json.dumps(projection, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class HarnessConfigDelta:
    """Structured per-dimension change between two harness configs.

    Each list captures *only* the differences for that dimension, so an
    empty list means the dimension matched. A baseline-side or current-side
    config of ``None`` is reported via the wrapper :class:`HarnessConfigDiff`
    rather than this struct.
    """

    permission_tier_changed: bool
    added_tools: tuple[ToolBinding, ...]
    removed_tools: tuple[ToolBinding, ...]
    version_changed_tools: tuple[tuple[ToolBinding, ToolBinding], ...]
    state_recovery_changed: bool
    tracing_changed: bool

    @property
    def is_empty(self) -> bool:
        return (
            not self.permission_tier_changed
            and not self.added_tools
            and not self.removed_tools
            and not self.version_changed_tools
            and not self.state_recovery_changed
            and not self.tracing_changed
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "permission_tier_changed": self.permission_tier_changed,
            "added_tools": [t.to_dict() for t in self.added_tools],
            "removed_tools": [t.to_dict() for t in self.removed_tools],
            "version_changed_tools": [
                {"baseline": b.to_dict(), "current": c.to_dict()}
                for (b, c) in self.version_changed_tools
            ],
            "state_recovery_changed": self.state_recovery_changed,
            "tracing_changed": self.tracing_changed,
        }


@dataclass(frozen=True)
class HarnessConfigDiff:
    """High-level diff wrapper for two harness configs.

    Handles the "one side missing" cases up-front so callers (the dashboard,
    the CLI) can render a single shape regardless of whether both sides ran
    under a declared harness or not.
    """

    baseline: HarnessConfig | None
    current: HarnessConfig | None
    delta: HarnessConfigDelta | None

    @property
    def shared_harness(self) -> bool:
        return (
            self.baseline is not None
            and self.current is not None
            and self.baseline.content_hash() == self.current.content_hash()
        )

    @property
    def is_present(self) -> bool:
        return self.baseline is not None or self.current is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "baseline": self.baseline.to_dict() if self.baseline else None,
            "current": self.current.to_dict() if self.current else None,
            "delta": self.delta.to_dict() if self.delta else None,
            "shared_harness": self.shared_harness,
        }


def diff_harness_configs(
    baseline: HarnessConfig | None, current: HarnessConfig | None
) -> HarnessConfigDiff:
    """Compute the per-dimension diff between two harness configs.

    Returns a :class:`HarnessConfigDiff` whose ``delta`` is populated only
    when both sides exist *and* differ structurally — i.e. their content
    hashes do not match. When they share a hash, ``delta`` is ``None`` and
    ``shared_harness`` is ``True``.
    """
    if baseline is None or current is None:
        return HarnessConfigDiff(baseline=baseline, current=current, delta=None)

    if baseline.content_hash() == current.content_hash():
        return HarnessConfigDiff(baseline=baseline, current=current, delta=None)

    baseline_tools = {t.name: t for t in baseline.tools_available}
    current_tools = {t.name: t for t in current.tools_available}
    baseline_names = set(baseline_tools.keys())
    current_names = set(current_tools.keys())
    added = tuple(current_tools[n] for n in sorted(current_names - baseline_names))
    removed = tuple(baseline_tools[n] for n in sorted(baseline_names - current_names))
    version_changed = tuple(
        (baseline_tools[n], current_tools[n])
        for n in sorted(baseline_names & current_names)
        if baseline_tools[n].version != current_tools[n].version
    )

    delta = HarnessConfigDelta(
        permission_tier_changed=baseline.permission_tier != current.permission_tier,
        added_tools=added,
        removed_tools=removed,
        version_changed_tools=version_changed,
        state_recovery_changed=baseline.state_recovery != current.state_recovery,
        tracing_changed=baseline.tracing != current.tracing,
    )
    return HarnessConfigDiff(baseline=baseline, current=current, delta=delta)


def harness_config_from_dict(data: Mapping[str, Any] | None) -> HarnessConfig | None:
    """Backward-compatible constructor — `None` survives through cleanly."""
    if data is None:
        return None
    return HarnessConfig.from_dict(data)


def label_for_model_harness(model: str | None, harness: HarnessConfig | None) -> str:
    """Stable dashboard label combining model and harness identity.

    Examples:
        "claude-opus-4-7 × strict-policy-no-net"
        "gpt-4o × (no harness)"
    """
    model_label = model or "unknown-model"
    harness_label = harness.label if harness is not None else "(no harness)"
    return f"{model_label} × {harness_label}"


__all__ = [
    "DEFAULT_PERMISSION_TIER",
    "HARNESS_BENCH_ANCHOR",
    "HarnessConfig",
    "HarnessConfigDelta",
    "HarnessConfigDiff",
    "StateRecoveryConfig",
    "ToolBinding",
    "TracingConfig",
    "diff_harness_configs",
    "harness_config_from_dict",
    "label_for_model_harness",
]
