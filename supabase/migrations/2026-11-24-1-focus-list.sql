-- The focus list (KANBAN-74 / KANBAN-75 / KANBAN-81).
--
-- One private, ranked list per person of the cards that matter right now,
-- across every project. Opt-in: focus_settings.enabled defaults to false and a
-- person with no settings row has the feature off.
--
--   projects.is_personal   the hidden personal project mykan creates for a
--                          person the first time they turn the list on. At most
--                          one per person (partial unique index), which also
--                          makes "turn it on" idempotent under a double click.
--   focus_settings         one row per person: on/off, thresholds, the daily
--                          review hour and time zone, the personal project,
--                          last_reviewed_at. Review reasons are computed on
--                          read (lib/focus-rules.ts), never stored.
--   focus_entries          the list. One ACTIVE entry per person per card
--                          (partial unique index); completed and removed rows
--                          stay as history. The hard cap (max_entries) is the
--                          app's rule, not storage's.
--
-- Auto-complete: focus_entries_complete_on_done completes every active entry
-- for a card the moment it moves INTO done, from any path (web, MCP, Telegram,
-- GitHub sync), the same way items_set_epic_position covers every path.
-- Leaving done never restores an entry.
--
-- Privacy: RLS on with no policies, the posture of every mykan table (the app
-- reaches Supabase only with the service role). Owner-only is enforced in
-- lib/focus-core.ts, where every query filters by the acting user's email.
--
-- Safe for the deployed code: one nullable-with-default column on projects
-- (select * gains a field it ignores), two new tables, one trigger that only
-- writes focus_entries.

alter table mykan.projects
  add column if not exists is_personal boolean not null default false;

create unique index if not exists projects_one_personal_per_owner
  on mykan.projects (created_by)
  where is_personal;

create table if not exists mykan.focus_settings (
  user_email          text primary key,
  enabled             boolean not null default false,
  min_entries         integer not null default 2,
  max_entries         integer not null default 7,
  stale_days          integer not null default 7,
  review_hour         integer not null default 8,
  time_zone           text not null default 'UTC',
  personal_project_id uuid references mykan.projects (id) on delete set null,
  last_reviewed_at    timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint focus_settings_min_range   check (min_entries between 0 and 49),
  constraint focus_settings_max_range   check (max_entries between 1 and 50),
  constraint focus_settings_min_lt_max  check (min_entries < max_entries),
  constraint focus_settings_stale_range check (stale_days between 1 and 365),
  constraint focus_settings_hour_range  check (review_hour between 0 and 23),
  constraint focus_settings_tz_present  check (length(time_zone) between 1 and 64)
);

alter table mykan.focus_settings enable row level security;

create table if not exists mykan.focus_entries (
  id           uuid primary key default gen_random_uuid(),
  user_email   text not null,
  item_id      uuid not null references mykan.items (id) on delete cascade,
  position     double precision not null,
  why_now      text,
  target_date  date,
  added_at     timestamptz not null default now(),
  completed_at timestamptz,
  removed_at   timestamptz,
  constraint focus_entries_why_now_len check (why_now is null or length(why_now) <= 200),
  constraint focus_entries_one_end     check (completed_at is null or removed_at is null)
);

create unique index if not exists focus_entries_one_active_per_card
  on mykan.focus_entries (user_email, item_id)
  where completed_at is null and removed_at is null;

create index if not exists focus_entries_user_idx
  on mykan.focus_entries (user_email, position);

create index if not exists focus_entries_item_idx
  on mykan.focus_entries (item_id);

alter table mykan.focus_entries enable row level security;

create or replace function mykan.focus_entries_complete_on_done() returns trigger
language plpgsql
set search_path = mykan, pg_temp
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    update mykan.focus_entries
       set completed_at = now()
     where item_id = new.id
       and completed_at is null
       and removed_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists focus_entries_complete_on_done on mykan.items;
create trigger focus_entries_complete_on_done
  after update of status on mykan.items
  for each row execute function mykan.focus_entries_complete_on_done();
