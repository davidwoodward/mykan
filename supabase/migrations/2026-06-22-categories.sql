-- Phase 3: per-project hierarchical categories (Areas).
--
-- A category is a node in a per-project tree (parent_id self-reference, depth
-- capped app-side at 5). Items reference a single node by id, so renaming a
-- node ripples everywhere and filtering by a node can include its whole subtree.

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

-- An item is filed at one category node (any level). on delete set null so
-- deleting a node un-files its items rather than deleting them.
alter table items add column if not exists category_id uuid
  references categories(id) on delete set null;
create index if not exists items_category_idx on items (category_id);
