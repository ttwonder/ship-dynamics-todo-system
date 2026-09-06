// Private PGlite owner seeding BEFORE the original App mounts; no production SQL.
export async function seedWorkCenter(qa){
 const s=await qa.read(),d=s.payload,workspace='isolated-record-ui-qa';
 const template=d.tasks.find(t=>t.id==='qa-unrelated-task'),caseTemplate=d.internalControlCases[0];
 for(const action of ['personal','complete','delete']){
  d.tasks.push({...structuredClone(template),id:`qa-${action}-task`,description:`QA ${action.toUpperCase()} TASK`,vesselId:'qa-v1',vesselIds:['qa-v1'],ownerUserIds:['qa-owner','qa-operator']});
  d.internalControlCases.push({...structuredClone(caseTemplate),id:`qa-${action}-case`,description:`QA ${action.toUpperCase()} CASE`,syncToTask:false,linkedTaskId:undefined});
 }
 // Read fixture state avoids unrelated notification-read autosave at login.
 d.notifications=d.notifications.map(n=>({...n,readAt:d.updatedAt}));
 await qa.db.transaction(async tx=>{for(const collection of ['vessels','tasks','internalControlCases','notifications']){
  for(const row of d[collection])await tx.query('insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,$2,$3,$4::jsonb,$5) on conflict(workspace_key,collection,entity_id) do update set value=excluded.value',[workspace,collection,row.id,JSON.stringify(row),s.revision]);
  await tx.query('update ship_dynamics_record_collections set ids=$3::jsonb where workspace_key=$1 and collection=$2',[workspace,collection,JSON.stringify(d[collection].map(r=>r.id))]);
 }
 await tx.query("update ship_dynamics_record_versions set orders=(select jsonb_object_agg(collection,ids) from ship_dynamics_record_collections where workspace_key=$1) where workspace_key=$1",[workspace]);});
}
