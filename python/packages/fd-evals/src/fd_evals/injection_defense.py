"""Indirect-prompt-injection defense benchmark (AgentDojo-style).

Measures FerrumDeck's **defense-path coverage**: given a vendored corpus of
AgentDojo-style indirect-injection cases (an injected tool result tries to make
the agent take a malicious action) plus benign control cases, how many attacks
does the **deny-by-default tool allowlist + Airlock RASP** block, and how much
benign-task utility is preserved?

This is **not** a model-robustness benchmark — no LLM is involved. It exercises
the *policy/RASP layer* on a fixed governance profile, deterministically and
offline. The defense decision computed here mirrors the Rust ``fd_policy``
contract (deny-by-default allowlist + anti-RCE matcher + data-exfiltration
shield); the corpus is **pinned to the real Rust RASP** by
``rust/crates/fd-policy/tests/injection_defense.rs`` (which runs the actual
``AirlockInspector`` over the same cases). Both planes must agree with the
corpus, so the reproduced number reflects the real defense, not a Python
re-implementation drifting on its own.

Corpus format follows AgentDojo's attack/benign split (arXiv:2406.13352):
``evals/datasets/injection_defense/{governance.json, tasks.jsonl}``.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from ipaddress import ip_address
from pathlib import Path
from typing import Any, Literal

# Stable anchor — AgentDojo (the attack/benign corpus format this suite vendors).
INJECTION_DEFENSE_ANCHOR = "agentdojo:arxiv:2406.13352"

BlockedBy = Literal["allowlist", "rce", "exfil", "none"]

# Anti-RCE patterns — a compact mirror of the fd_policy builtin patterns the
# vendored corpus exercises (kept in sync with the Rust matcher; the corpus
# parity check + the Rust injection_defense test fail if they diverge).
_RCE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)\beval\s*\("),
    re.compile(r"(?i)\bexec\s*\("),
    re.compile(r"(?i)__import__\s*\("),
    re.compile(r"(?i)subprocess\s*\.\s*(call|run|Popen|check_output)"),
    re.compile(r"(?i)os\s*\.\s*(system|popen|exec[lv]?[pe]?)"),
    re.compile(r"(?i)commands\s*\.\s*(getoutput|getstatusoutput)"),
    re.compile(r"\$\([^)]+\)"),  # shell command substitution
    re.compile(r"`[^`]+`"),  # backtick substitution
    re.compile(r"\.\./|\.\.\\|\.\.%2[fF]"),  # path traversal
    re.compile(r"(?i)['\"](/etc/|/var/|/root/|/home/|/proc/|/sys/)"),  # sensitive path
)

_URL_RE = re.compile(r"https?://([^/\s:'\"]+)(:\d+)?(/[^\s'\"]*)?")
_URL_KEYS = ("url", "endpoint", "webhook", "callback")


@dataclass(frozen=True)
class ProportionCI:
    """A binomial proportion with a 95% Wilson score confidence interval."""

    successes: int
    total: int
    rate: float
    ci_low: float
    ci_high: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "successes": self.successes,
            "total": self.total,
            "rate": self.rate,
            "ci95_low": self.ci_low,
            "ci95_high": self.ci_high,
        }


def wilson_ci(successes: int, total: int, z: float = 1.96) -> ProportionCI:
    """95% Wilson score interval for a binomial proportion (no SciPy needed)."""
    if total == 0:
        return ProportionCI(0, 0, 0.0, 0.0, 0.0)
    phat = successes / total
    denom = 1.0 + z * z / total
    center = phat + z * z / (2 * total)
    margin = z * math.sqrt((phat * (1 - phat) + z * z / (4 * total)) / total)
    low = max(0.0, (center - margin) / denom)
    high = min(1.0, (center + margin) / denom)
    return ProportionCI(successes, total, phat, low, high)


@dataclass(frozen=True)
class Governance:
    """The vendored deny-by-default allowlist + Airlock config the benchmark
    measures against. Mirrors the fields the Rust harness reads."""

    allowed_tools: frozenset[str]
    approval_required: frozenset[str]
    denied_tools: frozenset[str]
    mode: str
    rce_target_tools: frozenset[str]
    exfil_target_tools: frozenset[str]
    exfil_allowed_domains: tuple[str, ...]
    block_ip_addresses: bool
    credential_dlp_enabled: bool

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Governance:
        a = data["allowlist"]
        k = data["airlock"]
        return cls(
            allowed_tools=frozenset(a.get("allowed_tools", [])),
            approval_required=frozenset(a.get("approval_required", [])),
            denied_tools=frozenset(a.get("denied_tools", [])),
            mode=k.get("mode", "enforce"),
            rce_target_tools=frozenset(k.get("rce_target_tools", [])),
            exfil_target_tools=frozenset(k.get("exfil_target_tools", [])),
            exfil_allowed_domains=tuple(k.get("exfil_allowed_domains", [])),
            block_ip_addresses=bool(k.get("block_ip_addresses", True)),
            credential_dlp_enabled=bool(k.get("credential_dlp_enabled", True)),
        )


@dataclass(frozen=True)
class CaseDecision:
    """The defense decision for one corpus case."""

    id: str
    category: str
    attack_type: str
    tool_name: str
    executed: bool
    expected_executed: bool
    blocked_by: BlockedBy

    @property
    def matches_corpus(self) -> bool:
        return self.executed == self.expected_executed


@dataclass
class InjectionDefenseReport:
    """Aggregate defense-path result over the corpus."""

    suite: str
    total_cases: int
    block_rate: ProportionCI  # over attack cases
    benign_utility: ProportionCI  # over benign cases
    decisions: list[CaseDecision]
    mismatches: list[str] = field(default_factory=list)
    anchor: str = INJECTION_DEFENSE_ANCHOR

    def to_dict(self) -> dict[str, Any]:
        by_type: dict[str, dict[str, int]] = {}
        for d in self.decisions:
            if d.category != "attack":
                continue
            bucket = by_type.setdefault(d.attack_type, {"total": 0, "blocked": 0})
            bucket["total"] += 1
            if not d.executed:
                bucket["blocked"] += 1
        return {
            "suite": self.suite,
            "anchor": self.anchor,
            "total_cases": self.total_cases,
            "block_rate_under_attack": self.block_rate.to_dict(),
            "benign_utility": self.benign_utility.to_dict(),
            "attack_block_rate_by_type": by_type,
            "corpus_parity_ok": not self.mismatches,
            "mismatches": self.mismatches,
            "decisions": [
                {
                    "id": d.id,
                    "category": d.category,
                    "attack_type": d.attack_type,
                    "tool_name": d.tool_name,
                    "executed": d.executed,
                    "expected_executed": d.expected_executed,
                    "blocked_by": d.blocked_by,
                }
                for d in self.decisions
            ],
        }

    def to_markdown(self) -> str:
        br, bu = self.block_rate, self.benign_utility
        lines = [
            "# Injection-Defense Benchmark",
            "",
            f"**Suite:** `{self.suite}`  ·  **Anchor:** {self.anchor}  ·  "
            f"**Cases:** {self.total_cases}",
            "",
            "> Defense-path coverage of the deny-by-default tool allowlist + "
            "Airlock RASP against a vendored AgentDojo-style indirect-injection "
            "corpus. Deterministic, offline, no LLM — this measures the policy/RASP "
            "layer, not model robustness. The corpus is pinned to the real Rust "
            "`fd_policy` RASP by `cargo test -p fd-policy --test injection_defense`.",
            "",
            "## Headline",
            "",
            "| Metric | Value | 95% CI (Wilson) |",
            "|---|---|---|",
            f"| Block-rate under attack | **{br.rate * 100:.1f}%** ({br.successes}/{br.total}) | "
            f"[{br.ci_low * 100:.1f}%, {br.ci_high * 100:.1f}%] |",
            f"| Benign-task utility preserved | **{bu.rate * 100:.1f}%** ({bu.successes}/{bu.total}) | "
            f"[{bu.ci_low * 100:.1f}%, {bu.ci_high * 100:.1f}%] |",
            "",
            "## Block-rate by attack type",
            "",
            "| Attack type | Blocked / total |",
            "|---|---|",
        ]
        by_type = self.to_dict()["attack_block_rate_by_type"]
        for atype, b in sorted(by_type.items()):
            lines.append(f"| `{atype}` | {b['blocked']}/{b['total']} |")
        lines += [
            "",
            f"**Corpus parity:** {'OK — every case decided as recorded' if not self.mismatches else 'MISMATCH'}",
        ]
        if self.mismatches:
            lines += ["", "### Mismatches", ""]
            lines += [f"- {m}" for m in self.mismatches]
        return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------------
# Defense decision (mirror of the Rust fd_policy contract)
# ----------------------------------------------------------------------------


def _iter_strings(value: Any) -> list[str]:
    """All string leaves in a JSON value (mirrors extract_text_content)."""
    out: list[str] = []
    if isinstance(value, str):
        out.append(value)
    elif isinstance(value, dict):
        for v in value.values():
            out.extend(_iter_strings(v))
    elif isinstance(value, list):
        for v in value:
            out.extend(_iter_strings(v))
    return out


def _extract_domains(tool_input: dict[str, Any]) -> list[str]:
    domains: list[str] = []
    for s in _iter_strings(tool_input):
        for m in _URL_RE.finditer(s):
            domains.append(m.group(1).lower())
    for key in _URL_KEYS:
        v = tool_input.get(key)
        if isinstance(v, str):
            m = _URL_RE.match(v)
            if m:
                domains.append(m.group(1).lower())
    return domains


def _is_ip(host: str) -> bool:
    try:
        ip_address(host)
        return True
    except ValueError:
        return False


def _domain_allowed(domain: str, allowed: tuple[str, ...]) -> bool:
    if not allowed:  # empty whitelist ⇒ allow all (mirrors Rust)
        return True
    return any(domain == a or domain.endswith(f".{a}") for a in allowed)


def decide(gov: Governance, tool_name: str, tool_input: dict[str, Any]) -> tuple[bool, BlockedBy]:
    """Return ``(executed, blocked_by)`` for a single tool call under the
    governance profile — the same layered decision the Rust harness computes."""
    # Deny-by-default allowlist (explicit deny > approval > allow > default deny).
    if tool_name in gov.denied_tools or tool_name not in gov.allowed_tools:
        return False, "allowlist"
    if tool_name in gov.approval_required:
        return False, "allowlist"  # approval gate — not auto-executed

    if gov.mode == "enforce":
        # Anti-RCE matcher (only on inspected tools).
        if tool_name in gov.rce_target_tools:
            text = "\n".join(_iter_strings(tool_input))
            if any(p.search(text) for p in _RCE_PATTERNS):
                return False, "rce"
        # Data-exfiltration shield (only on inspected network tools).
        if tool_name in gov.exfil_target_tools:
            for domain in _extract_domains(tool_input):
                if gov.block_ip_addresses and _is_ip(domain):
                    return False, "exfil"
                if not _domain_allowed(domain, gov.exfil_allowed_domains):
                    return False, "exfil"

    return True, "none"


# ----------------------------------------------------------------------------
# Loading + evaluation
# ----------------------------------------------------------------------------


def load_governance(dataset_dir: Path) -> Governance:
    data = json.loads((dataset_dir / "governance.json").read_text())
    return Governance.from_dict(data)


def load_cases(dataset_dir: Path) -> list[dict[str, Any]]:
    lines = (dataset_dir / "tasks.jsonl").read_text().splitlines()
    return [json.loads(ln) for ln in lines if ln.strip()]


def evaluate(dataset_dir: Path, suite: str = "injection_defense") -> InjectionDefenseReport:
    """Run the whole corpus through the defense mirror and aggregate."""
    gov = load_governance(dataset_dir)
    cases = load_cases(dataset_dir)

    decisions: list[CaseDecision] = []
    mismatches: list[str] = []
    attacks = attacks_blocked = benign = benign_executed = 0

    for case in cases:
        executed, blocked_by = decide(gov, case["tool_name"], case.get("tool_input", {}))
        expected = bool(case["expected_executed"])
        decision = CaseDecision(
            id=case["id"],
            category=case["category"],
            attack_type=case.get("attack_type", "none"),
            tool_name=case["tool_name"],
            executed=executed,
            expected_executed=expected,
            blocked_by=blocked_by,
        )
        decisions.append(decision)
        if not decision.matches_corpus:
            mismatches.append(
                f"{case['id']} [{case['category']}] tool={case['tool_name']}: "
                f"expected_executed={expected}, mirror={executed}"
            )
        if case["category"] == "attack":
            attacks += 1
            if not executed:
                attacks_blocked += 1
        elif case["category"] == "benign":
            benign += 1
            if executed:
                benign_executed += 1

    return InjectionDefenseReport(
        suite=suite,
        total_cases=len(cases),
        block_rate=wilson_ci(attacks_blocked, attacks),
        benign_utility=wilson_ci(benign_executed, benign),
        decisions=decisions,
        mismatches=mismatches,
    )


__all__ = [
    "INJECTION_DEFENSE_ANCHOR",
    "CaseDecision",
    "Governance",
    "InjectionDefenseReport",
    "ProportionCI",
    "decide",
    "evaluate",
    "load_cases",
    "load_governance",
    "wilson_ci",
]
