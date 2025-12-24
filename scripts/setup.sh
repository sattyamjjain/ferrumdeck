#!/usr/bin/env bash
# =============================================================================
# Development environment setup script
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
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

cd "$PROJECT_ROOT"

# Check prerequisites
check_prerequisites() {
    log_step "Checking prerequisites..."

    local missing=()

    # Check Rust
    if command -v rustc &> /dev/null; then
        local rust_version
        rust_version=$(rustc --version | cut -d' ' -f2)
        log_info "  ✓ Rust $rust_version"
    else
        missing+=("rust")
        log_error "  ✗ Rust not found. Install from https://rustup.rs"
    fi

    # Check Python
    if command -v python3 &> /dev/null; then
        local python_version
        python_version=$(python3 --version | cut -d' ' -f2)
        log_info "  ✓ Python $python_version"
    else
        missing+=("python3")
        log_error "  ✗ Python 3 not found"
    fi

    # Check uv
    if command -v uv &> /dev/null; then
        local uv_version
        uv_version=$(uv --version | cut -d' ' -f2)
        log_info "  ✓ uv $uv_version"
    else
        missing+=("uv")
        log_warn "  ✗ uv not found. Install with: curl -LsSf https://astral.sh/uv/install.sh | sh"
    fi

    # Check Docker
    if command -v docker &> /dev/null; then
        log_info "  ✓ Docker"
    else
        missing+=("docker")
        log_warn "  ✗ Docker not found (optional but recommended)"
    fi

    # Check Docker Compose
    if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
        log_info "  ✓ Docker Compose"
    else
        log_warn "  ✗ Docker Compose not found (optional but recommended)"
    fi

    if [[ ${#missing[@]} -gt 0 ]]; then
        echo ""
        log_warn "Missing required tools: ${missing[*]}"
        log_warn "Please install missing tools and re-run this script."
        return 1
    fi

    echo ""
    return 0
}

# Setup environment file
setup_env() {
    log_step "Setting up environment..."

    if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        log_info "  Created .env from .env.example"
        log_warn "  Please update .env with your API keys"
    else
        log_info "  .env already exists"
    fi

    echo ""
}

# Install Rust dependencies
setup_rust() {
    log_step "Installing Rust dependencies..."

    cargo fetch
    log_info "  Rust dependencies installed"

    echo ""
}

# Install Python dependencies
setup_python() {
    log_step "Installing Python dependencies..."

    if command -v uv &> /dev/null; then
        uv sync
        log_info "  Python dependencies installed with uv"
    else
        log_warn "  uv not found, trying pip..."
        python3 -m pip install -e ".[dev]"
    fi

    echo ""
}

# Start development services
start_services() {
    log_step "Starting development services..."

    if ! command -v docker &> /dev/null; then
        log_warn "  Docker not found, skipping services"
        return 0
    fi

    docker compose -f deploy/docker/compose.dev.yaml up -d

    log_info "  Services started:"
    log_info "    - PostgreSQL: localhost:5433"
    log_info "    - Redis: localhost:6379"
    log_info "    - Jaeger UI: http://localhost:16686"
    log_info "    - OTel Collector: localhost:4317"

    echo ""
}

# Wait for services to be ready
wait_for_services() {
    log_step "Waiting for services to be ready..."

    local max_attempts=30
    local attempt=0

    # Wait for PostgreSQL
    while ! docker compose -f deploy/docker/compose.dev.yaml exec -T postgres pg_isready -U ferrumdeck &> /dev/null; do
        ((attempt++))
        if [[ $attempt -ge $max_attempts ]]; then
            log_error "  PostgreSQL failed to start"
            return 1
        fi
        sleep 1
    done
    log_info "  ✓ PostgreSQL is ready"

    # Wait for Redis
    attempt=0
    while ! docker compose -f deploy/docker/compose.dev.yaml exec -T redis redis-cli ping &> /dev/null; do
        ((attempt++))
        if [[ $attempt -ge $max_attempts ]]; then
            log_error "  Redis failed to start"
            return 1
        fi
        sleep 1
    done
    log_info "  ✓ Redis is ready"

    echo ""
}

# Run database migrations
run_migrations() {
    log_step "Running database migrations..."

    # Apply migrations using psql
    for migration in db/migrations/*.sql; do
        if [[ -f "$migration" ]]; then
            local name
            name=$(basename "$migration")
            log_info "  Applying: $name"
            docker compose -f deploy/docker/compose.dev.yaml exec -T postgres \
                psql -U ferrumdeck -d ferrumdeck -f "/docker-entrypoint-initdb.d/$(basename "$migration")" \
                2>/dev/null || true
        fi
    done

    # Alternative: Use sqlx if available
    if command -v sqlx &> /dev/null; then
        export DATABASE_URL="postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck"
        sqlx migrate run --source db/migrations 2>/dev/null || true
    fi

    log_info "  Migrations complete"
    echo ""
}

# Build projects
build_all() {
    log_step "Building projects..."

    log_info "  Building Rust..."
    cargo build --workspace

    log_info "  Building Python..."
    if command -v uv &> /dev/null; then
        uv build 2>/dev/null || true
    fi

    log_info "  Build complete"
    echo ""
}

# Print summary
print_summary() {
    echo ""
    echo "=============================================="
    echo -e "${GREEN}FerrumDeck Development Environment Ready!${NC}"
    echo "=============================================="
    echo ""
    echo "Quick commands:"
    echo "  make dev-up       Start services"
    echo "  make dev-down     Stop services"
    echo "  make build        Build all"
    echo "  make test         Run tests"
    echo "  make run-gateway  Start API gateway"
    echo "  make run-worker   Start Python worker"
    echo ""
    echo "Services:"
    echo "  PostgreSQL:  localhost:5433"
    echo "  Redis:       localhost:6379"
    echo "  Jaeger UI:   http://localhost:16686"
    echo "  Gateway API: http://localhost:8080 (when running)"
    echo ""
}

# Main
main() {
    echo ""
    echo "=============================================="
    echo "  FerrumDeck Development Setup"
    echo "=============================================="
    echo ""

    check_prerequisites || exit 1
    setup_env
    setup_rust
    setup_python

    if [[ "${1:-}" != "--no-services" ]]; then
        start_services
        wait_for_services
        run_migrations
    fi

    build_all
    print_summary
}

main "$@"
