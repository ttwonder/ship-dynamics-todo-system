import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {installMorningOracle,schedulerSql} from './record-daily-morning-local-fixture.mjs';

export const shipInternalControlMigration='supabase/migrations/20260919090000_ship_internal_control_public.sql';
export const shipInternalControlRpcArgs={
  read_ship_dynamics_internal_control_public_v1:['p_workspace_key','p_vessel_id'],
  read_ship_dynamics_internal_control_public_revision_v1:['p_workspace_key'],
  submit_ship_dynamics_internal_control_public_v1:['p_workspace_key','p_vessel_id','p_actor_key:uuid','p_operation_id:uuid','p_items:jsonb'],
  get_ship_dynamics_internal_control_public_receipt_v1:['p_workspace_key','p_vessel_id','p_actor_key:uuid','p_operation_id:uuid','p_items:jsonb'],
};

export function shipInternalControlInput(initial){
  const template=initial.users[0];
  initial.users=[template,...[
    ['qa-manager','QA 分管',true],['qa-delegate','QA 啟用代管',true],['qa-inactive-delegate','QA 未啟用代管',true],['qa-unrelated','QA 其他船分管',true],['qa-disabled-user','QA 停用人員',false],
  ].map(([id,name,isActive])=>({...structuredClone(template),id,username:id,name,role:'operator',department:'管理組',isActive,managedVesselIds:[]}))];
  initial.vessels[0].assignedUserIds=['qa-manager'];
  initial.vessels[0].delegateManagers=[{userId:'qa-delegate',isActive:true},{userId:'qa-inactive-delegate',isActive:false}];
  initial.vessels[1].assignedUserIds=['qa-unrelated'];initial.vessels[1].delegateManagers=[];
  initial.vessels.push({...structuredClone(initial.vessels[1]),id:'qa-disabled-vessel',name:'QA 停用船',isActive:false});
  for(const vessel of initial.vessels)delete vessel.nameEn;
  for(const name of ['tasks','internalControlCases','meetings','agendaReports','taskDismissals','notifications','auditLogs'])initial[name]=[];
}

export async function installShipInternalControlFixture(db,workspace){
  await installMorningOracle(db);await db.exec(fs.readFileSync(schedulerSql,'utf8'));
  for(const file of [
    'supabase/migrations/20260904161000_appdata_compact_ack_receipts.sql',
    'supabase/migrations/20260817143000_data_management_storage.sql',
    'supabase/migrations/20260818154500_data_management_prune_batch_limit.sql',
    'supabase/normalized-legacy-cutover.sql',
    'supabase/development/20260911_legacy_report_workspace_binding.sql',
    'supabase/development/20260911_business_quiescence.sql',
    'supabase/development/20260911_paused_record_legacy_transfer.sql',
    'supabase/development/20260911_source_authority_publication.sql',
    'supabase/development/20260912_browser_source_authority.sql',
    'supabase/development/20260914_source_authority_roundtrip.sql',
  ])await db.exec(fs.readFileSync(file,'utf8'));
  // Synthetic admitted records-v1 control state, not a production cutover claim.
  const wid=(await db.query('select id from sd_workspaces where legacy_key=$1',[workspace])).rows[0]?.id;
  if(!wid)throw Error('QA requires the real fixture workspace mapping');
  const transition=randomUUID();
  await db.query('insert into ship_dynamics_quiescence_private.workspaces values($1,$2,$3)',[workspace,wid,transition]);
  await db.query("insert into ship_dynamics_quiescence_private.transitions values($1,$2,'resumed','{}')",[workspace,transition]);
  await db.query("insert into ship_dynamics_authority_private.current_v1 values($1,$2,1,'records-v1',$3,$4,'resumed')",[workspace,wid,randomUUID(),transition]);
  if(fs.existsSync(shipInternalControlMigration))await db.exec(fs.readFileSync(shipInternalControlMigration,'utf8'));
  await db.exec(fs.readFileSync('supabase/migrations/20260923120000_ship_internal_control_due_date.sql','utf8'));
}
