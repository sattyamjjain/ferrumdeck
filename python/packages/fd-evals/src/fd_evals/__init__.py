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

__all__ = [
    "BENCH_AUDIT_ANCHOR",
    "BaseScorer",
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
    "generate_markdown_report",
    "load_bench_audit_report",
    "load_report",
    "load_trace",
    "save_bench_audit_report",
    "save_report",
    "save_trace",
]
