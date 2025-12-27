#!/bin/bash
# FerrumDeck Development Starter
# ===============================
# This script starts all services needed for local development.

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Banner
echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                                                               ║"
echo "║   ███████╗███████╗██████╗ ██████╗ ██╗   ██╗███╗   ███╗       ║"
echo "║   ██╔════╝██╔════╝██╔══██╗██╔══██╗██║   ██║████╗ ████║       ║"
echo "║   █████╗  █████╗  ██████╔╝██████╔╝██║   ██║██╔████╔██║       ║"
echo "║   ██╔══╝  ██╔══╝  ██╔══██╗██╔══██╗██║   ██║██║╚██╔╝██║       ║"
echo "║   ██║     ███████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║       ║"
echo "║   ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝       ║"
echo "║                     D E C K                                   ║"
echo "║                                                               ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo -e "${YELLOW}Checking prerequisites...${NC}"

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker is not installed${NC}"
    echo "  Install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi
echo -e "${GREEN}✓ Docker is installed${NC}"

# Check Docker is running
if ! docker info &> /dev/null; then
    echo -e "${RED}✗ Docker is not running${NC}"
    echo "  Please start Docker Desktop or the Docker daemon"
    exit 1
fi
echo -e "${GREEN}✓ Docker is running${NC}"

# Check .env file
if [ ! -f .env ]; then
    echo -e "${RED}✗ .env file not found${NC}"
    echo "  Copy .env.example to .env and configure your API keys"
    exit 1
fi
echo -e "${GREEN}✓ .env file exists${NC}"

# Check required env vars
source .env
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo -e "${YELLOW}⚠ ANTHROPIC_API_KEY not set in .env${NC}"
    echo "  Agent LLM calls will fail without this"
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}⚠ GITHUB_TOKEN not set in .env${NC}"
    echo "  GitHub MCP tools will not work without this"
fi

echo ""
echo -e "${YELLOW}Pulling GitHub MCP Server image...${NC}"
docker pull ghcr.io/github/github-mcp-server 2>/dev/null || echo -e "${YELLOW}Note: Pull failed, will retry on first use${NC}"

echo ""
echo -e "${YELLOW}Starting infrastructure services...${NC}"
make dev-up

echo ""
echo -e "${YELLOW}Waiting for services to be ready...${NC}"
sleep 5

# Check gateway health
echo -n "Checking gateway... "
for i in {1..30}; do
    if curl -s http://localhost:8080/health > /dev/null 2>&1; then
        echo -e "${GREEN}ready${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}timeout${NC}"
        echo "Gateway may still be starting. Check 'make dev-logs'"
    fi
    sleep 1
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  FerrumDeck is ready!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BLUE}Dashboard${NC}:  Run 'make run-dashboard' then open http://localhost:8000"
echo -e "  ${BLUE}Gateway${NC}:    http://localhost:8080"
echo -e "  ${BLUE}Jaeger UI${NC}:  http://localhost:16686"
echo ""
echo -e "  ${YELLOW}Quick Test:${NC}"
echo "  curl -X POST http://localhost:8080/v1/runs \\"
echo "    -H 'Authorization: Bearer fd_dev_key_abc123' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"agent_id\": \"agt_01JFVX0000000000000000001\", \"input\": {\"task\": \"Hello world\"}}'"
echo ""
echo -e "  ${YELLOW}Start Dashboard:${NC}"
echo "  make run-dashboard"
echo ""
echo -e "  ${YELLOW}View Logs:${NC}"
echo "  make dev-logs"
echo ""
echo -e "  ${YELLOW}Stop Everything:${NC}"
echo "  make dev-down"
echo ""
