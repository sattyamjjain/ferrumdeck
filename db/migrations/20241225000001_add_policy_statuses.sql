-- Add policy-related run statuses
-- This migration adds budget_killed and policy_blocked statuses to the run_status enum

-- Add new enum values
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'budget_killed';
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'policy_blocked';

-- Add same statuses to workflow_run_status for consistency
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'budget_killed';
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'policy_blocked';
