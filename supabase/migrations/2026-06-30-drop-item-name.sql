-- Drop the redundant items.name column.
--
-- `name` was the original plain-text item title. When the rich-text `body`
-- (jsonb) column was added, `name` was demoted to an auto-synced flattened
-- copy of `body` — duplicated content that no index, sort, or search ever
-- relied on. The app now derives any plain-text label from `body` on read
-- (richDocText), so the column is dead weight.
--
-- We rename rather than drop, keeping the existing values as a one-time backup
-- in `bubbba_was_here` in case anything downstream turns out to have depended
-- on it. New rows leave it null; it is never read or written by the app.
--
-- ORDERING (zero-downtime against the live, shared production DB):
--   1. Run the DROP NOT NULL *before* deploying the refactored code, so the
--      new code's inserts (which omit `name`) are valid while the column still
--      exists during the Vercel rolling deploy.
--   2. Deploy the code that no longer reads or writes `name`.
--   3. Run the RENAME *after* the deploy is fully live, once no running code
--      references `name`.

-- Step 1 — before deploy:
alter table mykan.items alter column name drop not null;

-- Step 3 — after deploy:
alter table mykan.items rename column name to bubbba_was_here;

-- Teardown — once the deploy was verified live and the backup was confirmed
-- unnecessary, the backup column was dropped (2026-06-30):
alter table mykan.items drop column if exists bubbba_was_here;
