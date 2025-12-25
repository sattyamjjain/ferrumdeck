"""FerrumDeck Evaluation Framework."""

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
    "BaseScorer",
    "CompositeScorer",
    "CostDelta",
    "DeltaReport",
    "DeltaReporter",
    "DeltaStatus",
    "EvalResult",
    "EvalRunner",
    "EvalTask",
    "FilesChangedScorer",
    "LintScorer",
    "PRCreatedScorer",
    "ReplayConfig",
    "ReplayMode",
    "ReplayRunner",
    "ReplayTrace",
    "SchemaScorer",
    "ScoreDelta",
    "TaskDelta",
    "TestPassScorer",
    "create_trace_from_run",
    "generate_markdown_report",
    "load_report",
    "load_trace",
    "save_report",
    "save_trace",
]
