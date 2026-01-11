# FerrumDeck Complete Handover & Testing Guide

This document provides step-by-step instructions to manually test every component of the FerrumDeck AgentOps Control Plane.

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Prerequisites](#2-prerequisites)
3. [Environment Setup](#3-environment-setup)
4. [Starting Infrastructure](#4-starting-infrastructure)
5. [Testing the Gateway (Rust Control Plane)](#5-testing-the-gateway-rust-control-plane)
6. [Testing the Worker (Python Data Plane)](#6-testing-the-worker-python-data-plane)
7. [Testing the Dashboard (Next.js UI)](#7-testing-the-dashboard-nextjs-ui)
8. [End-to-End Flow Testing](#8-end-to-end-flow-testing)
9. [Running Evaluations](#9-running-evaluations)
10. [Docker Testing](#10-docker-testing)
11. [Observability & Tracing](#11-observability--tracing)
12. [Cleanup](#12-cleanup)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Project Overview

### Architecture
```
┌─────────────────────────────────────────────────────────────────┐
│                         FerrumDeck                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Dashboard  │    │   Gateway    │    │    Worker    │       │
│  │  (Next.js)   │───▶│   (Rust)     │◀───│   (Python)   │       │
│  │  Port 3000   │    │  Port 8080   │    │              │       │
│  └──────────────┘    └──────┬───────┘    └──────┬───────┘       │
│                             │                    │               │
│                      ┌──────▼───────┐    ┌──────▼───────┐       │
│                      │  PostgreSQL  │    │    Redis     │       │
│                      │  Port 5433   │    │  Port 6379   │       │
│                      └──────────────┘    └──────────────┘       │
│                                                                  │
│                      ┌──────────────┐                           │
│                      │    Jaeger    │                           │
│                      │  Port 16686  │                           │
│                      └──────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

### Components
| Component | Technology | Purpose |
|-----------|------------|---------|
| Gateway | Rust (Axum) | API server, policy enforcement, orchestration |
| Worker | Python | LLM execution, MCP tool routing, step processing |
| Dashboard | Next.js 16 | Admin UI for monitoring and management |
| PostgreSQL | Database | Persistent storage for runs, agents, policies |
| Redis | Queue | Job queue for step execution |
| Jaeger | Tracing | Distributed tracing visualization |

---

## 2. Prerequisites

### Required Software
```bash
# Check Rust (1.80+)
rustc --version
# Expected: rustc 1.80.0 or higher

# Check Python (3.12+)
python3 --version
# Expected: Python 3.12.x or higher

# Check Node.js (20+)
node --version
# Expected: v20.x.x or higher

# Check Docker & Docker Compose
docker --version
docker compose version
# Expected: Docker 24+ and Compose v2+

# Check uv (Python package manager)
uv --version
# If not installed: curl -LsSf https://astral.sh/uv/install.sh | sh

# Check make
make --version
```

### API Keys (for full testing)
```bash
# Required for LLM calls and evals
export ANTHROPIC_API_KEY="sk-ant-api03-..."

# Verify it's set
echo $ANTHROPIC_API_KEY
```

---

## 3. Environment Setup

### Clone and Install Dependencies
```bash
# Navigate to project
cd /Users/sattyamjain/CommonProjects/ferrumdeck

# Install all dependencies (Rust + Python + Node)
make install

# This runs:
# - cargo build --workspace
# - uv sync
# - cd nextjs && npm install
```

### Verify Installation
```bash
# Check Rust builds
cargo check --workspace
# Expected: Compiling... Finished

# Check Python packages
uv pip list | grep fd-
# Expected:
# fd-cli, fd-evals, fd-mcp-router, fd-mcp-tools, fd-runtime, fd-worker

# Check Node packages
cd nextjs && npm list --depth=0 | head -20
cd ..
# Expected: List of installed packages
```

### Create Environment File (Optional)
```bash
# Copy example env if it exists, or create one
cat > .env << 'EOF'
DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck
REDIS_URL=redis://localhost:6379
RUST_LOG=info,gateway=debug
GATEWAY_PORT=8080
ANTHROPIC_API_KEY=your-key-here
EOF
```

---

## 4. Starting Infrastructure

### Start Docker Services
```bash
# Start PostgreSQL, Redis, and Jaeger
make dev-up

# Expected output:
# [+] Running 3/3
# ✔ Container ferrumdeck-postgres-1  Started
# ✔ Container ferrumdeck-redis-1     Started
# ✔ Container ferrumdeck-jaeger-1    Started
```

### Verify Services Are Running
```bash
# Check Docker containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Expected:
# NAMES                      STATUS          PORTS
# ferrumdeck-postgres-1      Up X seconds    0.0.0.0:5433->5432/tcp
# ferrumdeck-redis-1         Up X seconds    0.0.0.0:6379->6379/tcp
# ferrumdeck-jaeger-1        Up X seconds    Various ports...

# Test PostgreSQL connection
PGPASSWORD=ferrumdeck psql -h localhost -p 5433 -U ferrumdeck -d ferrumdeck -c "SELECT 1 as test;"
# Expected: test | 1

# Test Redis connection
redis-cli -p 6379 ping
# Expected: PONG

# Test Jaeger UI
curl -s http://localhost:16686 | head -1
# Expected: HTML content (or open in browser)
```

---

## 5. Testing the Gateway (Rust Control Plane)

### Build and Start Gateway
```bash
# Build in release mode (faster)
cargo build --package gateway --release

# Start the gateway
# Terminal 1:
./target/release/gateway

# OR use make command:
make run-gateway

# Expected output:
# INFO gateway: Starting FerrumDeck Gateway
# INFO gateway: Running migrations...
# INFO gateway: Listening on 0.0.0.0:8080
```

### Test Gateway Health
```bash
# Health check
curl http://localhost:8080/health
# Expected: {"status":"healthy"}

# Ready check
curl http://localhost:8080/ready
# Expected: {"status":"ready","database":"ok","redis":"ok"}
```

### Test API Endpoints

#### Projects API
```bash
# Create a project
curl -X POST http://localhost:8080/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Project", "description": "For testing"}'
# Expected: {"id":"prj_01...","name":"Test Project",...}

# List projects
curl http://localhost:8080/api/v1/projects
# Expected: {"projects":[...],"total":1}
```

#### Agents API
```bash
# Create an agent
curl -X POST http://localhost:8080/api/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-agent",
    "slug": "test-agent",
    "description": "A test agent",
    "project_id": "prj_01XXXXXXXXXXXXXXXXXXXXXXXXX"
  }'
# Expected: {"id":"agt_01...","name":"test-agent",...}

# List agents
curl http://localhost:8080/api/v1/agents
# Expected: {"agents":[...],"total":1}

# Get agent by slug
curl http://localhost:8080/api/v1/agents/test-agent
# Expected: Agent details
```

#### Tools API
```bash
# List tools
curl http://localhost:8080/api/v1/tools
# Expected: {"tools":[...],"total":N}

# Create a tool
curl -X POST http://localhost:8080/api/v1/tools \
  -H "Content-Type: application/json" \
  -d '{
    "name": "read_file",
    "description": "Read file contents",
    "server": "filesystem",
    "schema": {"type": "object", "properties": {"path": {"type": "string"}}}
  }'
# Expected: {"id":"tol_01...","name":"read_file",...}
```

#### Runs API
```bash
# Create a run (requires agent_version_id)
# First, get the agent version
curl http://localhost:8080/api/v1/agents/test-agent/versions
# Note the version ID

# Create run
curl -X POST http://localhost:8080/api/v1/runs \
  -H "Content-Type: application/json" \
  -d '{
    "agent_version_id": "agv_01XXXXXXXXXXXXXXXXXXXXXXXXX",
    "input": {"task": "Hello world"},
    "config": {}
  }'
# Expected: {"id":"run_01...","status":"pending",...}

# List runs
curl http://localhost:8080/api/v1/runs
# Expected: {"runs":[...],"total":1}

# Get run details
curl http://localhost:8080/api/v1/runs/run_01XXXXXXXXXXXXXXXXXXXXXXXXX
# Expected: Run details with steps
```

#### Policy Rules API
```bash
# Create a policy rule
curl -X POST http://localhost:8080/api/v1/policies/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Allow Read Files",
    "description": "Allow reading files in workspace",
    "priority": 100,
    "conditions": {"tool": "read_file"},
    "effect": "allow"
  }'
# Expected: {"id":"pol_01...","name":"Allow Read Files",...}

# List policy rules
curl http://localhost:8080/api/v1/policies/rules
# Expected: {"rules":[...],"total":N}
```

#### Approvals API
```bash
# List pending approvals
curl http://localhost:8080/api/v1/approvals
# Expected: {"approvals":[],"total":0}

# (Approvals are created when policy requires human approval)
```

### Test OpenAPI Documentation
```bash
# Get OpenAPI spec
curl http://localhost:8080/api-docs/openapi.json | jq '.info'
# Expected: {"title":"FerrumDeck Gateway API",...}

# Swagger UI (open in browser)
open http://localhost:8080/swagger-ui/
```

---

## 6. Testing the Worker (Python Data Plane)

### Start the Worker
```bash
# Terminal 2 (keep gateway running in Terminal 1):
make run-worker

# OR directly:
uv run python -m fd_worker

# Expected output:
# INFO:fd_worker:Starting FerrumDeck Worker
# INFO:fd_worker:Connected to Redis at localhost:6379
# INFO:fd_worker:Connected to Gateway at http://localhost:8080
# INFO:fd_worker:Waiting for jobs...
```

### Verify Worker Connection
```bash
# Check Redis queue
redis-cli -p 6379 XINFO GROUPS fd:steps:pending 2>/dev/null || echo "Queue not created yet (normal if no jobs)"

# The worker creates the consumer group on first job
```

### Test Worker Processing
```bash
# Create a run that will queue a step
# (This requires a properly configured agent with tools)

# Monitor worker logs for:
# INFO:fd_worker:Processing step stp_01...
# INFO:fd_worker:Step completed successfully
```

---

## 7. Testing the Dashboard (Next.js UI)

### Start Dashboard in Development Mode
```bash
# Terminal 3:
cd nextjs
npm run dev

# Expected output:
# ▲ Next.js 16.1.1
# - Local: http://localhost:3000
# - Ready in Xs
```

### Test Dashboard Pages

Open browser to `http://localhost:3000`

#### Runs Page (`/runs`)
- [ ] Page loads without errors
- [ ] Run list displays (may be empty initially)
- [ ] Filters work (status, date range)
- [ ] Click on a run shows detail view
- [ ] Timeline visualization works
- [ ] Step details are expandable

#### Agents Page (`/agents`)
- [ ] Agent list displays
- [ ] Agent cards show stats
- [ ] Click agent shows versions
- [ ] Can view agent configuration

#### Tools Page (`/tools`)
- [ ] Tool list displays
- [ ] Tool details show schema
- [ ] Server information visible

#### Approvals Page (`/approvals`)
- [ ] Approval queue displays
- [ ] Can approve/reject actions
- [ ] Details show action context

#### Analytics Page (`/analytics`)
- [ ] Charts render correctly
- [ ] Date range picker works
- [ ] Metrics update with filters

#### Settings Page (`/settings`)
- [ ] Configuration options display
- [ ] Can modify settings

### Test Dashboard API Proxy
```bash
# The dashboard proxies requests to gateway
curl http://localhost:3000/api/v1/health
# Expected: Proxied response from gateway
```

### Build Dashboard for Production
```bash
cd nextjs
npm run build

# Expected:
# ✓ Compiled successfully
# ✓ Linting and checking validity...
# ✓ Collecting page data...
# ✓ Generating static pages...
# ✓ Collecting build traces...

# Output in .next/ directory
```

---

## 8. End-to-End Flow Testing

### Complete Run Lifecycle

#### Step 1: Seed Test Data
```bash
make db-seed
# This creates test projects, agents, and tools
```

#### Step 2: Create a Test Run
```bash
# Get the test agent version ID
AGENT_VERSION=$(curl -s http://localhost:8080/api/v1/agents | jq -r '.agents[0].current_version_id')
echo "Agent Version: $AGENT_VERSION"

# Create a run
RUN_ID=$(curl -s -X POST http://localhost:8080/api/v1/runs \
  -H "Content-Type: application/json" \
  -d "{
    \"agent_version_id\": \"$AGENT_VERSION\",
    \"input\": {\"task\": \"Say hello\"},
    \"config\": {}
  }" | jq -r '.id')
echo "Run ID: $RUN_ID"
```

#### Step 3: Monitor Run Progress
```bash
# Poll run status
watch -n 2 "curl -s http://localhost:8080/api/v1/runs/$RUN_ID | jq '{status, step_count: .steps | length}'"

# Or check in dashboard at http://localhost:3000/runs/{run_id}
```

#### Step 4: Verify Steps Executed
```bash
# Get run with steps
curl -s http://localhost:8080/api/v1/runs/$RUN_ID | jq '.steps[] | {id, type, status}'

# Expected progression:
# status: pending -> running -> completed
```

### Testing Policy Enforcement

#### Test Denied Tool
```bash
# Try to call an unregistered tool (should be denied)
# Policy engine enforces deny-by-default
```

#### Test Approval Gate
```bash
# Create a policy requiring approval
curl -X POST http://localhost:8080/api/v1/policies/rules \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Require Approval for Writes",
    "priority": 50,
    "conditions": {"tool": "write_file"},
    "effect": "require_approval"
  }'

# Then trigger a write action - it should pause for approval
# Check approvals page in dashboard
```

---

## 9. Running Evaluations

### Prerequisites
```bash
# Ensure ANTHROPIC_API_KEY is set
echo $ANTHROPIC_API_KEY

# Gateway and worker must be running
curl http://localhost:8080/health
```

### Run Smoke Suite
```bash
# Quick validation (~2 minutes)
make eval-run

# OR with options:
uv run python -m fd_evals run \
  --suite smoke \
  --output evals/reports/smoke_$(date +%Y%m%d_%H%M%S).json

# Expected output:
# Running smoke suite...
# Task 1/N: task-001 - PASSED
# Task 2/N: task-002 - PASSED
# ...
# Suite completed: N/N passed (100%)
```

### Run Regression Suite
```bash
# Full regression (~10 minutes)
make eval-run-full

# OR:
uv run python -m fd_evals run \
  --suite regression \
  --runs 1 \
  --parallel 2
```

### Run with Mock Mode (No API Key Required)
```bash
# For CI/testing without API calls
uv run python -m fd_evals run \
  --suite smoke \
  --mock

# Uses mock LLM responses
```

### View Eval Report
```bash
# Generate HTML report
make eval-report

# View latest JSON report
cat evals/reports/$(ls -t evals/reports/*.json | head -1) | jq '.summary'

# Expected:
# {
#   "total_tasks": N,
#   "passed_tasks": N,
#   "pass_rate": 1.0,
#   "duration_seconds": X
# }
```

### Compare Eval Runs
```bash
# Compare two runs
uv run python -m fd_evals delta \
  evals/reports/baseline.json \
  evals/reports/current.json
```

---

## 10. Docker Testing

### Build All Docker Images
```bash
# Build gateway image
docker build -f deploy/docker/gateway.Dockerfile -t ferrumdeck-gateway:latest .
# Expected: Successfully built, ~50MB

# Build worker image
docker build -f deploy/docker/worker.Dockerfile -t ferrumdeck-worker:latest .
# Expected: Successfully built, ~173MB

# Build dashboard image
docker build -f nextjs/Dockerfile -t ferrumdeck-dashboard:latest nextjs/
# Expected: Successfully built, ~74MB

# Verify images
docker images | grep ferrumdeck
# Should show all three images
```

### Test Individual Containers

#### Gateway Container
```bash
# Run gateway container
docker run -d --name fd-gateway-test \
  --network host \
  -e DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck \
  -e REDIS_URL=redis://localhost:6379 \
  ferrumdeck-gateway:latest

# Test health
curl http://localhost:8080/health

# Check logs
docker logs fd-gateway-test

# Cleanup
docker stop fd-gateway-test && docker rm fd-gateway-test
```

#### Worker Container
```bash
# Run worker container
docker run -d --name fd-worker-test \
  --network host \
  -e FD_CONTROL_PLANE_URL=http://localhost:8080 \
  -e REDIS_URL=redis://localhost:6379 \
  -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
  ferrumdeck-worker:latest

# Check logs
docker logs fd-worker-test

# Cleanup
docker stop fd-worker-test && docker rm fd-worker-test
```

#### Dashboard Container
```bash
# Run dashboard container
docker run -d --name fd-dashboard-test \
  -p 3001:3000 \
  -e GATEWAY_URL=http://host.docker.internal:8080 \
  ferrumdeck-dashboard:latest

# Test
curl http://localhost:3001
# Or open http://localhost:3001 in browser

# Cleanup
docker stop fd-dashboard-test && docker rm fd-dashboard-test
```

### Full Docker Compose Deployment
```bash
# Start everything with Docker Compose
docker compose -f deploy/docker/docker-compose.yml up -d

# Check all services
docker compose -f deploy/docker/docker-compose.yml ps

# View logs
docker compose -f deploy/docker/docker-compose.yml logs -f

# Test
curl http://localhost:8080/health
open http://localhost:3000

# Stop
docker compose -f deploy/docker/docker-compose.yml down
```

---

## 11. Observability & Tracing

### Jaeger UI
```bash
# Open Jaeger
open http://localhost:16686

# In Jaeger UI:
# 1. Select service: "gateway" or "fd-worker"
# 2. Click "Find Traces"
# 3. View distributed traces across services
```

### Trace a Request
```bash
# Make a request and note the trace ID from logs
curl -v http://localhost:8080/api/v1/runs

# Look for header: x-trace-id or in logs
# Search for trace ID in Jaeger
```

### View Logs
```bash
# Gateway logs
RUST_LOG=debug ./target/release/gateway 2>&1 | tee gateway.log

# Worker logs
uv run python -m fd_worker 2>&1 | tee worker.log

# Docker logs
docker compose -f deploy/docker/docker-compose.yml logs -f gateway worker
```

---

## 12. Cleanup

### Stop All Services
```bash
# Stop local processes
# Ctrl+C in each terminal (gateway, worker, dashboard)

# Stop Docker Compose services
docker compose -f deploy/docker/docker-compose.yml down

# Stop development infrastructure
make dev-down
```

### Clean Build Artifacts
```bash
# Full clean
make clean

# This removes:
# - target/ (Rust builds)
# - __pycache__/ (Python cache)
# - .next/ (Next.js build)
# - node_modules/ (if needed)
```

### Reset Database
```bash
# Nuclear option - drops all data
make db-reset

# This will:
# 1. Drop ferrumdeck database
# 2. Create fresh database
# 3. Migrations run on next gateway start
```

### Clean Docker
```bash
# Remove test containers
docker rm -f fd-gateway-test fd-worker-test fd-dashboard-test 2>/dev/null

# Remove images
docker rmi ferrumdeck-gateway:latest ferrumdeck-worker:latest ferrumdeck-dashboard:latest

# Clean all Docker resources (careful!)
docker system prune -a
```

---

## 13. Troubleshooting

### Gateway Won't Start

**Error: "Address already in use"**
```bash
# Find process on port 8080
lsof -i :8080
# Kill it
kill -9 $(lsof -t -i :8080)
```

**Error: "Database connection refused"**
```bash
# Check PostgreSQL is running
docker ps | grep postgres
# If not running:
make dev-up
```

**Error: "Migration failed"**
```bash
# Reset database
make db-reset
# Restart gateway
```

### Worker Won't Connect

**Error: "Redis connection refused"**
```bash
# Check Redis is running
redis-cli ping
# If not:
make dev-up
```

**Error: "Gateway not reachable"**
```bash
# Verify gateway is running
curl http://localhost:8080/health
# Start gateway if needed
```

### Dashboard Build Fails

**Error: "Module not found"**
```bash
cd nextjs
rm -rf node_modules .next
npm install
npm run build
```

**Error: "Type errors"**
```bash
cd nextjs
npm run type-check
# Fix any TypeScript errors shown
```

### Evals Fail

**Error: "ANTHROPIC_API_KEY not set"**
```bash
export ANTHROPIC_API_KEY="your-key-here"
```

**Error: "Gateway not responding"**
```bash
# Ensure gateway and worker are running
curl http://localhost:8080/health
```

**Error: "Task timeout"**
```bash
# Increase timeout in suite config
# Or check if agent is waiting for approval
```

### Docker Issues

**Error: "Image not found"**
```bash
# Rebuild images
docker build -f deploy/docker/gateway.Dockerfile -t ferrumdeck-gateway:latest .
```

**Error: "Container can't connect to host"**
```bash
# Use host.docker.internal on Mac/Windows
# Use --network host on Linux
```

---

## Quick Reference

### Service URLs
| Service | URL |
|---------|-----|
| Gateway API | http://localhost:8080 |
| Dashboard | http://localhost:3000 |
| Swagger UI | http://localhost:8080/swagger-ui/ |
| Jaeger UI | http://localhost:16686 |

### Key Make Commands
```bash
make dev-up        # Start infrastructure
make dev-down      # Stop infrastructure
make run-gateway   # Start gateway
make run-worker    # Start worker
make test          # Run all tests
make eval-run      # Run smoke evals
make check         # Format + lint + test
make clean         # Clean build artifacts
```

### Environment Variables
```bash
DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...
RUST_LOG=info,gateway=debug
GATEWAY_PORT=8080
```

---

## Verification Checklist

Use this checklist to verify complete system functionality:

### Infrastructure
- [ ] PostgreSQL running and accessible
- [ ] Redis running and accessible
- [ ] Jaeger UI accessible

### Gateway
- [ ] Builds successfully
- [ ] Health endpoint returns healthy
- [ ] Ready endpoint shows all services OK
- [ ] Can create/list projects
- [ ] Can create/list agents
- [ ] Can create/list tools
- [ ] Can create/list runs
- [ ] Policy rules work
- [ ] OpenAPI docs accessible

### Worker
- [ ] Starts and connects to Redis
- [ ] Connects to gateway
- [ ] Processes steps from queue
- [ ] LLM calls work (with API key)
- [ ] Tool calls work

### Dashboard
- [ ] Builds without errors
- [ ] All pages load
- [ ] API proxy works
- [ ] Real-time updates work
- [ ] Filters and search work

### Docker
- [ ] All images build successfully
- [ ] Containers start correctly
- [ ] Services communicate properly
- [ ] Docker Compose works

### Evals
- [ ] Smoke suite passes
- [ ] Reports generate correctly
- [ ] Mock mode works

---

**Document Version**: 1.0
**Last Updated**: 2026-01-11
**Author**: Generated for FerrumDeck handover
