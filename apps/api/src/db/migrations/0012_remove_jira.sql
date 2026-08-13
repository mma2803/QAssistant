-- 0012_remove_jira: remove the Jira feature from the data model.
--
-- Sessions no longer carry Jira work-context; a session's work context is now
-- always a required non-null `description`. The jira_configs table (and its RLS
-- policies/grants) is dropped entirely.

-- Backfill any legacy Jira-only sessions (description was NULL, work context was
-- the jira_id) so the column can become NOT NULL.
UPDATE sessions SET description = '(no description)' WHERE description IS NULL;

-- The work-context CHECK allowed jira_id OR description; description is now the
-- sole, required work context.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_work_context_check;

ALTER TABLE sessions ALTER COLUMN description SET NOT NULL;

ALTER TABLE sessions
  DROP COLUMN IF EXISTS jira_id,
  DROP COLUMN IF EXISTS jira_summary,
  DROP COLUMN IF EXISTS jira_status;

-- Dropping the table also drops its RLS policies and any table-level grants.
DROP TABLE IF EXISTS jira_configs;
