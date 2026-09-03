import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const workspace='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const db=new PGlite();

try{
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.sd_vessels (
      workspace_id uuid not null, id text not null, name text not null default '',
      short_name text not null default '', full_name text not null default '', ship_type text not null default '',
      fleet_category text not null default '', fleet_tags text[] not null default '{}', kind text not null default '',
      position jsonb not null default '{}'::jsonb, cargo jsonb not null default '{}'::jsonb, note jsonb not null default '{}'::jsonb,
      weekly_attention text[] not null default '{}', manual_attention_level text,
      is_active boolean not null default true, created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(), primary key(workspace_id,id)
    );
    create table public.sd_vessel_assignments(workspace_id uuid,vessel_id text,user_id uuid,assignment_kind text,is_active boolean);
    create table public.sd_tasks(
      workspace_id uuid,id text,vessel_scope_mode text,priority text,attention_dimension text,is_aware boolean,is_abnormal boolean,
      equipment_subcategory text,description text,status text,expected_date date,report_date date,source_meeting_id text,
      source_meeting_item_id text,distribute_to_vessels boolean,source_type text,created_by uuid,updated_by uuid,
      created_at timestamptz,updated_at timestamptz,is_deleted boolean,is_internal_control boolean,is_closed boolean
    );
    create table public.sd_task_vessels(workspace_id uuid,task_id text,vessel_id text,is_active_scope boolean,status text,is_closed boolean,closed_date text,closed_by text,updated_at timestamptz,updated_by text);
    create table public.sd_task_type_scopes(workspace_id uuid,task_id text,type_scope text,ordinal integer);
    create table public.sd_task_categories(workspace_id uuid,task_id text,category text,ordinal integer);
    create table public.sd_task_departments(workspace_id uuid,task_id text,department text,ordinal integer);
    create table public.sd_task_owners(workspace_id uuid,task_id text,owner_id uuid,ordinal integer);
    create table public.sd_meetings(
      workspace_id uuid,id text,subject text,status text,meeting_date date,scope_mode text,reason text,resolution text,
      expected_date date,completed_date text,completed_by text,priority text,is_abnormal boolean,include_in_morning boolean,
      is_internal_control boolean,latest_status text,created_by uuid,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz
    );
    create table public.sd_meeting_type_scopes(workspace_id uuid,meeting_id text,ship_type text);
    create table public.sd_meeting_vessels(workspace_id uuid,meeting_id text,vessel_id text);
    create table public.sd_meeting_departments(workspace_id uuid,meeting_id text,department text);
    create table public.sd_meeting_participants(workspace_id uuid,meeting_id text,user_id uuid,participant_kind text);
    create table public.sd_meeting_items(workspace_id uuid,meeting_id text,id text,description text,distribute_to_vessels boolean,is_active boolean,ordinal integer);
    create table public.sd_meeting_item_categories(workspace_id uuid,meeting_item_id text,category text);
    create table public.sd_itinerary_documents(
      workspace_id uuid not null, vessel_id text not null, revision bigint not null,
      rows_payload jsonb not null, updated_at timestamptz, primary key(workspace_id,vessel_id)
    );
  `);

  await db.exec(await readFile('supabase/migrations/20260903230000_itinerary_daily_morning_projection.sql','utf8'));
  await db.exec(`
    insert into public.sd_vessels(workspace_id,id,name,kind,position,cargo,note,is_active,updated_at) values
      ('${workspace}','v1','Vessel One','bulk','{"lastPort":"LEGACY LAST","nextPort":"LEGACY NEXT"}','{"name":"LEGACY CARGO"}','{}',true,'2026-09-01T00:00:00Z'),
      ('${workspace}','v2','Vessel Two','tanker','{"lastPort":"LEGACY V2"}','{}','{}',true,'2026-09-01T00:00:00Z'),
      ('${workspace}','v3','Inactive Vessel','bulk','{}','{}','{}',false,'2026-09-01T00:00:00Z'),
      ('${workspace}','v4','Empty Rows Vessel','bulk','{"lastPort":"LEGACY V4"}','{}','{}',true,'2026-09-01T00:00:00Z');

    insert into public.sd_itinerary_documents(workspace_id,vessel_id,revision,rows_payload,updated_at) values
      ('${workspace}','v1',9,'[
        {"rowId":"later","sortOrder":2,"previousPortName":"WRONG","portDockName":"WRONG","etaUtc":"2026-09-02T00:00:00Z","portTimeZone":"UTC+0","cargoQuantityText":"ALTERNATIVE SHOULD NOT WIN"},
        {"rowId":"formal-first","sortOrder":0,"previousPortName":"BUSAN","portDockName":"KAOHSIUNG / PIER 8","etaUtc":"2026-09-01T00:00:00Z","portTimeZone":"UTC+8","etbUtc":"2026-09-01T01:00:00Z","etbTimeZone":"UTC+9","etdUtc":"2026-09-01T10:00:00Z","etdTimeZone":"UTC-6","cargoQuantityText":"Coal 10,000 MT\\nGrain 5,000 MT"}
      ]','2026-09-03T12:30:00Z'),
      ('${workspace}','v4',2,'[]','2026-09-03T12:30:00Z');
  `);

  const result=await db.query(`select public.sd_build_daily_morning_snapshot('${workspace}'::uuid,'2026-09-03T12:35:00Z'::timestamptz) as snapshot`);
  const snapshot=result.rows[0].snapshot;
  assert.equal(snapshot.schemaVersion,2);
  assert.equal(new Date(snapshot.projectionCapturedAt).toISOString(),'2026-09-03T12:35:00.000Z');
  assert.equal(snapshot.vessels.length,3,'inactive vessels must remain excluded');
  assert.equal(snapshot.itineraryProjections.v1.source,'itinerary');
  assert.equal(snapshot.itineraryProjections.v1.revision,9);
  assert.equal(snapshot.itineraryProjections.v1.rowId,'formal-first');
  assert.equal(snapshot.itineraryProjections.v1.values.previousPortName,'BUSAN');
  assert.equal(snapshot.itineraryProjections.v1.values.portDockName,'KAOHSIUNG / PIER 8');
  assert.equal(snapshot.itineraryProjections.v1.values.etaTimeZone,'UTC+8','field time zone must fall back to portTimeZone');
  assert.equal(snapshot.itineraryProjections.v1.values.etbTimeZone,'UTC+9');
  assert.equal(snapshot.itineraryProjections.v1.values.etdTimeZone,'UTC-6');
  assert.equal(snapshot.itineraryProjections.v1.values.cargoQuantityText,'Coal 10,000 MT\nGrain 5,000 MT');
  assert.equal(snapshot.itineraryProjections.v2.source,'legacy','confirmed no-document vessels must select whole-group legacy fallback');
  assert.equal(snapshot.itineraryProjections.v4.source,'legacy','malformed/empty formal rows must not produce a partial projection');
  assert.equal(snapshot.itineraryProjections.v3,undefined);
  assert.doesNotMatch(JSON.stringify(snapshot),/ALTERNATIVE SHOULD NOT WIN/);
  console.log('itinerary_operational_projection_db=PASS');
}finally{
  await db.close();
}
