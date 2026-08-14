"""Tests for the OTel GenAI mapping layer in observability/genai_mapping.py.

The contract under test is deliberately narrow: native fields are never
dropped, GenAI names appear only where a real equivalent exists, and the
generated doc cannot drift from the mapping tables.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "genai_mapping", REPO_ROOT / "observability" / "genai_mapping.py"
)
assert _SPEC and _SPEC.loader
genai_mapping = importlib.util.module_from_spec(_SPEC)
sys.modules["genai_mapping"] = genai_mapping
_SPEC.loader.exec_module(genai_mapping)


AUDIT_EVENT = {
    "id": "aud_01",
    "kind": "tool_call",
    "action": "read_file",
    "outcome": "allow",
    "tenant_id": "ten_1",
    "trace_id": "0af7651916cd43dd8448eb211c80319c",
    "metadata": {
        "model": "claude-opus-5",
        "input_tokens": 800,
        "output_tokens": 166,
        "tool_call_id": "tc_1",
        "policy_decision": "allow",
        "airlock_layer": 3,
        "risk_score": 12,
        "chain_hash": "deadbeef",
    },
}

EVAL_RESULT = {
    "task_id": "task_001",
    "passed": True,
    "total_score": 0.92,
    "input_tokens": 800,
    "output_tokens": 166,
    "cost_cents": 0.02,
    "model": "claude-opus-5",
}


class TestAuditMapping:
    def test_emits_genai_names_where_equivalents_exist(self):
        attrs = genai_mapping.map_audit_event(AUDIT_EVENT)
        assert attrs["gen_ai.request.model"] == "claude-opus-5"
        assert attrs["gen_ai.usage.input_tokens"] == 800
        assert attrs["gen_ai.usage.output_tokens"] == 166
        assert attrs["gen_ai.usage.total_tokens"] == 966
        assert attrs["gen_ai.tool.name"] == "read_file"
        assert attrs["gen_ai.tool.call_id"] == "tc_1"
        assert attrs["gen_ai.operation.name"] == "execute_tool"

    def test_keeps_native_fields_alongside(self):
        """Mapping must add, never replace."""
        attrs = genai_mapping.map_audit_event(AUDIT_EVENT)
        assert attrs["ferrumdeck.audit.metadata.model"] == "claude-opus-5"
        assert attrs["ferrumdeck.audit.outcome"] == "allow"
        assert attrs["ferrumdeck.audit.id"] == "aud_01"

    def test_governance_fields_have_no_genai_name(self):
        """The honest gap: enforcement concepts stay in the native namespace."""
        attrs = genai_mapping.map_audit_event(AUDIT_EVENT)
        assert attrs["ferrumdeck.audit.metadata.policy_decision"] == "allow"
        assert attrs["ferrumdeck.audit.metadata.airlock_layer"] == 3
        assert attrs["ferrumdeck.audit.metadata.chain_hash"] == "deadbeef"
        # No gen_ai.* key may claim to carry a governance decision.
        governance_words = ("policy", "airlock", "chain", "risk", "reversibility")
        offenders = [
            k for k in attrs if k.startswith("gen_ai.") and any(w in k for w in governance_words)
        ]
        assert not offenders, f"governance concept mapped onto a gen_ai.* name: {offenders}"

    def test_absent_fields_are_omitted_not_nulled(self):
        attrs = genai_mapping.map_audit_event({"id": "aud_2", "kind": "run.started"})
        assert "gen_ai.request.model" not in attrs
        assert "ferrumdeck.audit.outcome" not in attrs


class TestEvalMapping:
    def test_maps_tokens_and_model(self):
        attrs = genai_mapping.map_eval_result(EVAL_RESULT)
        assert attrs["gen_ai.request.model"] == "claude-opus-5"
        assert attrs["gen_ai.usage.total_tokens"] == 966
        assert attrs["gen_ai.operation.name"] == "evaluate"

    def test_score_and_cost_stay_native(self):
        attrs = genai_mapping.map_eval_result(EVAL_RESULT)
        assert attrs["ferrumdeck.eval.total_score"] == 0.92
        assert attrs["ferrumdeck.eval.cost_cents"] == 0.02
        assert not any(k.startswith("gen_ai.") and "score" in k for k in attrs)


class TestDocGeneration:
    def test_doc_is_not_stale(self):
        """docs/otel-genai-mapping.md is generated; it must match the tables."""
        doc = REPO_ROOT / "docs" / "otel-genai-mapping.md"
        assert doc.exists(), "run: uv run python observability/genai_mapping.py"
        assert doc.read_text() == genai_mapping.render_doc(), (
            "docs/otel-genai-mapping.md is stale; regenerate it"
        )

    def test_doc_states_every_gap(self):
        rendered = genai_mapping.render_doc()
        gaps = [f for f in genai_mapping.AUDIT_MAPPING if not f.has_equivalent]
        for fm in gaps:
            assert f"`{fm.native}`" in rendered

    def test_doc_does_not_claim_conformance(self):
        rendered = genai_mapping.render_doc().lower()
        assert "not a conformance claim" in rendered
        assert "fully conformant" not in rendered

    def test_coverage_is_reported_honestly(self):
        cov = genai_mapping.coverage()
        for family, (mapped, total) in cov.items():
            assert 0 < mapped < total, f"{family}: expected a partial mapping with real gaps"


@pytest.mark.parametrize("kind,expected", [("llm_call", "chat"), ("tool_call", "execute_tool")])
def test_operation_name_by_kind(kind, expected):
    attrs = genai_mapping.map_audit_event({"id": "a", "kind": kind})
    assert attrs["gen_ai.operation.name"] == expected
