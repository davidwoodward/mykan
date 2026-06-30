-- mykan schema
-- Paste into the Supabase SQL editor (Database → SQL Editor → New query → Run).
-- Idempotent: safe to re-run.
--
-- mykan's objects live in a dedicated `mykan` schema (the shared Supabase project
-- hosts several apps, each isolated to its own exposed schema). The Data API
-- (PostgREST) must have `mykan` in its exposed schemas, and the app client sets
-- db: { schema: 'mykan' } — see lib/supabase-server.ts. To migrate an existing
-- public-schema deployment into `mykan`, use
--   supabase/migrations/2026-06-28-move-to-mykan-schema.sql

create extension if not exists "uuid-ossp";

create schema if not exists mykan;
set search_path to mykan, public;

create table if not exists projects (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create type item_type as enum ('feature', 'bug', 'idea');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type item_status as enum ('new', 'in_progress', 'blocked', 'done');
exception when duplicate_object then null;
end $$;
-- 'blocked' was added after the type already existed on deployed DBs:
alter type item_status add value if not exists 'blocked' before 'done';

create table if not exists items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  -- An item's content lives entirely in the rich-text `body` (added below). There
  -- is no separate name/title column; any plain-text label is derived from `body`
  -- via richDocText on read. (The legacy `name` column was dropped 2026-06-30,
  -- see supabase/migrations/2026-06-30-drop-item-name.sql.)
  type item_type not null default 'feature',
  status item_status not null default 'new',
  position double precision not null default 1024,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_project_status_position_idx
  on items (project_id, status, position);

-- Authorship: track which whitelisted user created / last updated each row.
-- Stamped from the Auth.js session email by the server-only API routes.
alter table projects add column if not exists created_by text;
alter table projects add column if not exists updated_by text;
alter table items    add column if not exists created_by text;
alter table items    add column if not exists updated_by text;

-- Project privacy: a private project is visible only to its creator (the owner).
-- Default public preserves the shared-pool behaviour. Enforced app-side by the
-- API routes (see lib/api-auth.ts loadProjectForAccess / denyItemAccess).
alter table projects add column if not exists is_private boolean not null default false;
create index if not exists projects_is_private_idx on projects (is_private);

-- Rich-text body for items (Tiptap/ProseMirror document JSON). Inline images are
-- stored in the private "item-images" Storage bucket and referenced by URL, so the
-- JSON here stays small. Created out-of-band:
--   storage bucket "item-images" (private) — see lib/supabase-server.ts ITEM_IMAGES_BUCKET
alter table items add column if not exists body jsonb;

-- Free-form tags per item (normalised lowercase, deduped by the API). The set of
-- available tags is derived as the union across a project's items — there is no
-- separate tags table. GIN index supports tag-membership filters.
alter table items add column if not exists tags text[] not null default '{}';
create index if not exists items_tags_idx on items using gin (tags);

-- Assignees: member emails (the whitelist). Shown in the UI only on shared
-- (non-private) projects. GIN index supports "assigned to X" filters.
alter table items add column if not exists assignees text[] not null default '{}';
create index if not exists items_assignees_idx on items using gin (assignees);

-- Soft delete: the Delete action sets archived_at; archived items are hidden from
-- the normal list/board and shown only in the Archived view, where they can be
-- restored (archived_at = null) or permanently removed (row DELETE).
alter table items add column if not exists archived_at timestamptz;
create index if not exists items_archived_idx on items (project_id, archived_at);

-- File attachments per item: a JSON array of {id, name, content_type, size, path}.
-- Bytes live in the private "item-attachments" Storage bucket keyed by `path`;
-- this array is the metadata (count, list, rename target). Mutated server-side
-- by the /api/items/[id]/attachments routes.
alter table items add column if not exists attachments jsonb not null default '[]';

-- Stable per-project item reference (KEY-number, e.g. AMOS-12). The project
-- "key" is the short prefix; the item "number" is immutable, per-project, and
-- stamped on insert by the items_set_number trigger (every creation path gets
-- one). Full migration incl. backfill:
--   supabase/migrations/2026-06-22-item-reference.sql
alter table projects add column if not exists key text;
alter table items    add column if not exists number integer;
create unique index if not exists items_project_number_idx on items (project_id, number);

create or replace function set_item_number() returns trigger as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtext('item_number:' || new.project_id::text));
    select coalesce(max(number), 0) + 1 into new.number
    from items where project_id = new.project_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists items_set_number on items;
create trigger items_set_number
  before insert on items
  for each row execute function set_item_number();

-- Per-project hierarchical categories (Areas). A node references its parent
-- (depth capped app-side at 5); an item is filed at one node. Renaming ripples
-- via the id reference; filtering can include a node's whole subtree.
-- Migration: supabase/migrations/2026-06-22-categories.sql
create table if not exists categories (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references categories(id) on delete cascade,
  name text not null,
  position double precision not null default 1024,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);
create index if not exists categories_project_idx on categories (project_id);
create index if not exists categories_parent_idx on categories (parent_id);

alter table items add column if not exists category_id uuid
  references categories(id) on delete set null;
create index if not exists items_category_idx on items (category_id);

-- Auth is enforced at the app layer (Auth.js + email whitelist).
-- Server-only API routes use the service-role key, bypassing RLS.
-- RLS stays disabled on these tables; do NOT enable it without also adding
-- policies, or the server-role bypass will be the only access path anyway.
