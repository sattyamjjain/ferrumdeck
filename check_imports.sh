#!/bin/bash
# Check if Python packages can be imported correctly
# This script verifies the package structure without running complex analysis

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FERRUMDECK_ROOT="$SCRIPT_DIR"
cd "$FERRUMDECK_ROOT"

echo "======================================================================"
echo "FerrumDeck Python Package Import Verification"
echo "======================================================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

errors=0
warnings=0

# Function to check file exists
check_file() {
    local file=$1
    local desc=$2
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓${NC} $desc exists: $file"
        return 0
    else
        echo -e "${RED}✗${NC} $desc missing: $file"
        ((errors++))
        return 1
    fi
}

# Function to check directory exists
check_dir() {
    local dir=$1
    local desc=$2
    if [ -d "$dir" ]; then
        echo -e "${GREEN}✓${NC} $desc exists: $dir"
        return 0
    else
        echo -e "${RED}✗${NC} $desc missing: $dir"
        ((errors++))
        return 1
    fi
}

# Function to check __all__ in __init__.py
check_exports() {
    local init_file=$1
    local package_name=$2

    if grep -q "__all__" "$init_file"; then
        echo -e "${GREEN}✓${NC} $package_name has __all__ definition"
        return 0
    else
        echo -e "${YELLOW}⚠${NC} $package_name missing __all__ definition"
        ((warnings++))
        return 1
    fi
}

# Check fd-evals
echo "Checking fd-evals..."
echo "----------------------------------------------------------------------"
check_file "python/packages/fd-evals/pyproject.toml" "fd-evals pyproject.toml"
check_dir "python/packages/fd-evals/src/fd_evals" "fd-evals source directory"
check_file "python/packages/fd-evals/src/fd_evals/__init__.py" "fd-evals __init__.py"
check_file "python/packages/fd-evals/src/fd_evals/replay.py" "fd-evals replay module"
check_file "python/packages/fd-evals/src/fd_evals/delta.py" "fd-evals delta module"
check_dir "python/packages/fd-evals/src/fd_evals/scorers" "fd-evals scorers directory"
check_file "python/packages/fd-evals/src/fd_evals/scorers/__init__.py" "fd-evals scorers __init__.py"
check_exports "python/packages/fd-evals/src/fd_evals/__init__.py" "fd-evals"
echo ""

# Check fd-worker
echo "Checking fd-worker..."
echo "----------------------------------------------------------------------"
check_file "python/packages/fd-worker/pyproject.toml" "fd-worker pyproject.toml"
check_dir "python/packages/fd-worker/src/fd_worker" "fd-worker source directory"
check_file "python/packages/fd-worker/src/fd_worker/__init__.py" "fd-worker __init__.py"
check_file "python/packages/fd-worker/src/fd_worker/validation.py" "fd-worker validation module"
check_file "python/packages/fd-worker/src/fd_worker/llm.py" "fd-worker llm module"
check_file "python/packages/fd-worker/src/fd_worker/executor.py" "fd-worker executor module"
check_exports "python/packages/fd-worker/src/fd_worker/__init__.py" "fd-worker"
echo ""

# Check fd-mcp-tools
echo "Checking fd-mcp-tools..."
echo "----------------------------------------------------------------------"
check_file "python/packages/fd-mcp-tools/pyproject.toml" "fd-mcp-tools pyproject.toml"
check_dir "python/packages/fd-mcp-tools/src/fd_mcp_tools" "fd-mcp-tools source directory"
check_file "python/packages/fd-mcp-tools/src/fd_mcp_tools/__init__.py" "fd-mcp-tools __init__.py"
check_file "python/packages/fd-mcp-tools/src/fd_mcp_tools/git_server.py" "fd-mcp-tools git_server module"
check_file "python/packages/fd-mcp-tools/src/fd_mcp_tools/test_runner_server.py" "fd-mcp-tools test_runner_server module"
echo ""

# Check fd-runtime
echo "Checking fd-runtime..."
echo "----------------------------------------------------------------------"
check_file "python/packages/fd-runtime/pyproject.toml" "fd-runtime pyproject.toml"
check_dir "python/packages/fd-runtime/src/fd_runtime" "fd-runtime source directory"
check_file "python/packages/fd-runtime/src/fd_runtime/__init__.py" "fd-runtime __init__.py"
check_file "python/packages/fd-runtime/src/fd_runtime/models.py" "fd-runtime models module"
check_file "python/packages/fd-runtime/src/fd_runtime/artifacts.py" "fd-runtime artifacts module"
check_file "python/packages/fd-runtime/src/fd_runtime/tracing.py" "fd-runtime tracing module"
check_file "python/packages/fd-runtime/src/fd_runtime/workflow.py" "fd-runtime workflow module"
check_file "python/packages/fd-runtime/src/fd_runtime/client.py" "fd-runtime client module"
check_exports "python/packages/fd-runtime/src/fd_runtime/__init__.py" "fd-runtime"
echo ""

# Summary
echo "======================================================================"
echo "Summary"
echo "======================================================================"
if [ $errors -eq 0 ]; then
    echo -e "${GREEN}✓ All structure checks passed!${NC}"
else
    echo -e "${RED}✗ Found $errors error(s)${NC}"
fi

if [ $warnings -gt 0 ]; then
    echo -e "${YELLOW}⚠ Found $warnings warning(s)${NC}"
fi

echo ""
echo "To verify imports work, run:"
echo "  cd $FERRUMDECK_ROOT"
echo "  python3 verify_packages.py"
echo ""

exit $errors
