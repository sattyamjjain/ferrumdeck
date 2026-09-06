# FerrumDeck - Development Makefile
# ================================

.PHONY: help dev-up dev-down build test fmt lint clean install quickstart dashboard run-dashboard run-gateway run-worker pull-mcp-image eval-health eval-health-check eval-coherence-fp docs-coherence-fp docs-coherence-fp-check eval-series eval-series-check check-suite-reachability check-route-backing reproduce-readme-figures test-live-stack check-published-versions

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
	@echo "  make eval-health  - Regenerate docs/eval-health.md from evals/reports/"
	@echo "  make eval-health-check - Fail if docs/eval-health.md is stale"
	@echo "  make eval-coherence-fp - Measure the coherence monitor false-positive rate"
	@echo "  make docs-coherence-fp - Render the per-provenance FP data report (docs/reports/)"
	@echo "  make eval-series  - Append new runs to docs/eval-health-series.jsonl"
	@echo "  make eval-series-check - Fail if a published series row was rewritten"
	@echo "  make eval-injection-defense - Run the offline injection-defense benchmark"
	@echo "  make eval-asb     - Run the offline ASB + EU AI Act Art.50 benchmark"
	@echo "  make bench-enforcement - Benchmark the enforcement decision-path latency (criterion)"
	@echo "  make bench-enforce-vs-observe - Observability blind-spot: record-only vs in-path gate"
	@echo "  make bench-governed - Governed-vs-ungoverned: governance overhead + % unsafe blocked"
	@echo "  make reproduce-spend-gate - Reproduce the AP2 + x402 spend-gate figures + assert no drift"
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
	# --lib --tests, not a bare `--ignored`: `--ignored` also force-runs the
	# ```ignore doctest in fd-audit/src/lib.rs, which is illustrative pseudo-code
	# referencing the `ferrumdeck` umbrella and cannot compile here. Without this
	# scope the target always failed, so nobody ran it.
	cargo test --workspace --lib --tests -- --ignored
	uv run pytest -m integration

# The three suites that issue #6 found were reporting "135 collected, 135
# skipped, 0 run". Needs a stack: `make dev-up` (or `make quickstart`) first.
# The verdict is the checker's, not pytest's -- pytest exits non-zero for the
# failures declared in .live-stack-known-failures.yml, and the checker is what
# knows which of those are expected. CI runs the same two commands in the
# `live-stack-tests` job.
test-live-stack:
	@echo "Running live-stack suites (security, chaos, e2e) against $${GATEWAY_URL:-http://localhost:8080}..."
	-uv run pytest tests/security tests/chaos tests/e2e --tb=short --junitxml=live-stack-results.xml
	uv run python scripts/check_live_stack_results.py --junit live-stack-results.xml

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

# Regenerate docs/eval-health.md from the committed report files. The nightly
# runs this too; `eval-health-check` fails if the committed page is stale.
eval-health:
	@echo "Regenerating docs/eval-health.md from evals/reports/..."
	uv run python scripts/gen_eval_health.py

eval-health-check:
	@echo "Checking docs/eval-health.md is up to date..."
	uv run python scripts/gen_eval_health.py --check

# Append one row per eval run not already recorded. The page is a snapshot that
# each refresh overwrites; this is the record that survives it.
# Measure the coherence monitor's false-positive rate on the benign corpus.
# Deterministic and offline (seeded, no LLM, no network) so it can gate a PR --
# and it must, because `crate::coherence_evidence` refuses to activate enforce
# mode unless this number is in the committed series and under its threshold.
eval-coherence-fp:
	@echo "Measuring the coherence monitor's false-positive rate..."
	uv run python -m fd_evals.coherence_negatives

# The per-provenance data report published under docs/reports/. Rendered from
# the committed corpus and the committed report -- never from a local-only run,
# and never from wall-clock time -- so regenerating it on any checkout produces
# the same bytes. `-check` is the staleness gate.
docs-coherence-fp:
	@echo "Rendering docs/reports/coherence-fp-<YYYY>-<MM>.md..."
	uv run python -m fd_evals.coherence_negatives --data-report

docs-coherence-fp-check:
	uv run python -m fd_evals.coherence_negatives --check-data-report

eval-series:
	@echo "Appending new eval runs to docs/eval-health-series.jsonl..."
	uv run python scripts/gen_eval_health.py --append-series

# The committed series must remain a byte-prefix of the working one. A past row
# that changes turns an evidence file into a cache.
eval-series-check:
	@echo "Checking the eval series was appended to, not rewritten..."
	uv run python scripts/gen_eval_health.py --check-series

check-suite-reachability:
	@echo "Checking every declared eval suite is reachable from a workflow trigger..."
	uv run python scripts/check_suite_reachability.py

check-route-backing:
	@echo "Checking every BFF/gateway route reaches a backend or is a declared honest stub..."
	uv run python scripts/check_route_backing.py

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

reproduce-spend-gate:
	@echo "Reproducing the AP2 + x402 spend-gate figures from a clean clone..."
	./scripts/reproduce-spend-gate.sh

reproduce-readme-figures:
	@echo "Re-verifying every numbered claim in README.md (latency + rates + spend)..."
	./scripts/reproduce-readme-figures.sh

reproduce-readme-figures-fast:
	@echo "Re-verifying the README rate + spend figures (skips the ~2min latency bench)..."
	./scripts/reproduce-readme-figures.sh --skip-latency

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

ci-check: check-claims check-changelog-issues eval-health-check eval-series-check docs-coherence-fp-check check-suite-reachability check-route-backing
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

# Release-walk integrity: every crate without `publish = false` must be a step
# in .github/workflows/release-crate.yml AND live on crates.io at the workspace
# version. The walk's failure mode was silence -- ferrumdeck-otel drifted five
# releases behind, then ferrumdeck-dag drifted six -- and this makes it loud.
# `--offline` checks the wiring only, which is what CI can do before a tag.
check-published-versions:
	@echo "Checking every publishable crate is current on crates.io..."
	uv run python scripts/check_published_versions.py

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
