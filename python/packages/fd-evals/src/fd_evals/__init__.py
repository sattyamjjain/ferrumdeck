"""FerrumDeck Evaluation Framework."""

from fd_evals.bench_audit import (
    BENCH_AUDIT_ANCHOR,
    BenchAuditor,
    BenchAuditReport,
    FlagSeverity,
    HygieneClass,
    TaskFlag,
)
from fd_evals.bench_audit import (
    load_report as load_bench_audit_report,
)
from fd_evals.bench_audit import (
    save_report as save_bench_audit_report,
)
from fd_evals.coherence import (
    COHERENCE_ANCHOR,
    CoherenceSpan,
    TrajectoryEvent,
    scan_trajectory,
)
from fd_evals.delta import (
    CostDelta,
    DeltaReport,
    DeltaReporter,
    DeltaStatus,
    ScoreDelta,
    TaskDelta,
    generate_markdown_report,
    load_report,
    save_report,
)
from fd_evals.harness_delta import (
    HARNESS_ANCHOR,
    HarnessDelta,
    HarnessDeltaConfig,
    HarnessDeltaEvidence,
    derive_harness_deltas,
)
from fd_evals.replay import (
    ReplayConfig,
    ReplayMode,
    ReplayRunner,
    ReplayTrace,
    create_trace_from_run,
    load_trace,
    save_trace,
)
from fd_evals.runner import EvalRunner
from fd_evals.scorers import (
    BaseScorer,
    CompositeScorer,
    FilesChangedScorer,
    LintScorer,
    PRCreatedScorer,
    SchemaScorer,
    TestPassScorer,
)
from fd_evals.task import EvalResult, EvalTask
from fd_evals.training_signal import score_overrides_from_results

__all__ = [
    "BENCH_AUDIT_ANCHOR",
    "COHERENCE_ANCHOR",
    "HARNESS_ANCHOR",
    "BaseScorer",
    "CoherenceSpan",
    "TrajectoryEvent",
    "scan_trajectory",
    "BenchAuditReport",
    "BenchAuditor",
    "CompositeScorer",
    "CostDelta",
    "DeltaReport",
    "DeltaReporter",
    "DeltaStatus",
    "EvalResult",
    "EvalRunner",
    "EvalTask",
    "FilesChangedScorer",
    "FlagSeverity",
    "HarnessDelta",
    "HarnessDeltaConfig",
    "HarnessDeltaEvidence",
    "HygieneClass",
    "LintScorer",
    "PRCreatedScorer",
    "ReplayConfig",
    "ReplayMode",
    "ReplayRunner",
    "ReplayTrace",
    "SchemaScorer",
    "ScoreDelta",
    "TaskDelta",
    "TaskFlag",
    "TestPassScorer",
    "create_trace_from_run",
    "derive_harness_deltas",
    "generate_markdown_report",
    "load_bench_audit_report",
    "load_report",
    "load_trace",
    "save_bench_audit_report",
    "save_report",
    "save_trace",
    "score_overrides_from_results",
]
