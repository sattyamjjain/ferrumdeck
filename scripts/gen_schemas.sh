#!/usr/bin/env bash
# =============================================================================
# Validate and generate code from JSON schemas
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SCHEMAS_DIR="$PROJECT_ROOT/contracts/jsonschema"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if schemas directory exists
if [[ ! -d "$SCHEMAS_DIR" ]]; then
    log_error "Schemas directory not found: $SCHEMAS_DIR"
    exit 1
fi

# Validate all JSON schemas
validate_schemas() {
    log_info "Validating JSON schemas..."

    local errors=0
    local validated=0

    for schema in "$SCHEMAS_DIR"/*.json; do
        if [[ ! -f "$schema" ]]; then
            continue
        fi

        local name
        name=$(basename "$schema")

        # Basic JSON syntax validation
        if ! python3 -c "import json; json.load(open('$schema'))" 2>/dev/null; then
            log_error "Invalid JSON syntax: $name"
            ((errors++))
            continue
        fi

        # Validate schema structure using jsonschema
        if command -v python3 &> /dev/null; then
            if python3 -c "
import json
import sys
try:
    from jsonschema import Draft7Validator
    with open('$schema') as f:
        schema = json.load(f)
    Draft7Validator.check_schema(schema)
except ImportError:
    # jsonschema not installed, skip validation
    pass
except Exception as e:
    print(f'Schema error: {e}', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null; then
                log_info "  ✓ $name"
                ((validated++))
            else
                log_error "  ✗ $name - Invalid schema structure"
                ((errors++))
            fi
        else
            log_info "  ? $name (skipped - python3 not available)"
        fi
    done

    echo ""
    log_info "Validated $validated schemas, $errors errors"

    if [[ $errors -gt 0 ]]; then
        return 1
    fi
}

# Generate TypeScript types from JSON schemas
generate_typescript() {
    local output_dir="$PROJECT_ROOT/generated/typescript/schemas"

    log_info "Generating TypeScript types from JSON schemas..."

    if ! command -v npx &> /dev/null; then
        log_warn "npx not found. Skipping TypeScript generation."
        return 0
    fi

    mkdir -p "$output_dir"

    for schema in "$SCHEMAS_DIR"/*.json; do
        if [[ ! -f "$schema" ]]; then
            continue
        fi

        local name
        name=$(basename "$schema" .json)
        local output_file="$output_dir/${name}.ts"

        npx --yes json-schema-to-typescript "$schema" \
            --output "$output_file" \
            --bannerComment "" \
            --style.singleQuote \
            2>/dev/null || {
            log_warn "Failed to generate TypeScript for $name"
            continue
        }

        log_info "  Generated: ${name}.ts"
    done

    log_info "TypeScript types generated in: $output_dir"
}

# Generate Python types from JSON schemas
generate_python() {
    local output_dir="$PROJECT_ROOT/generated/python/schemas"

    log_info "Generating Python types from JSON schemas..."

    if ! command -v datamodel-codegen &> /dev/null; then
        log_warn "datamodel-codegen not found. Install with: pip install datamodel-code-generator"
        log_warn "Skipping Python generation..."
        return 0
    fi

    mkdir -p "$output_dir"
    touch "$output_dir/__init__.py"

    for schema in "$SCHEMAS_DIR"/*.json; do
        if [[ ! -f "$schema" ]]; then
            continue
        fi

        local name
        name=$(basename "$schema" .json | tr '-' '_')
        local output_file="$output_dir/${name}.py"

        datamodel-codegen \
            --input "$schema" \
            --input-file-type jsonschema \
            --output "$output_file" \
            --target-python-version 3.12 \
            --use-annotated \
            --use-double-quotes \
            2>/dev/null || {
            log_warn "Failed to generate Python for $name"
            continue
        }

        log_info "  Generated: ${name}.py"
    done

    log_info "Python types generated in: $output_dir"
}

# Generate Rust types from JSON schemas (using typify)
generate_rust() {
    local output_dir="$PROJECT_ROOT/generated/rust/schemas"

    log_info "Generating Rust types from JSON schemas..."

    if ! command -v cargo &> /dev/null; then
        log_warn "cargo not found. Skipping Rust generation."
        return 0
    fi

    # Check if typify-cli is installed
    if ! cargo install --list | grep -q "typify-cli"; then
        log_warn "typify-cli not found. Install with: cargo install typify-cli"
        log_warn "Skipping Rust generation..."
        return 0
    fi

    mkdir -p "$output_dir"

    for schema in "$SCHEMAS_DIR"/*.json; do
        if [[ ! -f "$schema" ]]; then
            continue
        fi

        local name
        name=$(basename "$schema" .json | tr '-' '_')
        local output_file="$output_dir/${name}.rs"

        typify "$schema" > "$output_file" 2>/dev/null || {
            log_warn "Failed to generate Rust for $name"
            continue
        }

        log_info "  Generated: ${name}.rs"
    done

    # Generate mod.rs
    cat > "$output_dir/mod.rs" << 'MODEOF'
//! Generated schema types
//! DO NOT EDIT - Generated by scripts/gen_schemas.sh

MODEOF

    for schema in "$SCHEMAS_DIR"/*.json; do
        if [[ ! -f "$schema" ]]; then
            continue
        fi
        local name
        name=$(basename "$schema" .json | tr '-' '_')
        echo "pub mod ${name};" >> "$output_dir/mod.rs"
    done

    log_info "Rust types generated in: $output_dir"
}

# List all schemas
list_schemas() {
    log_info "Available JSON schemas:"
    echo ""

    for schema in "$SCHEMAS_DIR"/*.json; do
        if [[ ! -f "$schema" ]]; then
            continue
        fi

        local name
        name=$(basename "$schema")
        local title
        title=$(python3 -c "import json; print(json.load(open('$schema')).get('title', 'No title'))" 2>/dev/null || echo "Unknown")
        local desc
        desc=$(python3 -c "import json; print(json.load(open('$schema')).get('description', '')[:60])" 2>/dev/null || echo "")

        echo -e "  ${GREEN}$name${NC}"
        echo "    Title: $title"
        if [[ -n "$desc" ]]; then
            echo "    Description: $desc..."
        fi
        echo ""
    done
}

# Main
main() {
    log_info "JSON Schema Tools"
    echo ""

    case "${1:-validate}" in
        validate)
            validate_schemas
            ;;
        typescript|ts)
            validate_schemas && generate_typescript
            ;;
        python|py)
            validate_schemas && generate_python
            ;;
        rust|rs)
            validate_schemas && generate_rust
            ;;
        list|ls)
            list_schemas
            ;;
        all)
            validate_schemas
            echo ""
            generate_typescript
            echo ""
            generate_python
            echo ""
            generate_rust
            ;;
        *)
            echo "Usage: $0 [validate|typescript|python|rust|list|all]"
            echo ""
            echo "Commands:"
            echo "  validate    Validate all JSON schemas (default)"
            echo "  typescript  Generate TypeScript types"
            echo "  python      Generate Python types"
            echo "  rust        Generate Rust types"
            echo "  list        List all available schemas"
            echo "  all         Generate all types"
            exit 1
            ;;
    esac
}

main "$@"
