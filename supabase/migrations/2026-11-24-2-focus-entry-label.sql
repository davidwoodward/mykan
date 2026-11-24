-- A focus entry's own title (KANBAN-82).
--
-- focus_entries.label is the title the person sees on their focus list. It is
-- seeded from the card's title when a card is pushed to the list and can be
-- rewritten there without touching the card; the entry keeps its item_id, so
-- the link to the card stays. Null falls back to the card's current title.
--
-- Safe for the deployed code: one nullable column it doesn't select by name.
-- RLS: no new table; focus_entries already has RLS enabled with no policies.

alter table mykan.focus_entries
  add column if not exists label text;

alter table mykan.focus_entries
  drop constraint if exists focus_entries_label_len;
alter table mykan.focus_entries
  add constraint focus_entries_label_len check (label is null or length(label) between 1 and 200);
