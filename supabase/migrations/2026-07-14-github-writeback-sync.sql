-- GitHub write-back sync flag (KANBAN-24, GH-5). Done→close / un-done→reopen is a
-- best-effort side-effect of a status change: it must NEVER block or roll back the
-- mykan status. When the linked issue could not be updated (the acting user has no
-- PAT for the account, or GitHub rejected/was unreachable), we record a retry-able
-- flag on the item instead. Full design: docs/github-integration.md §Write-back.
--
--   null       — in sync (nothing owed, or the last write-back succeeded)
--   'no_pat'   — skipped: the acting user has no usable PAT for the account
--   'failed'   — attempted but GitHub rejected it / was unreachable (retry-able)
--
-- Applied live via the Supabase Management API (the service-role key cannot run DDL).
alter table mykan.items add column if not exists github_sync text
  check (github_sync in ('no_pat', 'failed'));

-- GitHub provenance shown on a linked item (KANBAN-24): when the source issue was
-- opened on GitHub, and when it was pulled into mykan. Captured at import; the
-- issue-opened date is re-captured on a manual refresh. A linked item only ever
-- re-syncs from GitHub via that manual refresh — nothing polls.
alter table mykan.items add column if not exists github_issue_created_at timestamptz;
alter table mykan.items add column if not exists github_imported_at timestamptz;
