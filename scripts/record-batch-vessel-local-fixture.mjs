// Private PGlite owner-side fixture only; not a product mutation path.
export async function seedBatchVessel(qa){
 const {payload,revision}=await qa.read(),workspace='isolated-record-ui-qa';
 const third={...structuredClone(payload.vessels[1]),id:'qa-v3',name:'QA VESSEL 3',fullName:'QA VESSEL 3',shortName:'QA VESSEL 3'};
 const ids=[...payload.vessels.map(v=>v.id),third.id];
 await qa.db.transaction(async tx=>{
  await tx.query("insert into ship_dynamics_records(workspace_key,collection,entity_id,value,revision) values($1,'vessels',$2,$3::jsonb,$4)",[workspace,third.id,JSON.stringify(third),revision]);
  await tx.query("update ship_dynamics_record_collections set ids=$2::jsonb where workspace_key=$1 and collection='vessels'",[workspace,JSON.stringify(ids)]);
  await tx.query("update ship_dynamics_record_versions set orders=jsonb_set(orders,'{vessels}',$2::jsonb) where workspace_key=$1",[workspace,JSON.stringify(ids)]);
 });
}
