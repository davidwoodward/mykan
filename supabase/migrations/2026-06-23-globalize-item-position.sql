-- One-time re-seed: make items.position a GLOBAL per-project order (Design A).
--
-- Until now `position` only ordered items within a status column. To support a
-- flat, draggable "everything in one order" list (shared with the board), we
-- re-rank each project's items into a single global sequence. We seed by the
-- current (status, position) so every board column keeps its exact order — the
-- board looks identical — but the numbers are now globally comparable.
--
-- RUN ONCE. Re-running would reset any cross-status ordering back to
-- status-clustered, so this is NOT part of schema.sql.

with ranked as (
  select
    id,
    row_number() over (
      partition by project_id
      order by
        case status
          when 'new' then 0
          when 'in_progress' then 1
          when 'blocked' then 2
          when 'done' then 3
          else 4
        end,
        position,
        created_at
    ) as rn
  from items
)
update items i
set position = r.rn * 1024
from ranked r
where i.id = r.id;
