import fs from 'node:fs';
import {itineraryWorkspaceId as workspace} from './record-itinerary-local-fixture.mjs';
export const schedulerSql='supabase/development/20260906_record_daily_morning_scheduler.sql';
export const capturedAt='2026-09-07T01:00:00Z';
export const legacyOwner='11111111-1111-4111-8111-111111111111';
export function morningInput(data){
 const at='2026-09-07T00:00:00.000Z';
 for(const v of data.vessels){v.fullName=v.name;v.shortName=v.name;}
 data.vessels.push({...structuredClone(data.vessels[1]),id:'inactive',isActive:false});
 data.internalControlCases=[{id:'case-private',vesselId:'qa-v1',description:'INTERNAL CASE MUST NOT PROJECT',isClosed:false,createdAt:at,updatedAt:at}];
 data.meetings=['meeting-on','meeting-off','meeting-internal','meeting-inactive'].map(id=>({id,subject:'RECORD '+id,status:'追蹤中',meetingDate:'2026-09-07',vesselScopeMode:'vessels',vessels:['qa-v1'],reason:'QA reason',departments:[],participantUserIds:[],trackingUserIds:[],responsibleUserIds:[],resolution:'QA resolution',taskItems:[],expectedDate:'',priority:'高',isInternalControl:id==='meeting-internal',includeInMorning:id!=='meeting-off',latestStatus:'',statusLogs:[],createdBy:'qa-owner',createdAt:at,updatedAt:at}));
 data.tasks=['open','closed','internal','scope-closed','inactive','linked','hidden','secret','orphan-temporary','future','meeting-inactive'].map(id=>({id,description:'RECORD TASK '+id,vesselId:id==='inactive'||id==='meeting-inactive'?'inactive':'qa-v1',vesselIds:[id==='inactive'||id==='meeting-inactive'?'inactive':'qa-v1'],vesselScopeMode:'vessels',vesselTypeScopes:[],priority:'高',attentionDimension:'task',isAware:false,isAbnormal:false,isInternalControl:id==='internal',category:'其他',categories:['其他'],equipmentSubcategory:'',status:'處理中',expectedDate:'',reportDate:'2026-09-07',departments:[],ownerUserIds:[],isClosed:id==='closed',sourceMeetingId:({linked:'meeting-on',hidden:'meeting-off',secret:'meeting-internal','meeting-inactive':'meeting-inactive'})[id],distributeToVessels:false,sourceType:id==='orphan-temporary'?'temporary':'morning',createdBy:'qa-owner',updatedBy:'qa-owner',createdAt:id==='future'?'2026-09-08T00:00:00.000Z':at,updatedAt:at,statusLogs:[],vesselProgress:id==='scope-closed'?[{vesselId:'qa-v1',status:'已完成',isClosed:true}]:[]}));
 return data;
}
export async function installMorningOracle(db){
 for(const file of ['supabase/normalized-core-domain.sql','supabase/normalized-meeting.sql'])await db.exec(fs.readFileSync(file,'utf8'));
 const sql=fs.readFileSync('supabase/migrations/20260806093000_daily_morning_reports.sql','utf8');
 await db.exec(sql.slice(0,sql.indexOf('create extension if not exists pg_cron'))+'commit;');
 await db.exec(fs.readFileSync('supabase/migrations/20260903230000_itinerary_daily_morning_projection.sql','utf8'));
}
export async function seedMorningOracle(db,data,key,{sortedFormal=false}={}){
 await db.query('insert into auth.users(id) values($1)',[legacyOwner]);
 await db.query("insert into sd_profiles(id,display_name,username_label) values($1,'LEGACY OWNER','legacy-owner')",[legacyOwner]);
 await db.query("insert into sd_memberships(workspace_id,user_id,legacy_user_id,role,is_active) values($1,$2,'qa-owner','owner',true)",[workspace,legacyOwner]);
 await db.query("update sd_vessels set is_active=false where workspace_id=$1 and id='inactive'",[workspace]);
 for(const m of data.meetings)await db.query(`insert into sd_meetings(workspace_id,id,scope_mode,subject,status,meeting_date,reason,priority,include_in_morning,is_internal_control,created_by,updated_by) values($1,$2,'vessels',$3,'追蹤中','2026-09-07','QA reason','高',$4,$5,$6,$6)`,[workspace,m.id,m.subject,m.includeInMorning,m.isInternalControl,legacyOwner]);
 for(const t of data.tasks){
  await db.query(`insert into sd_tasks(workspace_id,id,description,status,priority,source_kind,is_internal_control,is_closed,closed_date,closed_by,source_meeting_id,source_type,created_at) values($1,$2,$3,'處理中','高','ordinary',$4,$5,case when $5 then '2026-09-07'::date else null end,case when $5 then $8::uuid else null end,$6,$7,$9::timestamptz)`,[workspace,t.id,t.description,t.isInternalControl,t.isClosed,t.sourceMeetingId??null,t.sourceType,legacyOwner,t.createdAt]);
  const closed=t.id==='scope-closed';
  await db.query(`insert into sd_task_vessels(workspace_id,task_id,vessel_id,is_closed,closed_date,closed_by) values($1,$2,$3,$4,case when $4 then '2026-09-07'::date else null end,case when $4 then $5::uuid else null end)`,[workspace,t.id,t.vesselId,closed,legacyOwner]);
 }
 await db.query('insert into ship_dynamics_app_state(workspace_key,revision,payload) values($1,99,$2::jsonb)',[key,JSON.stringify({...data,revision:99,users:[{...data.users[0],name:'LEGACY OWNER'}],agendaReports:[]})]);
 const doc=(await db.query('select rows_payload from sd_itinerary_documents where workspace_id=$1 and vessel_id=$2',[workspace,'qa-v1'])).rows[0].rows_payload;
 const first={...doc[0],sortOrder:0,etbUtc:'2026-09-07T01:00:00Z',etbTimeZone:'UTC+9',etdUtc:'2026-09-07T10:00:00Z',etdTimeZone:'UTC-6'};
 await db.query("update sd_itinerary_documents set rows_payload=$1::jsonb where workspace_id=$2 and vessel_id='qa-v1'",[JSON.stringify(sortedFormal?[first,{...first,rowId:'later',sortOrder:1,previousPortName:''}]:[{...first,rowId:'later',sortOrder:2,previousPortName:'WRONG LATER'},first]),workspace]);
}
