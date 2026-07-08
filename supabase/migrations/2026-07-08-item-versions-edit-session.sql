-- History coalescing v2: session-fenced, not time-windowed (KANBAN-10 follow-up).
--
-- The 15-minute body-burst window coalesced SEPARATE editing sessions into one
-- history entry when they happened close together — but the user's model is
-- that dismissing the editor (Esc / click-off / close) SEALS the entry: one
-- editing session that changed the item = one history record.
--
-- The editor now mints a random session id when it opens and every autosave
-- carries it; a body-only write coalesces into the latest entry ONLY when that
-- entry carries the same session id. No time window. Writers without a session
-- (MCP set_item_body / append_item_note, Telegram) never coalesce — each call
-- is its own record.

alter table mykan.item_versions add column if not exists edit_session text;
