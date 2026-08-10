# FerrumDeck - Development Makefile
# ================================

.PHONY: help dev-up dev-down build test fmt lint clean install quickstart dashboard run-dashboard run-gateway run-worker pull-mcp-image

# Default target
help:
	@echo "FerrumDeck Development Commands"
	@echo "================================"
	@echo ""
	@echo "Quick Start:"
	@echo "  make quickstart   - Start everything (infra + gateway + worker + dashboard)"
	@echo "  make dashboard    - Open the dashboard UI in browser"
	@echo ""
	@echo "Setup:"
	@echo "  make install      - Install all dependencies (Rust + Python)"
	@echo ""
	@echo "Development:"
	@echo "  make dev-up       - Start local dev environment (Docker)"
	@echo "  make dev-down     - Stop local dev environment"
	@echo "  make dev-logs     - Tail logs from all services"
	@echo "  make run-gateway  - Run gateway locally (not in Docker)"
	@echo "  make run-worker   - Run worker locally with MCP tools"
	@echo "  make run-dashboard- Start dashboard web server"
	@echo ""
	@echo "Build:"
	@echo "  make build        - Build all (Rust + Python)"
	@echo "  make build-rust   - Build Rust services"
	@echo "  make build-python - Build Python packages"
	@echo ""
	@echo "Test:"
	@echo "  make test         - Run all tests"
	@echo "  make test-rust    - Run Rust tests"
	@echo "  make test-python  - Run Python tests"
	@echo ""
	@echo "Code Quality:"
	@echo "  make fmt          - Format all code"
	@echo "  make lint         - Lint all code"
	@echo "  make check        - Run all checks (fmt + lint + test)"
	@echo ""
	@echo "Database:"
	@echo "  make db-migrate   - Run database migrations"
	@echo "  make db-reset     - Reset database (drop + migrate + seed)"
	@echo ""
	@echo "Evals (requires ANTHROPIC_API_KEY):"
	@echo "  make eval-run     - Run smoke evaluation suite"
	@echo "  make eval-run-full- Run full regression suite"
	@echo "  make eval-report  - Generate report from latest results"
	@echo "  make eval-injection-defense - Run the offline injection-defense benchmark"
	@echo "  make eval-asb     - Run the offline ASB + EU AI Act Art.50 benchmark"
	@echo "  make bench-enforcement - Benchmark the enforcement decision-path latency (criterion)"
	@echo "  make bench-enforce-vs-observe - Observability blind-spot: record-only vs in-path gate"
	@echo "  make bench-governed - Governed-vs-ungoverned: governance overhead + % unsafe blocked"
	@echo "  make demo-x402    - x402 spend gate halting an over-budget autonomous payment"
	@echo ""
	@echo "Clean:"
	@echo "  make clean        - Clean build artifacts"

# =============================================================================
# Setup
# =============================================================================

install: install-rust install-python
	@echo "All dependencies installed"

install-rust:
	@echo "Installing Rust dependencies..."
	cargo fetch

install-python:
	@echo "Installing Python dependencies..."
	uv sync

# =============================================================================
# Development Environment
# =============================================================================

dev-up:
	@echo "Starting development environment..."
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml up -d
	@echo ""
	@echo "Services started:"
	@echo "  - PostgreSQL: localhost:5433"
	@echo "  - Redis:      localhost:6379"
	@echo "  - Gateway:    http://localhost:8080"
	@echo "  - Jaeger UI:  http://localhost:16686"
	@echo "  - OTel:       localhost:4317 (gRPC), localhost:4318 (HTTP)"

dev-down:
	@echo "Stopping development environment..."
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml down

dev-logs:
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml logs -f

dev-ps:
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml ps

# =============================================================================
# Build
# =============================================================================

build: build-rust build-python
	@echo "Build complete"

build-rust:
	@echo "Building Rust services..."
	cargo build --workspace

build-python:
	@echo "Building Python packages..."
	uv build

build-release:
	@echo "Building release binaries..."
	cargo build --workspace --release

# =============================================================================
# Test
# =============================================================================

test: test-rust test-python
	@echo "All tests passed"

test-rust:
	@echo "Running Rust tests..."
	cargo test --workspace

