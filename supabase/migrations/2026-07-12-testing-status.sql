-- Add a "Testing" status: an optional verification gate between In Progress and
-- Done (KANBAN-18). Flow becomes New → In Progress → Blocked → Testing → Done.
--
-- The enum lives in the `mykan` schema (moved there 2026-06-28). ADD VALUE is
-- idempotent via IF NOT EXISTS and cannot run inside a transaction block, so
-- apply it standalone. The new value is not used in this same statement, so it
-- is safe to apply on the live database. Enum sort-order is cosmetic — the app
-- orders columns by the ITEM_STATUSES array, not the enum ordinal.
alter type mykan.item_status add value if not exists 'testing' before 'done';
