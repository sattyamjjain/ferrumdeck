#!/usr/bin/env bash
# =============================================================================
# Generate OpenAPI clients and types from the control-plane spec
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SPEC_FILE="$PROJECT_ROOT/contracts/openapi/control-plane.openapi.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if spec file exists
if [[ ! -f "$SPEC_FILE" ]]; then
    log_error "OpenAPI spec not found: $SPEC_FILE"
    exit 1
fi

# Validate OpenAPI spec
validate_spec() {
    log_info "Validating OpenAPI specification..."

    if command -v npx &> /dev/null; then
        npx --yes @redocly/cli lint "$SPEC_FILE" --skip-rule=no-unused-components
    elif command -v swagger-cli &> /dev/null; then
        swagger-cli validate "$SPEC_FILE"
    else
        log_warn "No OpenAPI validator found. Install @redocly/cli or swagger-cli for validation."
        log_warn "Skipping validation..."
        return 0
    fi

    log_info "OpenAPI spec is valid!"
}

# Generate TypeScript types (optional)
generate_typescript() {
    local output_dir="$PROJECT_ROOT/generated/typescript"

    log_info "Generating TypeScript types..."

    if ! command -v npx &> /dev/null; then
        log_warn "npx not found. Skipping TypeScript generation."
        return 0
    fi

    mkdir -p "$output_dir"

    npx --yes openapi-typescript "$SPEC_FILE" \
        --output "$output_dir/api.ts" \
        --alphabetize \
        --export-type

    log_info "TypeScript types generated: $output_dir/api.ts"
}

# Generate Python types using datamodel-code-generator (optional)
generate_python() {
    local output_dir="$PROJECT_ROOT/generated/python"

    log_info "Generating Python types..."

    if ! command -v datamodel-codegen &> /dev/null; then
        log_warn "datamodel-codegen not found. Install with: pip install datamodel-code-generator"
        log_warn "Skipping Python generation..."
        return 0
    fi

    mkdir -p "$output_dir"

    datamodel-codegen \
        --input "$SPEC_FILE" \
        --input-file-type openapi \
        --output "$output_dir/models.py" \
        --target-python-version 3.12 \
        --use-annotated \
        --use-double-quotes \
        --field-constraints

    log_info "Python types generated: $output_dir/models.py"
}

# Generate API documentation
generate_docs() {
    local output_dir="$PROJECT_ROOT/docs/api"

    log_info "Generating API documentation..."

    if ! command -v npx &> /dev/null; then
        log_warn "npx not found. Skipping docs generation."
        return 0
    fi

    mkdir -p "$output_dir"

    # Generate Redoc HTML
    npx --yes @redocly/cli build-docs "$SPEC_FILE" \
        --output "$output_dir/index.html" \
        --title "FerrumDeck API Documentation"

    log_info "API documentation generated: $output_dir/index.html"
}

# Main
main() {
    log_info "Starting OpenAPI code generation..."
    echo ""

    validate_spec
    echo ""

    case "${1:-all}" in
        validate)
            # Already done above
            ;;
        typescript|ts)
            generate_typescript
            ;;
        python|py)
            generate_python
            ;;
        docs)
            generate_docs
            ;;
        all)
            generate_typescript
            echo ""
            generate_python
            echo ""
            generate_docs
            ;;
        *)
            echo "Usage: $0 [validate|typescript|python|docs|all]"
            exit 1
            ;;
    esac

    echo ""
    log_info "OpenAPI generation complete!"
}

main "$@"
