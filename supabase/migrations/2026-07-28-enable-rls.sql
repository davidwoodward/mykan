-- Enable Row-Level Security on every table in the `mykan` schema.
--
-- Supabase's Security Advisor flagged all 7 mykan tables as
-- `rls_disabled_in_public` (CRITICAL, emailed 2026-07-26). The lint name is
-- misleading: "public" means "in a schema exposed to PostgREST", not the
-- `public` schema (which this project does not use). The project's exposed
-- schema list is `public,graphql_public,time,cockpit,mykan,fin,helm`, so every
-- mykan table is served over the REST API, and with RLS off there is no row
-- filter — an anon-key caller could read/write all of it. `github_credentials`
-- (encrypted GitHub PATs) and `mcp_tokens` (hashed MCP bearer tokens) are the
-- rows that matter most.
--
-- NO POLICIES ARE CREATED, deliberately. mykan talks to Supabase exclusively
-- with the service role key from the server (lib/supabase-server.ts), and
-- service_role bypasses RLS entirely. RLS-on + zero-policies is therefore a
-- deny-all for the anon/authenticated roles and a no-op for the app. This is
-- the same posture the sibling `cockpit`, `fin`, and `helm` schemas already
-- use (the advisor reports those as `rls_enabled_no_policy`, which is the
-- intended end state here too, not a problem to solve).
--
-- If mykan ever adds a browser-side Supabase client using the anon key, each
-- table will need real policies at that point — enabling RLS now is what makes
-- that a deliberate, additive step rather than a silent hole.

alter table mykan.projects           enable row level security;
alter table mykan.items              enable row level security;
alter table mykan.categories         enable row level security;
alter table mykan.item_versions      enable row level security;
alter table mykan.github_accounts    enable row level security;
alter table mykan.github_credentials enable row level security;
alter table mykan.mcp_tokens         enable row level security;
