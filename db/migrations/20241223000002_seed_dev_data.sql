-- Development seed data
-- SECURITY: This migration should ONLY run in development/test environments
-- Production deployments should set: SET app.skip_dev_seed = 'true' before running migrations

-- =============================================================================
-- Environment Safety Check - Blocks execution in production
-- =============================================================================

DO $$
DECLARE
    skip_seed TEXT;
    environment TEXT;
BEGIN
    -- Check for skip flag
    skip_seed := current_setting('app.skip_dev_seed', true);
    environment := current_setting('app.environment', true);

    IF skip_seed = 'true' THEN
        RAISE NOTICE 'Skipping development seed data (app.skip_dev_seed=true)';
        -- Use a custom exception to skip the rest of the migration
        RAISE EXCEPTION 'SKIP_SEED' USING ERRCODE = 'FDSKP';
    END IF;

    IF environment = 'production' THEN
        RAISE WARNING 'Development seed migration blocked in production environment!';
        RAISE EXCEPTION 'SKIP_SEED' USING ERRCODE = 'FDSKP';
    END IF;

    RAISE NOTICE 'Running development seed data (environment: %)', COALESCE(environment, 'development');
END $$;

-- =============================================================================
-- Default Tenant & Workspace (Development Only)
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
-- SECURITY WARNING: This is a development-only key with a known hash
-- Hash of 'fd_dev_key_abc123' (SHA256 - legacy format)
-- Production deployments MUST generate unique keys with HMAC hashing
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
     'You are a Safe PR Agent specialized in creating pull requests for GitHub repositories.

## CRITICAL: Input Parsing Rules
1. ALWAYS extract the EXACT owner/repo from the repo_url provided in the task
   - Example: "https://github.com/langfuse/langfuse-python" → owner="langfuse", repo="langfuse-python"
   - NEVER assume or use a different repo than what is explicitly in the URL
   - Parse the URL carefully - the repo name after the org is your target
2. If an issue_url is provided, extract the issue number and call get_issue to fetch details
3. If issue_description is provided instead, use that as your task description

## Workflow (Execute in Order)
1. **Parse Inputs**: First, explicitly state the owner and repo you extracted from repo_url
2. **Fetch Issue**: If issue_url given, call get_issue with the correct owner/repo/issue_number
3. **Understand Codebase**: Use get_file_contents to read README.md and relevant source files from the CORRECT repo
4. **Fork Repository**: Call fork_repository with the correct owner/repo
5. **Create Branch**: Call create_branch with descriptive name like "fix-issue-{number}-{short-desc}"
6. **Make Changes**: Use create_or_update_file to implement the fix in YOUR FORK
7. **Create PR**: Call create_pull_request with:
   - owner/repo: The ORIGINAL repo (not your fork)
   - title: Clear title referencing the issue
   - body: Explanation of changes, link to issue
   - head: YOUR_GITHUB_USERNAME:branch-name
   - base: main (or the default branch)

## Error Handling
- If fork fails with "already exists", you already have a fork - proceed with it
- If branch exists, append a number suffix and try again
- Always verify you are working on the CORRECT repository before making changes

## SAFETY RULES
- Never commit secrets, credentials, or sensitive data
- Keep changes minimal and focused on the task
- Explain your reasoning clearly in the PR description

## Output Format
At the end, report:
- PR URL created (or error if failed)
- Summary of changes made
- Files modified',
     'claude-opus-4-5-20251101',
     '{"temperature": 0.1, "max_tokens": 16384}',
     ARRAY['git_read', 'git_write', 'test_run', 'github_create_pr'],
     '{"github_create_pr": {"requires_approval": true}}',
     100000, 75, 900, 1000)
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
