-- Add a "Task" item type: one-off operational work that isn't a Feature or Bug
-- (e.g. a pre-production data import). Ordered between 'bug' and 'idea' to match
-- the UI segmented control (Feature | Bug | Task | Thought).
--
-- The enum lives in the `mykan` schema (moved there 2026-06-28). ADD VALUE is
-- idempotent via IF NOT EXISTS; it only adds the label and never uses it in the
-- same statement, so it is safe to apply on the live database.
alter type mykan.item_type add value if not exists 'task' before 'idea';
