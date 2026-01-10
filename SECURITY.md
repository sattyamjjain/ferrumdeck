# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.x.x   | :white_check_mark: |

## Reporting a Vulnerability

We take the security of FerrumDeck seriously. If you believe you have found a security vulnerability, please report it to us as described below.

### How to Report

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them via email to: **security@ferrumdeck.dev**

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

Please include the following information in your report:

- Type of vulnerability (e.g., injection, authentication bypass, privilege escalation)
- Full paths of source file(s) related to the vulnerability
- Location of the affected source code (tag/branch/commit or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### What to Expect

1. **Acknowledgment**: We will acknowledge receipt of your vulnerability report within 48 hours.

2. **Communication**: We will keep you informed of the progress towards a fix and full announcement.

3. **Credit**: We will credit you in the security advisory if you wish (please let us know your preference).

4. **Disclosure Timeline**: We aim to:
   - Confirm the vulnerability within 7 days
   - Release a fix within 30 days for critical issues
   - Release a fix within 90 days for non-critical issues

### Safe Harbor

We support safe harbor for security researchers who:

- Make a good faith effort to avoid privacy violations, destruction of data, and interruption or degradation of our services
- Only interact with accounts you own or with explicit permission of the account holder
- Do not exploit a security issue for purposes other than verification
- Report vulnerabilities promptly and provide sufficient detail

We will not pursue legal action against researchers who follow these guidelines.

## Security Model

FerrumDeck implements a defense-in-depth security model:

### Deny-by-Default Policy Engine

All tool executions require explicit allowlist configuration. No tool can execute without a matching policy rule.

### LLM Output Validation

All LLM outputs are validated before tool execution to prevent prompt injection and tool misuse (OWASP LLM02 mitigation).

### Budget Enforcement

Runs are automatically terminated when budget limits are exceeded, preventing runaway costs and resource abuse.

### Approval Gates

Sensitive operations can be configured to require human approval before execution.

### Audit Logging

All operations are logged with immutable audit trails for compliance and forensics. Sensitive data is automatically redacted.

### Sandboxed Execution

Tool execution occurs in isolated environments with limited permissions.

## Security Best Practices for Operators

1. **API Keys**: Never commit API keys or secrets to version control. Use environment variables or secret management systems.

2. **Network Isolation**: Deploy the gateway behind a reverse proxy with TLS termination.

3. **Database Security**: Use strong passwords and enable SSL for PostgreSQL connections.

4. **Regular Updates**: Keep all dependencies updated to patch known vulnerabilities.

5. **Policy Review**: Regularly audit your tool policies and remove unused permissions.

6. **Monitoring**: Enable OpenTelemetry tracing and monitor for anomalous behavior.

## Known Security Considerations

### Current Limitations

- Authentication is currently handled externally (BYO auth)
- Rate limiting should be configured at the reverse proxy level
- Secrets in environment variables should be managed via a secrets manager in production

### Roadmap

- [ ] Built-in authentication providers
- [ ] Secrets management integration (HashiCorp Vault, AWS Secrets Manager)
- [ ] Enhanced rate limiting
- [ ] Security scanning in CI/CD

## Dependencies

We regularly scan our dependencies for known vulnerabilities using:

- `cargo audit` for Rust dependencies
- `pip-audit` / `safety` for Python dependencies
- `npm audit` for Node.js dependencies

## Contact

For security concerns, contact: **security@ferrumdeck.dev**

For general inquiries, please use GitHub Issues or Discussions.
