import fs from 'node:fs';

// Embedded SQL fixture only; execute the existing migrations, not replacement documents.
export const recordItinerarySql = 'supabase/development/20260906_itinerary_record_read.sql';
export const recordItineraryWriteSql = 'supabase/development/20260906_itinerary_record_write.sql';
export const recordWriteArgs={
 sd_itinerary_record_claim_lease_v1:['p_workspace_key','p_vessel_id','p_holder_session','p_holder_label','p_ttl_seconds:integer','p_actor_user_id'],
 sd_itinerary_record_renew_lease_v1:['p_workspace_key','p_vessel_id','p_lease_id:uuid','p_holder_session','p_fencing_token:bigint','p_ttl_seconds:integer','p_actor_user_id'],
 sd_itinerary_record_release_lease_v1:['p_workspace_key','p_vessel_id','p_lease_id:uuid','p_holder_session','p_fencing_token:bigint','p_actor_user_id'],
 sd_itinerary_record_save_v1:['p_workspace_key','p_vessel_id','p_expected_revision:bigint','p_operation_id:uuid','p_rows:jsonb','p_lease_id:uuid','p_holder_session','p_fencing_token:bigint','p_actor_label','p_actor_user_id','p_alternative_plans:jsonb'],
 sd_itinerary_record_operation_status_v1:['p_workspace_key','p_operation_id:uuid','p_actor_user_id'],
};
export const itineraryWorkspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export async function installItineraryFixture(db) {
  await db.exec(`create schema auth;
    create role service_role noinherit bypassrls;
    create table auth.users(id uuid primary key,email text);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  await db.exec(fs.readFileSync('supabase/normalized-schema.sql','utf8'));
  await db.exec(`create table public.sd_login_options(
    workspace_id uuid references public.sd_workspaces(id), user_id uuid references auth.users(id),
    department text,username_label text,display_name text,auth_alias text,is_active boolean default true,
    must_change_password boolean default false,primary key(workspace_id,user_id));`);
  for (const migration of [
    '20260831090000_itinerary_subsystem.sql','20260831110000_itinerary_rollout_bootstrap.sql',
    '20260901073500_itinerary_utc_offsets.sql','20260901122500_itinerary_public_vessel_full_names.sql',
    '20260901125500_itinerary_operation_multi_select.sql','20260901143000_itinerary_calculation_v2.sql',
    '20260902100000_itinerary_notes.sql','20260902105700_itinerary_office_role_access.sql',
    '20260902134143_itinerary_main_session_access.sql','20260903143000_itinerary_previous_port_name.sql',
    '20260903190000_itinerary_alternative_plans.sql','20260904230000_itinerary_daily_reports.sql',
  ]) {
    const sql=fs.readFileSync(`supabase/migrations/${migration}`,'utf8');
    // PGlite has no scheduler: keep real report DDL/functions, omit only cron registration.
    const cron=sql.indexOf('create extension if not exists pg_cron');
    await db.exec(cron<0?sql:sql.slice(0,cron)+'commit;');
  }
}
export async function seedItineraryFixture(db, vite, workspaceKey, vessels) {
  const types=await vite.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const model=await vite.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');
  await db.query('insert into sd_workspaces(id,legacy_key,name) values($1,$2,$3)',[itineraryWorkspaceId,workspaceKey,'Synthetic formal workspace']);
  for (const vessel of vessels) await db.query('insert into sd_vessels(workspace_id,id,name,short_name,full_name,ship_type,fleet_category) values($1,$2,$3,$4,$3,$5,$6)',[itineraryWorkspaceId,vessel.id,`FORMAL ${vessel.id}`,vessel.id,'bulk','qa']);
  const document=types.createEmptyItineraryDocument({workspaceKey,vesselId:vessels[0].id,vesselName:`FORMAL ${vessels[0].id}`,rowId:'formal-row'});
  Object.assign(document,{revision:7,updatedAt:'2026-09-01T01:00:00Z',updatedActorKind:'owner',updatedActorLabel:'Formal author'});
  Object.assign(document.rows[0],{previousPortName:'QA FORMAL BUSAN',portDockName:'QA FORMAL KAOHSIUNG',cargoQuantityText:'QA FORMAL CARGO 123 MT',etaUtc:'2026-09-07T00:00:00Z',etaTimeZone:'UTC+8',portTimeZone:'UTC+8'});
  const withAlt=model.addShipAlternativePlan(document,'qa-alternative','qa-alternative-row');
  withAlt.alternativePlans[0].rows[0].portDockName='QA ALTERNATIVE MUST NOT PROJECT';
  await db.query(`insert into sd_itinerary_documents(workspace_id,vessel_id,revision,rows_payload,alternative_plans_payload,updated_at,updated_actor_kind,updated_actor_label) values($1,$2,7,$3::jsonb,$4::jsonb,$5,'office','Formal author')`,[itineraryWorkspaceId,vessels[0].id,JSON.stringify(withAlt.rows),JSON.stringify(withAlt.alternativePlans),document.updatedAt]);
  await db.query(`insert into sd_itinerary_history(workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,actor_kind,actor_label,operation_id) values($1,$2,7,1,$3::jsonb,$4::jsonb,'office','Formal author','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')`,[itineraryWorkspaceId,vessels[0].id,JSON.stringify(withAlt.rows),JSON.stringify(withAlt.alternativePlans)]);
  await db.query(`insert into sd_itinerary_leases(workspace_id,vessel_id,lease_id,actor_kind,actor_key,holder_session,holder_label,fencing_token,expires_at) values($1,$2,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','office','main:fixture','fixture-tab','Fixture',3,now()+interval '1 hour')`,[itineraryWorkspaceId,vessels[0].id]);
  await db.query(`select sd_generate_daily_itinerary_report($1,'2026-09-01'::date,'2026-09-01T02:00:00Z'::timestamptz)`,[itineraryWorkspaceId]);
  return withAlt;
}
export async function snapshotItineraryAuthority(db) {
  const tables=(await db.query(`select tablename from pg_tables where schemaname='public' and (tablename like 'sd_%' or tablename='ship_dynamics_app_state') order by tablename`)).rows;
  const snapshot={};
  for(const {tablename} of tables) snapshot[tablename]=(await db.query(`select to_jsonb(t) as value,xmin::text,ctid::text from public."${tablename}" t order by to_jsonb(t)::text`)).rows;
  return snapshot;
}