test-python:
	@echo "Running Python tests..."
	uv sync --quiet
	uv run pytest python/packages/fd-evals/tests/ -v
	uv run pytest python/packages/fd-worker/tests/ -v

test-integration:
	@echo "Running integration tests..."
	cargo test --workspace -- --ignored
	uv run pytest -m integration

# =============================================================================
# Code Quality
# =============================================================================

fmt: fmt-rust fmt-python
	@echo "Formatting complete"

fmt-rust:
	@echo "Formatting Rust code..."
	cargo fmt --all

fmt-python:
	@echo "Formatting Python code..."
	uv run ruff format python/

lint: lint-rust lint-python
	@echo "Linting complete"

lint-rust:
	@echo "Linting Rust code..."
	cargo clippy --workspace --all-targets -- -D warnings

lint-python:
	@echo "Linting Python code..."
	uv run ruff check python/
	uv run pyright python/

check: fmt lint test
	@echo "All checks passed"

# =============================================================================
# Database
# =============================================================================

db-migrate:
	@echo "Running database migrations..."
	@echo "Migrations run automatically on gateway startup."
	@echo "To run manually, restart the gateway container:"
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml restart gateway

db-reset:
	@echo "Resetting database..."
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml exec -T postgres psql -U ferrumdeck -d ferrumdeck -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE EXTENSION IF NOT EXISTS vector;"
	@echo "Restarting gateway to run migrations..."
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml restart gateway
	@sleep 5
	@echo "Seeding database..."
	$(MAKE) db-seed

db-seed:
	@echo "Seeding database with test data..."
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml exec -T postgres psql -U ferrumdeck -d ferrumdeck -f /docker-entrypoint-initdb.d/init.sql

# =============================================================================
# Services (Development)
# =============================================================================

run-gateway:
	@echo "Starting Gateway service..."
	cargo run --package gateway

run-worker:
	@echo "Starting Python worker with MCP tools..."
	@echo "GitHub MCP Server: Docker-based (ghcr.io/github/github-mcp-server)"
	@echo ""
	REDIS_URL=redis://localhost:6379 \
	CONTROL_PLANE_URL=http://localhost:8080 \
	OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
	GITHUB_PERSONAL_ACCESS_TOKEN=$(GITHUB_TOKEN) \
	MCP_CONFIG_PATH=./config/mcp-config.json \
	uv run python -m fd_worker

run-dashboard:
	@echo "Starting Dashboard web server..."
	@echo "Dashboard URL: http://localhost:8000"
	@echo ""
	cd deploy/dashboard && python3 -m http.server 8000

# =============================================================================
# Quick Start
# =============================================================================

quickstart: pull-mcp-image
	@echo "=============================================="
	@echo "  FerrumDeck Quick Start"
	@echo "=============================================="
	@echo ""
	@echo "Starting infrastructure services..."
	@$(MAKE) dev-up
	@sleep 3
	@echo ""
	@echo "=============================================="
	@echo "  Services Ready!"
	@echo "=============================================="
	@echo ""
	@echo "  Dashboard:  http://localhost:8000"
	@echo "  Gateway:    http://localhost:8080"
	@echo "  Jaeger:     http://localhost:16686"
	@echo ""
	@echo "To start the dashboard, run in a new terminal:"
	@echo "  make run-dashboard"
	@echo ""
	@echo "To run services locally (instead of Docker):"
	@echo "  Terminal 1: make run-gateway"
	@echo "  Terminal 2: make run-worker"
	@echo ""

dashboard:
	@echo "Opening dashboard..."
	@open http://localhost:8000 2>/dev/null || xdg-open http://localhost:8000 2>/dev/null || echo "Open http://localhost:8000 in your browser"

pull-mcp-image:
	@echo "Pulling GitHub MCP Server Docker image..."
	@docker pull ghcr.io/github/github-mcp-server 2>/dev/null || echo "Note: Docker pull failed, will pull on first use"

# =============================================================================
# Contracts / Code Generation
# =============================================================================

gen-openapi:
	@echo "Generating OpenAPI clients..."
	./scripts/gen_openapi.sh

