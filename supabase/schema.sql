-- mykan schema
-- Paste into the Supabase SQL editor (Database → SQL Editor → New query → Run).
-- Idempotent: safe to re-run.

create extension if not exists "uuid-ossp";

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
  create type item_status as enum ('new', 'in_progress', 'done');
exception when duplicate_object then null;
end $$;

create table if not exists items (
  id uuid primary key default uuid_generate_v4(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
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

-- Rich-text body for items (Tiptap/ProseMirror document JSON). Inline images are
-- stored in the private "item-images" Storage bucket and referenced by URL, so the
-- JSON here stays small. Created out-of-band:
--   storage bucket "item-images" (private) — see lib/supabase-server.ts ITEM_IMAGES_BUCKET
alter table items add column if not exists body jsonb;

-- Auth is enforced at the app layer (Auth.js + email whitelist).
-- Server-only API routes use the service-role key, bypassing RLS.
-- RLS stays disabled on these tables; do NOT enable it without also adding
-- policies, or the server-role bypass will be the only access path anyway.
