"""Map FerrumDeck audit and eval records onto OpenTelemetry GenAI semconv names.

Scope, stated plainly: this is a **mapping**, not a conformance claim.

FerrumDeck emits two record families the GenAI semantic conventions were not
written for -- a hash-chained audit event and an eval result. Where the
conventions already have a name for something we record (the model, the token
counts, the tool name), we emit the ``gen_ai.*`` name so a standard OTel
consumer can read it. Where they do not -- and that is most of the governance
surface, because the conventions describe model calls rather than enforcement
decisions -- we keep the native ``ferrumdeck.*`` field and mark the gap.

Native fields are kept **alongside** the mapped ones, never replaced. A
consumer that only understands ``gen_ai.*`` gets a usable subset; a consumer
that understands FerrumDeck loses nothing.

The mapping tables below are the single source of truth: ``docs/otel-genai-
mapping.md`` is generated from them, so the doc cannot drift from the code.

Reference: OpenTelemetry Semantic Conventions for GenAI (experimental).
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any

# Namespace for fields the GenAI conventions have no name for.
NATIVE_NS = "ferrumdeck"


@dataclass(frozen=True)
class FieldMap:
    """One native field and its OTel GenAI equivalent, if any."""

    native: str
    otel: str | None
    note: str

    @property
    def has_equivalent(self) -> bool:
        return self.otel is not None


# --------------------------------------------------------------------------
# Audit events (fd_audit::AuditEvent)
# --------------------------------------------------------------------------
AUDIT_MAPPING: tuple[FieldMap, ...] = (
    FieldMap("id", None, "Audit-event ULID. No GenAI equivalent; not a span id."),
    FieldMap("timestamp", None, "Carried by the span/log record timestamp itself."),
    FieldMap("tenant_id", None, "Multi-tenancy is outside the GenAI conventions."),
    FieldMap(
        "kind",
        "gen_ai.operation.name",
        "Mapped only for model/tool-shaped kinds; governance kinds keep the native value too.",
    ),
    FieldMap("actor", None, "Enforcement actor (agent, human approver, system). No equivalent."),
    FieldMap("resource", None, "Governed resource identity. No equivalent."),
    FieldMap("action", "gen_ai.tool.name", "Only when the action is a tool invocation."),
    FieldMap("outcome", None, "allow / deny / require_approval. No GenAI equivalent."),
    FieldMap("trace_id", None, "Already the W3C trace id; belongs to trace context, not gen_ai.*."),
    FieldMap("trace_sampled", None, "W3C sampled flag; trace context, not gen_ai.*."),
    FieldMap("metadata.model", "gen_ai.request.model", "Model requested for the governed call."),
    FieldMap("metadata.response_model", "gen_ai.response.model", "Model that actually answered."),
    FieldMap("metadata.input_tokens", "gen_ai.usage.input_tokens", "Direct equivalent."),
    FieldMap("metadata.output_tokens", "gen_ai.usage.output_tokens", "Direct equivalent."),
    FieldMap("metadata.tool_call_id", "gen_ai.tool.call_id", "Direct equivalent."),
    # The governance surface. This is the honest core of the gap list.
    FieldMap("metadata.policy_decision", None, "Deny-by-default decision kind. No equivalent."),
    FieldMap("metadata.airlock_layer", None, "Which RASP layer fired (-1..3). No equivalent."),
    FieldMap("metadata.risk_score", None, "Airlock risk score 0-100. No equivalent."),
    FieldMap("metadata.reversibility", None, "R1-R3 reversibility rung. No equivalent."),
    FieldMap("metadata.chain_hash", None, "Hash-chain link for tamper evidence. No equivalent."),
    FieldMap("metadata.checkpoint_id", None, "Out-of-band chain anchor. No equivalent."),
    FieldMap("metadata.budget_lease_id", None, "Budget lease identity. No equivalent."),
    FieldMap("metadata.mandate_id", None, "AP2 signed payment mandate. No equivalent."),
)

# --------------------------------------------------------------------------
# Eval results (fd_evals.task.EvalResult)
# --------------------------------------------------------------------------
EVAL_MAPPING: tuple[FieldMap, ...] = (
    FieldMap("task_id", None, "Eval task identity. GenAI conventions have no eval concept."),
    FieldMap("task_name", None, "Eval task label. No equivalent."),
    FieldMap("run_id", None, "Control-plane run id. No equivalent."),
    FieldMap("passed", None, "Scorer verdict. No equivalent."),
    FieldMap("total_score", None, "Weighted scorer average. No equivalent."),
    FieldMap("scorer_results", None, "Per-scorer breakdown. No equivalent."),
    FieldMap("execution_time_ms", None, "Span duration already carries this."),
    FieldMap("input_tokens", "gen_ai.usage.input_tokens", "Direct equivalent."),
    FieldMap("output_tokens", "gen_ai.usage.output_tokens", "Direct equivalent."),
    FieldMap("cost_cents", None, "Cost is not in the GenAI conventions."),
    FieldMap("error", "error.type", "General OTel attribute, not gen_ai.*; set when present."),
    FieldMap("trace_id", None, "W3C trace context, not gen_ai.*."),
    FieldMap("timestamp", None, "Record timestamp."),
    FieldMap("model", "gen_ai.request.model", "Model under evaluation."),
    FieldMap("claim_grounding", None, "Grounding-rate reliability metric. No equivalent."),
    FieldMap("cost_breakdown", None, "Debt-vs-tax decomposition. No equivalent."),
)

# Operations we can honestly name with gen_ai.operation.name.
_OPERATION_BY_KIND: dict[str, str] = {
    "llm_call": "chat",
    "llm.call": "chat",
    "step.llm": "chat",
    "tool_call": "execute_tool",
    "tool.call": "execute_tool",
    "step.tool": "execute_tool",
    "embedding": "embeddings",
}


def _dig(record: dict[str, Any], dotted: str) -> Any:
    """Fetch a possibly-nested value by dotted path."""
    cur: Any = record
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def _apply(
    record: dict[str, Any], mapping: tuple[FieldMap, ...], native_prefix: str
) -> dict[str, Any]:
    attrs: dict[str, Any] = {}

    for fm in mapping:
        value = _dig(record, fm.native)
        if value is None:
            continue

        # Native field is always kept, mapped or not.
        attrs[f"{NATIVE_NS}.{native_prefix}.{fm.native}"] = value

        otel = fm.otel
        if otel is None:
            continue

        if fm.native == "kind":
            op = _OPERATION_BY_KIND.get(str(value))
            if op is not None:
                attrs[otel] = op
            continue

        if fm.native == "action":
            # Only a tool-shaped action maps to gen_ai.tool.name.
            if str(_dig(record, "kind") or "").endswith("tool") or _dig(
                record, "metadata.tool_call_id"
            ):
                attrs[otel] = value
            continue

        attrs[otel] = value

    return attrs


def map_audit_event(event: dict[str, Any]) -> dict[str, Any]:
    """Return OTel attributes for one audit event (native fields preserved)."""
    attrs = _apply(event, AUDIT_MAPPING, "audit")
    attrs.setdefault("gen_ai.system", "ferrumdeck")
    inp = attrs.get("gen_ai.usage.input_tokens")
    out = attrs.get("gen_ai.usage.output_tokens")
    if isinstance(inp, int) and isinstance(out, int):
        attrs["gen_ai.usage.total_tokens"] = inp + out
    return attrs


def map_eval_result(result: dict[str, Any]) -> dict[str, Any]:
    """Return OTel attributes for one eval result (native fields preserved)."""
    attrs = _apply(result, EVAL_MAPPING, "eval")
    attrs.setdefault("gen_ai.system", "ferrumdeck")
    attrs.setdefault("gen_ai.operation.name", "evaluate")
    inp = attrs.get("gen_ai.usage.input_tokens")
    out = attrs.get("gen_ai.usage.output_tokens")
    if isinstance(inp, int) and isinstance(out, int):
        attrs["gen_ai.usage.total_tokens"] = inp + out
    return attrs


def coverage() -> dict[str, tuple[int, int]]:
    """Return {family: (mapped, total)} for the honesty statement in the doc."""
    return {
        "audit": (sum(1 for f in AUDIT_MAPPING if f.has_equivalent), len(AUDIT_MAPPING)),
        "eval": (sum(1 for f in EVAL_MAPPING if f.has_equivalent), len(EVAL_MAPPING)),
    }


def _table(mapping: tuple[FieldMap, ...], prefix: str) -> list[str]:
    rows = [
        "| Native field | Emitted as | OTel GenAI equivalent | Note |",
        "| --- | --- | --- | --- |",
    ]
    for fm in mapping:
        emitted = f"`{NATIVE_NS}.{prefix}.{fm.native}`"
        otel = f"`{fm.otel}`" if fm.otel else "**none today**"
        rows.append(f"| `{fm.native}` | {emitted} | {otel} | {fm.note} |")
    return rows


def render_doc() -> str:
    cov = coverage()
    a_mapped, a_total = cov["audit"]
    e_mapped, e_total = cov["eval"]

    lines = [
        "# OpenTelemetry GenAI mapping",
        "",
        "Generated from `observability/genai_mapping.py`. Do not edit by hand.",
        "",
        "## What this is, and what it is not",
        "",
        "FerrumDeck emits its audit and eval records with OpenTelemetry GenAI "
        "attribute names **where an equivalent exists**, keeping every native "
        "`ferrumdeck.*` field alongside rather than replacing it.",
        "",
        "**This is a mapping, not a conformance claim.** The GenAI semantic "
        "conventions describe model calls. Most of what FerrumDeck records is an "
        "*enforcement decision* about a call, which those conventions have no "
        "vocabulary for. The gaps below are real and are listed rather than "
        "papered over.",
        "",
        f"- Audit events: **{a_mapped} of {a_total}** native fields have a GenAI equivalent.",
        f"- Eval results: **{e_mapped} of {e_total}** native fields have a GenAI equivalent.",
        "",
        "The unmapped remainder is the governance surface: policy decision kind, "
        "Airlock layer and risk score, the R1-R3 reversibility rung, hash-chain "
        "links and checkpoint anchors, budget leases, and AP2 mandates. None of "
        "these has an OTel GenAI name today.",
        "",
        "## Audit events (`fd_audit::AuditEvent`)",
        "",
        *_table(AUDIT_MAPPING, "audit"),
        "",
        "## Eval results (`fd_evals.task.EvalResult`)",
        "",
        *_table(EVAL_MAPPING, "eval"),
        "",
        "## Fields with no OTel GenAI equivalent",
        "",
    ]

    for family, mapping in (("Audit", AUDIT_MAPPING), ("Eval", EVAL_MAPPING)):
        gaps = [f for f in mapping if not f.has_equivalent]
        lines.append(f"**{family}** ({len(gaps)}):")
        lines.append("")
        for fm in gaps:
            lines.append(f"- `{fm.native}` — {fm.note}")
        lines.append("")

    lines += [
        "These are emitted under the `ferrumdeck.*` namespace. A consumer that "
        "understands only `gen_ai.*` will not see them; that is a limitation of "
        "the conventions, and we would rather say so than map a governance "
        "decision onto a name that means something else.",
        "",
    ]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=Path("docs/otel-genai-mapping.md"))
    ap.add_argument("--check", action="store_true", help="Exit 1 if the doc is stale.")
    args = ap.parse_args()

    rendered = render_doc()
    if args.check:
        if not args.out.exists() or args.out.read_text() != rendered:
            print(f"{args.out} is stale; regenerate with observability/genai_mapping.py")
            return 1
        print(f"{args.out} is up to date.")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered)
    cov = coverage()
    print(
        f"Wrote {args.out} (audit {cov['audit'][0]}/{cov['audit'][1]}, eval {cov['eval'][0]}/{cov['eval'][1]} mapped)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
