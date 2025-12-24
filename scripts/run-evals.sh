#!/usr/bin/env bash
# =============================================================================
# Run evaluation suite with optional validation modes
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

cd "$PROJECT_ROOT"

# Default values
SUITE="${1:-smoke}"
PARALLEL="${PARALLEL:-1}"
RUNS="${RUNS:-1}"
OUTPUT_DIR="${OUTPUT_DIR:-$PROJECT_ROOT/evals/reports}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

usage() {
    cat << EOF
Usage: $0 [SUITE] [OPTIONS]

Run FerrumDeck evaluation suite.

Arguments:
  SUITE         Evaluation suite to run (default: smoke)
                Options: smoke, regression, all

Options (via environment variables):
  PARALLEL=N    Run N tasks in parallel (default: 1)
  RUNS=N        Run each task N times for consistency check (default: 1)
  OUTPUT_DIR    Directory for reports (default: evals/reports)

Examples:
  $0                        # Run smoke tests
  $0 regression             # Run regression suite
  RUNS=20 $0 smoke          # Run smoke tests 20x each (MVP validation)
  PARALLEL=4 $0 all         # Run all tests with 4 parallel workers

EOF
    exit 0
}

# Check if help requested
if [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
    usage
fi

# Validate suite
validate_suite() {
    case "$SUITE" in
        smoke|regression|all)
            return 0
            ;;
        *)
            log_error "Unknown suite: $SUITE"
            log_info "Available suites: smoke, regression, all"
            exit 1
            ;;
    esac
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Python environment
    if ! command -v uv &> /dev/null; then
        log_error "uv not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
        exit 1
    fi

    # Check if fd-evals is installed
    if ! uv run python -c "import fd_evals" 2>/dev/null; then
        log_warn "fd-evals not installed. Running uv sync..."
        uv sync
    fi

    # Check environment
    if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
        log_warn "No .env file found. Using defaults."
    fi

    # Source environment
    if [[ -f "$PROJECT_ROOT/.env" ]]; then
        set -a
        # shellcheck source=/dev/null
        source "$PROJECT_ROOT/.env"
        set +a
    fi

    log_info "Prerequisites OK"
}

# Run smoke tests
run_smoke() {
    log_info "Running smoke test suite..."

    local report_file="$OUTPUT_DIR/smoke_${TIMESTAMP}.json"
    mkdir -p "$OUTPUT_DIR"

    uv run python -m fd_evals run \
        --suite smoke \
        --parallel "$PARALLEL" \
        --output "$report_file" \
        ${RUNS:+--runs "$RUNS"}

    log_info "Smoke test report: $report_file"
}

# Run regression tests
run_regression() {
    log_info "Running regression test suite..."

    local report_file="$OUTPUT_DIR/regression_${TIMESTAMP}.json"
    mkdir -p "$OUTPUT_DIR"

    uv run python -m fd_evals run \
        --suite regression \
        --parallel "$PARALLEL" \
        --output "$report_file" \
        ${RUNS:+--runs "$RUNS"}

    log_info "Regression test report: $report_file"
}

# Run all tests
run_all() {
    run_smoke
    echo ""
    run_regression
}

# MVP validation: Run same task 20 times
run_mvp_validation() {
    log_info "Running MVP validation (20 runs per task)..."

    local report_file="$OUTPUT_DIR/mvp_validation_${TIMESTAMP}.json"
    mkdir -p "$OUTPUT_DIR"

    RUNS=20 uv run python -m fd_evals run \
        --suite smoke \
        --parallel 1 \
        --output "$report_file" \
        --runs 20

    log_info "MVP validation report: $report_file"

    # Analyze consistency
    log_info "Analyzing consistency..."
    uv run python -c "
import json
import sys

with open('$report_file') as f:
    report = json.load(f)

total_runs = 0
passed_runs = 0
task_results = {}

for result in report.get('results', []):
    task_id = result.get('task_id', 'unknown')
    passed = result.get('passed', False)

    if task_id not in task_results:
        task_results[task_id] = {'passed': 0, 'failed': 0}

    if passed:
        task_results[task_id]['passed'] += 1
        passed_runs += 1
    else:
        task_results[task_id]['failed'] += 1

    total_runs += 1

print()
print('MVP Validation Summary')
print('=' * 50)
print(f'Total runs: {total_runs}')
print(f'Passed: {passed_runs} ({100*passed_runs/total_runs:.1f}%)')
print(f'Failed: {total_runs - passed_runs} ({100*(total_runs-passed_runs)/total_runs:.1f}%)')
print()
print('Per-task consistency:')
for task_id, counts in sorted(task_results.items()):
    total = counts['passed'] + counts['failed']
    consistency = 100 * counts['passed'] / total
    status = '✓' if consistency == 100 else '⚠' if consistency >= 80 else '✗'
    print(f'  {status} {task_id}: {counts[\"passed\"]}/{total} ({consistency:.0f}%)')
print()

# Check if MVP criteria met (>95% consistency)
overall_consistency = 100 * passed_runs / total_runs
if overall_consistency >= 95:
    print('✓ MVP criteria MET: >95% consistency')
    sys.exit(0)
else:
    print(f'✗ MVP criteria NOT MET: {overall_consistency:.1f}% < 95%')
    sys.exit(1)
"
}

# Generate comparison report
generate_comparison() {
    log_info "Generating comparison report..."

    local latest_reports
    latest_reports=$(find "$OUTPUT_DIR" -name "*.json" -type f | sort -r | head -5)

    if [[ -z "$latest_reports" ]]; then
        log_warn "No previous reports found for comparison"
        return 0
    fi

    log_info "Latest reports:"
    echo "$latest_reports" | while read -r report; do
        echo "  - $(basename "$report")"
    done

    # Generate comparison using fd-evals
    uv run python -m fd_evals compare \
        --reports $latest_reports \
        --output "$OUTPUT_DIR/comparison_${TIMESTAMP}.html" \
        2>/dev/null || log_warn "Comparison generation not implemented yet"
}

# Main
main() {
    echo ""
    echo "=============================================="
    echo "  FerrumDeck Evaluation Runner"
    echo "=============================================="
    echo ""
    echo "Suite:    $SUITE"
    echo "Parallel: $PARALLEL"
    echo "Runs:     $RUNS"
    echo "Output:   $OUTPUT_DIR"
    echo ""

    validate_suite
    check_prerequisites

    echo ""

    case "$SUITE" in
        smoke)
            run_smoke
            ;;
        regression)
            run_regression
            ;;
        all)
            run_all
            ;;
    esac

    # If running MVP validation (20 runs)
    if [[ "$RUNS" -ge 20 ]]; then
        echo ""
        run_mvp_validation
    fi

    echo ""
    log_info "Evaluation complete!"
}

main "$@"
