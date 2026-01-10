# Contributing to FerrumDeck

Thank you for your interest in contributing to FerrumDeck! This document provides guidelines and instructions for contributing.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Getting Started

### Prerequisites

- **Rust**: 1.80+ (install via [rustup](https://rustup.rs/))
- **Python**: 3.12+ with [uv](https://github.com/astral-sh/uv) package manager
- **Node.js**: 20+ with npm
- **Docker**: For running PostgreSQL, Redis, and other services

### Quick Start

```bash
# Clone the repository
git clone https://github.com/ferrumdeck/ferrumdeck.git
cd ferrumdeck

# Install all dependencies
make install

# Start development services (Postgres, Redis, Jaeger)
make dev-up

# Run the gateway (in one terminal)
make run-gateway

# Run the worker (in another terminal)
make run-worker

# Run the dashboard (in another terminal)
make run-dashboard
```

## Development Setup

### Environment Variables

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

Required variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `ANTHROPIC_API_KEY`: For LLM calls (optional for most development)

### IDE Setup

**VS Code** (recommended):
- Install the Rust Analyzer extension
- Install the Python extension with Pylance
- Install the ESLint extension

**JetBrains IDEs**:
- Use RustRover for Rust development
- Use PyCharm for Python development

## Making Changes

### Branching Strategy

1. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes with clear, atomic commits

3. Keep your branch up to date:
   ```bash
   git fetch origin
   git rebase origin/main
   ```

### Commit Messages

Follow conventional commit format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(policy): add rate limiting support
fix(worker): handle LLM timeout gracefully
docs(readme): update installation instructions
```

## Pull Request Process

1. **Before submitting**:
   ```bash
   make check  # Runs fmt, lint, and test
   ```

2. **Create a PR** with:
   - Clear title following commit message format
   - Description of changes
   - Link to related issues
   - Screenshots for UI changes

3. **Review process**:
   - At least one maintainer approval required
   - All CI checks must pass
   - Address review feedback promptly

4. **After merge**:
   - Delete your feature branch
   - Update related issues

## Coding Standards

### Rust

- Follow the [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- Use `cargo fmt` for formatting
- Use `cargo clippy` for linting
- Document public APIs with doc comments

```rust
/// Creates a new policy with the given configuration.
///
/// # Arguments
///
/// * `config` - The policy configuration
///
/// # Returns
///
/// Returns the created policy or an error if creation fails.
pub fn create_policy(config: PolicyConfig) -> Result<Policy, PolicyError> {
    // implementation
}
```

### Python

- Follow PEP 8 with 100 character line limit
- Use `ruff format` for formatting
- Use `ruff check` and `pyright` for linting
- Add type hints to all functions

```python
def validate_output(
    output: str,
    schema: dict[str, Any],
    *,
    strict: bool = False,
) -> ValidationResult:
    """Validate LLM output against a schema.

    Args:
        output: The LLM output to validate.
        schema: The JSON schema to validate against.
        strict: If True, fail on unknown fields.

    Returns:
        ValidationResult with success status and any errors.
    """
    # implementation
```

### TypeScript/React

- Use ESLint with Next.js configuration
- Use Prettier for formatting (via ESLint)
- Prefer functional components with hooks
- Use TypeScript strict mode

```typescript
interface PolicyCardProps {
  policy: Policy;
  onEdit: (policy: Policy) => void;
  isAdmin: boolean;
}

export function PolicyCard({ policy, onEdit, isAdmin }: PolicyCardProps) {
  // implementation
}
```

## Testing

### Running Tests

```bash
# All tests
make test

# Rust tests only
make test-rust

# Python tests only
make test-python

# Integration tests (requires dev-up)
make test-integration
```

### Writing Tests

**Rust**:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_policy_evaluation() {
        let policy = Policy::new("test");
        assert!(policy.allows("read"));
    }

    #[tokio::test]
    async fn test_async_operation() {
        let result = async_operation().await;
        assert!(result.is_ok());
    }
}
```

**Python**:
```python
import pytest
from fd_worker.validation import OutputValidator

@pytest.mark.asyncio
async def test_validate_output():
    validator = OutputValidator()
    result = await validator.validate("test output")
    assert result.is_valid
```

**TypeScript**:
```typescript
import { render, screen } from '@testing-library/react';
import { PolicyCard } from './policy-card';

describe('PolicyCard', () => {
  it('renders policy name', () => {
    render(<PolicyCard policy={mockPolicy} onEdit={jest.fn()} isAdmin={true} />);
    expect(screen.getByText(mockPolicy.name)).toBeInTheDocument();
  });
});
```

## Documentation

### Where to Document

- **Code comments**: For complex logic
- **Doc comments**: For public APIs
- **README files**: For module-level documentation
- **docs/**: For architecture, ADRs, and guides
- **CLAUDE.md**: For AI assistant context (auto-managed sections)

### ADR (Architecture Decision Records)

For significant architectural decisions, create an ADR in `docs/adr/`:

```markdown
# ADR-NNN: Title

## Status
Proposed | Accepted | Deprecated | Superseded

## Context
What is the issue that we're seeing that is motivating this decision?

## Decision
What is the change that we're proposing?

## Consequences
What becomes easier or more difficult to do because of this change?
```

## Questions?

- Open a [GitHub Discussion](https://github.com/ferrumdeck/ferrumdeck/discussions)
- Check existing [Issues](https://github.com/ferrumdeck/ferrumdeck/issues)
- Read the [Documentation](docs/)

Thank you for contributing!
