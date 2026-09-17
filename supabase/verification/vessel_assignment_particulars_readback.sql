-- Read-only. Synthetic arguments exercise the installed immutable guard;
-- no vessel records, assignments, history or leases are written.
select test, pass from (values
  ('year-label-management', public.ship_dynamics_patch_lock_covers_entity('vessels','probe','{"id":"probe"}'::jsonb,'{"id":"probe","yearLabel":"2021.06"}'::jsonb,'[]'::jsonb,'[]'::jsonb)),
  ('tonnage-label-management', public.ship_dynamics_patch_lock_covers_entity('vessels','probe','{"id":"probe"}'::jsonb,'{"id":"probe","tonnageLabel":"2.0萬"}'::jsonb,'[]'::jsonb,'[]'::jsonb)),
  ('saved-clear-management', public.ship_dynamics_patch_lock_covers_entity('vessels','probe','{"id":"probe","yearLabel":"2021.06","tonnageLabel":"2.0萬"}'::jsonb,'{"id":"probe","yearLabel":"","tonnageLabel":""}'::jsonb,'[]'::jsonb,'[]'::jsonb)),
  ('operational-lock-preserved', not public.ship_dynamics_patch_lock_covers_entity('vessels','probe','{"id":"probe"}'::jsonb,'{"id":"probe","note":{"recentDynamics":"operational"}}'::jsonb,'[]'::jsonb,'[]'::jsonb)),
  ('unknown-field-lock-preserved', not public.ship_dynamics_patch_lock_covers_entity('vessels','probe','{"id":"probe"}'::jsonb,'{"id":"probe","unknownField":"value"}'::jsonb,'[]'::jsonb,'[]'::jsonb)),
  ('owned-operational-lock-preserved', public.ship_dynamics_patch_lock_covers_entity('vessels','probe','{"id":"probe"}'::jsonb,'{"id":"probe","note":{"recentDynamics":"operational"}}'::jsonb,'[]'::jsonb,'[{"section_key":"vessel:probe"}]'::jsonb))
) checks(test,pass);
