-- Development seed data
-- Only run in development environment

-- =============================================================================
-- Default Tenant & Workspace
-- =============================================================================

INSERT INTO tenants (id, name, slug, settings) VALUES
    ('ten_01JFVX0000000000000000001', 'FerrumDeck Dev', 'ferrumdeck-dev', '{"plan": "enterprise"}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, tenant_id, name, slug, settings) VALUES
    ('wks_01JFVX0000000000000000001', 'ten_01JFVX0000000000000000001', 'Default Workspace', 'default', '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO projects (id, workspace_id, name, slug, description, settings) VALUES
    ('prj_01JFVX0000000000000000001', 'wks_01JFVX0000000000000000001', 'Demo Project', 'demo', 'Demo project for testing', '{}')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Development API Key
-- Hash of 'fd_dev_key_abc123' (SHA256)
-- In production, use proper key generation
-- =============================================================================

INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes) VALUES
    ('key_01JFVX0000000000000000001', 'ten_01JFVX0000000000000000001', 'Development Key',
     'c7e3e3094687a7ad5a9384b9d843988d22f271b31c013e568568095870fae07c', -- SHA256 of fd_dev_key_abc123
     'fd_dev_k', ARRAY['read', 'write', 'admin'])
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Safe PR Agent Definition
-- =============================================================================

INSERT INTO agents (id, project_id, name, slug, description, status) VALUES
    ('agt_01JFVX0000000000000000001', 'prj_01JFVX0000000000000000001', 'Safe PR Agent', 'safe-pr-agent',
     'Autonomous agent for safely creating pull requests with full governance', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_versions (id, agent_id, version, system_prompt, model, model_params, allowed_tools, tool_configs, max_tokens, max_tool_calls, max_wall_time_secs, max_cost_cents) VALUES
    ('agv_01JFVX0000000000000000001', 'agt_01JFVX0000000000000000001', '1.0.0',
     'You are a Safe PR Agent. Your job is to:
1. Read the repository to understand the codebase
2. Analyze code and propose changes based on the given task
3. Run tests to verify changes work correctly
4. Create a pull request with a clear description

IMPORTANT SAFETY RULES:
- Never commit secrets, credentials, or sensitive data
- Always run tests before creating a PR
- Keep changes minimal and focused on the task
- Explain your reasoning clearly in the PR description

You have access to the following tools:
- git_read: Read files and git history
- git_write: Make changes to files
- test_run: Run the test suite
- github_create_pr: Create a pull request (requires approval)',
     'claude-sonnet-4-20250514',
     '{"temperature": 0.1, "max_tokens": 4096}',
     ARRAY['git_read', 'git_write', 'test_run', 'github_create_pr'],
     '{"github_create_pr": {"requires_approval": true}}',
     100000, 50, 600, 500)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Tool Definitions
-- =============================================================================

INSERT INTO tools (id, project_id, name, slug, description, mcp_server, status, risk_level) VALUES
    ('tol_01JFVX0000000000000000001', 'prj_01JFVX0000000000000000001', 'Git Read', 'git_read',
     'Read files and git history from a repository', 'filesystem', 'active', 'read'),
    ('tol_01JFVX0000000000000000002', 'prj_01JFVX0000000000000000001', 'Git Write', 'git_write',
     'Make changes to files in a repository', 'filesystem', 'active', 'write'),
    ('tol_01JFVX0000000000000000003', 'prj_01JFVX0000000000000000001', 'Test Run', 'test_run',
     'Run the test suite for a project', 'sandbox', 'active', 'read'),
    ('tol_01JFVX0000000000000000004', 'prj_01JFVX0000000000000000001', 'GitHub Create PR', 'github_create_pr',
     'Create a pull request on GitHub', 'github', 'active', 'write')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tool_versions (id, tool_id, version, input_schema, output_schema) VALUES
    ('tlv_01JFVX0000000000000000001', 'tol_01JFVX0000000000000000001', '1.0.0',
     '{"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}',
     '{"type": "object", "properties": {"content": {"type": "string"}}}'),
    ('tlv_01JFVX0000000000000000002', 'tol_01JFVX0000000000000000002', '1.0.0',
     '{"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}',
     '{"type": "object", "properties": {"success": {"type": "boolean"}}}'),
    ('tlv_01JFVX0000000000000000003', 'tol_01JFVX0000000000000000003', '1.0.0',
     '{"type": "object", "properties": {"command": {"type": "string"}}}',
     '{"type": "object", "properties": {"passed": {"type": "boolean"}, "output": {"type": "string"}}}'),
    ('tlv_01JFVX0000000000000000004', 'tol_01JFVX0000000000000000004', '1.0.0',
     '{"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}, "branch": {"type": "string"}}, "required": ["title", "body", "branch"]}',
     '{"type": "object", "properties": {"pr_url": {"type": "string"}, "pr_number": {"type": "integer"}}}')
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Default Policy Rules
-- =============================================================================

INSERT INTO policy_rules (id, project_id, name, description, priority, conditions, effect, enabled) VALUES
    -- Global: Deny all tools by default (highest priority)
    ('pol_01JFVX0000000000000000001', NULL, 'Default Deny', 'Deny all tool calls by default', 1,
     '{"tool_name": {"not_in": []}}', 'deny', true),

    -- Project: Allow read tools
    ('pol_01JFVX0000000000000000002', 'prj_01JFVX0000000000000000001', 'Allow Read Tools', 'Allow read-only tools', 50,
     '{"tool_name": {"in": ["git_read", "test_run"]}}', 'allow', true),

    -- Project: Allow write tools
    ('pol_01JFVX0000000000000000003', 'prj_01JFVX0000000000000000001', 'Allow Write Tools', 'Allow write tools', 50,
     '{"tool_name": {"in": ["git_write"]}}', 'allow', true),

    -- Project: Require approval for destructive tools
    ('pol_01JFVX0000000000000000004', 'prj_01JFVX0000000000000000001', 'Require Approval for PR', 'Require approval for creating PRs', 60,
     '{"tool_name": {"in": ["github_create_pr"]}}', 'require_approval', true)
ON CONFLICT (id) DO NOTHING;