gen-schemas:
	@echo "Validating JSON schemas..."
	./scripts/gen_schemas.sh

# =============================================================================
# Evals
# =============================================================================

eval-run:
	@echo "Running evaluation suite..."
	FD_API_KEY=fd_dev_key_abc123 uv run python -m fd_evals run --suite evals/suites/smoke.yaml --agent agt_01JFVX0000000000000000001

eval-run-full:
	@echo "Running full evaluation suite..."
	FD_API_KEY=fd_dev_key_abc123 uv run python -m fd_evals run --suite evals/suites/regression.yaml --agent agt_01JFVX0000000000000000001

eval-report:
	@echo "Generating evaluation report..."
	@LATEST=$$(ls -t evals/reports/*.json 2>/dev/null | head -1) && \
	if [ -n "$$LATEST" ]; then \
		uv run python -m fd_evals report "$$LATEST"; \
	else \
		echo "No eval results found in evals/reports/"; \
	fi

eval-injection-defense:
	@echo "Running injection-defense benchmark (deterministic, offline, no LLM)..."
	uv run python -m fd_evals injection-defense --suite injection_defense

eval-asb:
	@echo "Running ASB + EU AI Act Art.50 benchmark (deterministic, offline, seeded, no LLM)..."
	uv run python -m fd_evals asb --suite asb --seed 0

bench-enforcement:
	@echo "Running enforcement decision-path latency benchmark (criterion, offline)..."
	./scripts/bench-enforcement.sh

bench-enforce-vs-observe:
	@echo "Running observability blind-spot benchmark (record-only vs in-path gate, offline)..."
	uv run python evals/enforce_vs_observe.py

bench-governed:
	@echo "Running governed-vs-ungoverned benchmark (overhead + blocked %, deterministic, offline)..."
	uv run python -m fd_evals governed-benchmark

demo-x402:
	@echo "Running x402 spend-gate demo (simulate + gate + record; no real money, self-verifying)..."
	cargo run --quiet -p ferrumdeck --example x402_spend_gate

# =============================================================================
# Clean
# =============================================================================

clean: clean-rust clean-python clean-docker
	@echo "Clean complete"

clean-rust:
	@echo "Cleaning Rust artifacts..."
	cargo clean

clean-python:
	@echo "Cleaning Python artifacts..."
	rm -rf python/packages/*/.ruff_cache
	rm -rf python/packages/*/__pycache__
	rm -rf .pytest_cache
	rm -rf .ruff_cache

clean-docker:
	@echo "Cleaning Docker volumes..."
	docker compose --env-file .env -f deploy/docker/compose.dev.yaml down -v

# =============================================================================
# CI Helpers
# =============================================================================

ci-check: check-claims check-changelog-issues
	@echo "Running CI checks..."
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace
	uv run ruff check python/
	uv run ruff format --check python/
	uv run pytest

# Claims integrity: README Key Features markers + ROADMAP + the test-count block
# must agree with the single source docs/feature-status.yml. Text-only (no build).
check-claims:
	@echo "Checking claims integrity (README/ROADMAP vs docs/feature-status.yml)..."
	uv run python scripts/check_claims_integrity.py

# Changelog honesty: every open/closed issue claim in the CHANGELOG [Unreleased]
# section must match live GitHub issue state (guards against the class where an
# entry says "#N stays open" while #N is closed, or vice versa). Network-resilient
# — warns and passes if GitHub is unreachable, fails only on a real mismatch.
check-changelog-issues:
	@echo "Checking CHANGELOG [Unreleased] issue references against GitHub..."
	uv run python scripts/check_changelog_issue_refs.py

# Re-derive the test counts (shells out to pytest/cargo) and verify them against
# docs/feature-status.yml. Run after adding/removing tests, then update the source.
claims-recount:
	uv run python scripts/check_claims_integrity.py --recount

# Print the canonical repo "About" description (docs/../.github/repo-metadata.yml)
# for pasting into GitHub Settings. The repo-description-consistency CI job fails
# at release time if the live GitHub description drifts from this value.
.PHONY: repo-description
repo-description:
	@sed -n 's/^description: *"\(.*\)"$$/\1/p' .github/repo-metadata.yml
