import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const workspace = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherWorkspace = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.sd_workspaces (
      id uuid primary key,
      legacy_key text not null,
      is_active boolean not null default true
    );
    create table public.sd_vessels (
      workspace_id uuid not null,
      id text not null,
      name text not null,
      position jsonb not null default '{}'::jsonb,
      is_active boolean not null default true,
      version bigint not null default 1,
      updated_at timestamptz not null default clock_timestamp(),
      primary key(workspace_id,id)
    );
    create table public.sd_itinerary_documents (
      workspace_id uuid not null,
      vessel_id text not null,
      revision bigint not null,
      schema_version integer not null default 1,
      rows_payload jsonb not null,
      alternative_plans_payload jsonb not null default '[]'::jsonb,
      updated_at timestamptz,
      updated_actor_kind text,
      updated_actor_id uuid,
      updated_actor_label text not null default '',
      primary key(workspace_id,vessel_id)
    );
    create table public.sd_itinerary_history (
      workspace_id uuid not null,
      vessel_id text not null,
      revision bigint not null,
      schema_version integer not null,
      rows_payload jsonb not null,
      alternative_plans_payload jsonb not null default '[]'::jsonb,
      actor_kind text not null,
      actor_id uuid,
      actor_label text not null default '',
      operation_id uuid not null,
      created_at timestamptz not null default clock_timestamp(),
      primary key(workspace_id,vessel_id,revision),
      unique(workspace_id,operation_id)
    );
    create table public.sd_itinerary_operations (
      workspace_id uuid not null,
      operation_id uuid not null,
      actor_kind text not null,
      actor_key text not null,
      target_key text not null,
      request_payload jsonb not null,
      request_hash text not null,
      result jsonb not null,
      committed_at timestamptz not null default clock_timestamp(),
      primary key(workspace_id,operation_id)
    );
    create table public.sd_itinerary_leases (
      workspace_id uuid not null,
      vessel_id text not null,
      expires_at timestamptz not null,
      primary key(workspace_id,vessel_id)
    );

    create or replace function public.sd_itinerary_rows_valid(p_rows jsonb)
    returns boolean language sql immutable as $$
      select jsonb_typeof(p_rows) = 'array'
        and jsonb_array_length(p_rows) between 1 and 100
        and jsonb_typeof(p_rows -> 0) = 'object'
        and coalesce(p_rows -> 0 ->> 'rowId','') <> ''
        and coalesce(p_rows -> 0 ->> 'sortOrder','') = '0'
        and coalesce(p_rows -> 0 ->> 'previousPortName','') ~ '[^[:space:]]'
        and coalesce((p_rows -> 0 ->> 'invalidForTest')::boolean,false) = false
    $$;

    create or replace function public.sd_itinerary_alternative_plans_valid(p_plans jsonb,p_rows jsonb)
    returns boolean language sql immutable as $$
      select jsonb_typeof(p_plans) = 'array'
        and public.sd_itinerary_rows_valid(p_rows)
        and coalesce((p_plans -> 0 ->> 'invalidForTest')::boolean,false) = false
    $$;
  `);
  return db;
}

function row({ rowId, previousPortName, invalidForTest = false }) {
  return JSON.stringify([{ rowId, sortOrder: 0, previousPortName, portDockName: 'NEXT', invalidForTest }]);
}

async function seed(db, { activeLease = false, secondWorkspaceDocument = false } = {}) {
  await db.exec(`
    insert into public.sd_workspaces(id,legacy_key,is_active) values
      ('${workspace}','workspace-a',true),
      ('${otherWorkspace}','workspace-b',true);

    insert into public.sd_vessels(workspace_id,id,name,position,is_active,version) values
      ('${workspace}','v-fill','Fill Vessel','{"lastPort":"BUSAN"}',true,8),
      ('${workspace}','v-trim','Trim Vessel','{"lastPort":"  NAGOYA  "}',true,3),
      ('${workspace}','v-existing','Existing Vessel','{"lastPort":"OSAKA"}',true,4),
      ('${workspace}','v-source-empty','Empty Source Vessel','{"lastPort":"   "}',true,5),
      ('${workspace}','v-source-whitespace','Whitespace Source Vessel',jsonb_build_object('lastPort',E'\t\n'),true,5),
      ('${workspace}','v-no-document','No Document Vessel','{"lastPort":"MANILA"}',true,2),
      ('${workspace}','v-empty-rows','Empty Rows Vessel','{"lastPort":"HONG KONG"}',true,2),
      ('${workspace}','v-invalid','Invalid Document Vessel','{"lastPort":"KAOHSIUNG"}',true,9),
      ('${workspace}','v-long','Long Source Vessel',jsonb_build_object('lastPort',repeat('X',241)),true,1),
      ('${workspace}','v-inactive','Inactive Vessel','{"lastPort":"SHANGHAI"}',false,6);

    insert into public.sd_itinerary_documents(
      workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,
      updated_at,updated_actor_kind,updated_actor_label
    ) values
      ('${workspace}','v-fill',3,1,'${row({ rowId: 'row-fill', previousPortName: '' })}'::jsonb,'[{"planId":"alt-1","rows":[]}]'::jsonb,clock_timestamp(),'public','船端使用者'),
      ('${workspace}','v-trim',7,1,'${row({ rowId: 'row-trim', previousPortName: '   ' })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-existing',2,1,'${row({ rowId: 'row-existing', previousPortName: 'SHANGHAI' })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-source-empty',5,1,'${row({ rowId: 'row-source-empty', previousPortName: '' })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-source-whitespace',5,1,'${row({ rowId: 'row-source-whitespace', previousPortName: '' })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-empty-rows',1,1,'[]'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-invalid',4,1,'${row({ rowId: 'row-invalid', previousPortName: '', invalidForTest: true })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-long',1,1,'${row({ rowId: 'row-long', previousPortName: '' })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester'),
      ('${workspace}','v-inactive',6,1,'${row({ rowId: 'row-inactive', previousPortName: '' })}'::jsonb,'[]'::jsonb,clock_timestamp(),'office','Tester');

    insert into public.sd_itinerary_history(
      workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,
      actor_kind,actor_label,operation_id
    )
    select workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,
      coalesce(updated_actor_kind,'office'),updated_actor_label,gen_random_uuid()
    from public.sd_itinerary_documents;
  `);
  if (activeLease) {
    await db.exec(`insert into public.sd_itinerary_leases(workspace_id,vessel_id,expires_at) values ('${workspace}','v-trim',clock_timestamp()+interval '5 minutes')`);
  }
  if (secondWorkspaceDocument) {
    await db.exec(`
      insert into public.sd_vessels(workspace_id,id,name,position,is_active,version)
      values ('${otherWorkspace}','other-vessel','Other Vessel','{"lastPort":"PORT B"}',true,1);
      insert into public.sd_itinerary_documents(
        workspace_id,vessel_id,revision,schema_version,rows_payload,alternative_plans_payload,
        updated_at,updated_actor_kind,updated_actor_label
      ) values (
        '${otherWorkspace}','other-vessel',1,1,
        '${row({ rowId: 'other-row', previousPortName: '' })}'::jsonb,'[]'::jsonb,
        clock_timestamp(),'office','Tester'
      );
    `);
  }
}

async function fetchOne(db, sql) {
  const result = await db.query(sql);
  return result.rows[0];
}

const previewSql = await readFile('supabase/itinerary-previous-port-backfill-preview.sql', 'utf8');
const backfillSql = await readFile('supabase/itinerary-previous-port-backfill.sql', 'utf8');
const readbackSql = await readFile('supabase/itinerary-previous-port-backfill-readback.sql', 'utf8');

assert.match(
  backfillSql,
  /perform\s+1\s+from public\.sd_itinerary_leases l\s+where l\.workspace_id = v_workspace\s+and l\.vessel_id = v_vessel\.id\s+for update;\s+if exists\s*\(/is,
  'the backfill must lock the lease row before testing its expiry',
);

{
  const db = await createDatabase();
  try {
    await seed(db);
    const preview = (await fetchOne(db, previewSql)).previous_port_backfill_preview;
    assert.equal(preview.mode, 'READ_ONLY_PREVIEW');
    assert.equal(preview.targetWorkspaceCount, 1);
    assert.equal(preview.safeToRun, true);
    assert.equal(preview.totals.readyToFill, 2);
    assert.equal(preview.totals.alreadySet, 1);
    assert.equal(preview.totals.sourceEmpty, 2);
    assert.equal(preview.totals.noFormalDocument, 1);
    assert.equal(preview.totals.noFormalRows, 1);
    assert.equal(preview.totals.invalidDocument, 1);
    assert.equal(preview.totals.sourceTooLong, 1);
    assert.equal(preview.totals.inactiveVessels, 1);

    const initialAlternativePlans = (await fetchOne(db, `select alternative_plans_payload value from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id='v-fill'`)).value;
    await db.exec(backfillSql);

    const filled = await fetchOne(db, `select revision,rows_payload,alternative_plans_payload,updated_actor_kind,updated_actor_id,updated_actor_label from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id='v-fill'`);
    assert.equal(filled.revision, 4);
    assert.equal(filled.rows_payload[0].previousPortName, 'BUSAN');
    assert.deepEqual(filled.alternative_plans_payload, initialAlternativePlans, 'alternative plans must remain byte-semantically unchanged');
    assert.equal(filled.updated_actor_kind, 'office');
    assert.equal(filled.updated_actor_id, null);
    assert.equal(filled.updated_actor_label, '系統回填：船卡上一港');

    const trimmed = await fetchOne(db, `select revision,rows_payload from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id='v-trim'`);
    assert.equal(trimmed.revision, 8);
    assert.equal(trimmed.rows_payload[0].previousPortName, 'NAGOYA');

    const untouched = await db.query(`select vessel_id,revision,rows_payload from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id not in ('v-fill','v-trim') order by vessel_id`);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-existing').rows_payload[0].previousPortName, 'SHANGHAI');
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-existing').revision, 2);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-source-empty').revision, 5);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-source-whitespace').revision, 5);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-empty-rows').revision, 1);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-invalid').revision, 4);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-long').revision, 1);
    assert.equal(untouched.rows.find(value => value.vessel_id === 'v-inactive').revision, 6);

    const history = await db.query(`select vessel_id,revision,actor_label,operation_id from public.sd_itinerary_history where actor_label='系統回填：船卡上一港' order by vessel_id`);
    assert.deepEqual(history.rows.map(value => [value.vessel_id, value.revision]), [['v-fill', 4], ['v-trim', 8]]);
    assert.equal(new Set(history.rows.map(value => value.operation_id)).size, 2);

    const operations = await db.query(`select actor_kind,actor_key,target_key,request_payload,result from public.sd_itinerary_operations order by target_key`);
    assert.equal(operations.rows.length, 2);
    assert.ok(operations.rows.every(value => value.actor_kind === 'office'));
    assert.ok(operations.rows.every(value => value.actor_key === 'system:previous-port-backfill-v1'));
    assert.ok(operations.rows.every(value => value.result.backfill === true && value.result.ok === true));
    assert.deepEqual(operations.rows.map(value => value.target_key), ['vessel:v-fill', 'vessel:v-trim']);

    const readback = (await fetchOne(db, readbackSql)).previous_port_backfill_readback;
    assert.equal(readback.mode, 'READ_ONLY_READBACK');
    assert.equal(readback.verified, true);
    assert.equal(readback.totals.remainingFillable, 0);
    assert.equal(readback.totals.matched, 2);
    assert.equal(readback.totals.preservedDifferentValue, 1);
    assert.equal(readback.totals.backfillHistoryRows, 2);
    assert.equal(readback.totals.backfillOperationRows, 2);
    assert.equal(readback.totals.historyWithoutOperation, 0);
    assert.equal(readback.totals.operationWithoutHistory, 0);

    await db.exec(backfillSql);
    const afterSecondRun = await fetchOne(db, `
      select
        (select count(*)::integer from public.sd_itinerary_history where actor_label='系統回填：船卡上一港') history_count,
        (select count(*)::integer from public.sd_itinerary_operations where actor_key='system:previous-port-backfill-v1') operation_count,
        (select revision from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id='v-fill') fill_revision
    `);
    assert.deepEqual(afterSecondRun, { history_count: 2, operation_count: 2, fill_revision: 4 }, 'rerun must be idempotent');
  } finally {
    await db.close();
  }
}

{
  const db = await createDatabase();
  try {
    await seed(db);
    await db.exec(backfillSql);
    const receipt = await fetchOne(db, `
      select operation_id
      from public.sd_itinerary_operations
      where actor_key = 'system:previous-port-backfill-v1'
      order by target_key
      limit 1
    `);
    await db.query(`
      update public.sd_itinerary_operations
      set operation_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
      where workspace_id = $1::uuid and operation_id = $2::uuid
    `, [workspace, receipt.operation_id]);
    const mismatched = (await fetchOne(db, readbackSql)).previous_port_backfill_readback;
    assert.equal(mismatched.verified, false, 'equal receipt counts with different operation IDs must not verify');
    assert.equal(mismatched.totals.historyWithoutOperation, 1);
    assert.equal(mismatched.totals.operationWithoutHistory, 1);
  } finally {
    await db.close();
  }
}

{
  const db = await createDatabase();
  try {
    await seed(db, { activeLease: true });
    await assert.rejects(db.exec(backfillSql), /active-itinerary-lease/);
    const unchanged = await fetchOne(db, `select revision,rows_payload from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id='v-fill'`);
    assert.equal(unchanged.revision, 3);
    assert.equal(unchanged.rows_payload[0].previousPortName, '');
    const laterLockedVessel = await fetchOne(db, `select revision,rows_payload from public.sd_itinerary_documents where workspace_id='${workspace}' and vessel_id='v-trim'`);
    assert.equal(laterLockedVessel.revision, 7);
    assert.equal(laterLockedVessel.rows_payload[0].previousPortName, '   ');
    assert.equal((await fetchOne(db, `select count(*)::integer count from public.sd_itinerary_operations`)).count, 0);
  } finally {
    await db.close();
  }
}

{
  const db = await createDatabase();
  try {
    await seed(db, { secondWorkspaceDocument: true });
    const preview = (await fetchOne(db, previewSql)).previous_port_backfill_preview;
    assert.equal(preview.targetWorkspaceCount, 2);
    assert.equal(preview.safeToRun, false);
    await assert.rejects(db.exec(backfillSql), /expected-exactly-one-active-itinerary-workspace/);
    assert.equal((await fetchOne(db, `select count(*)::integer count from public.sd_itinerary_operations`)).count, 0);
  } finally {
    await db.close();
  }
}

console.log('itinerary_previous_port_backfill=PASS');
