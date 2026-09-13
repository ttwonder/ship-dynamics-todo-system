import assert from 'node:assert/strict';
export async function verifyBrowserAuthorityControls({native,qa,receipt,save}){
 const pass=(caseId,layer)=>{receipt.cases.push({caseId,layer,status:'PASS'});save();};
 const m=await qa.loadModule('/src/cloudSourceAuthority.ts');
 const cfg={supabaseUrl:qa.origin,supabaseAnonKey:'not-persisted',workspaceKey:qa.workspace,tableName:'ship_dynamics_app_state',storageMode:'records-v1',readMode:'scoped-v1'};
 const raw={workspace:qa.workspace,managed:false,source:null,epoch:0,pauseState:'unmanaged',admitted:true};
 const a=m.parseBrowserAuthority(raw,cfg),b=m.parseBrowserAuthority({...raw,managed:true,source:'legacy',epoch:1,pauseState:'resumed'},cfg);
 for(const value of [null,{}, {...raw,workspace:'other'}, {...raw,source:'unknown'}, {...raw,epoch:1}, {...raw,admitted:'true'}, {...raw,pauseState:'paused'}])assert.throws(()=>m.parseBrowserAuthority(value,cfg));
 pass('BA-U01-invalid-is-not-unmanaged','module');
 assert.equal(a.source,'records-v1');assert.equal(m.sameAuthority(a,b),false);assert.notEqual(m.authorityFloorIdentity('w',a),m.authorityFloorIdentity('w',b));
 assert.equal(m.authorityConfig(cfg,b).storageMode,'legacy');assert.equal(cfg.storageMode,'records-v1');assert.equal(m.authorityConfig(cfg,b).readMode,'snapshot');
 pass('BA-U02-source-config-floor-separation','module');
 const source={revision:99,updatedAt:'a',users:[{id:'u',name:'A'}]},target={revision:2,updatedAt:'b',users:[{name:'A',id:'u'}]};
 m.assertAuthorityBridge(source,target);assert.throws(()=>m.assertAuthorityBridge(source,{...target,users:[{id:'u',name:'B'}]}));
 pass('BA-U03-complete-bridge-not-revision-order','module');
 const c=await native.connect('browser_read_controls');
 const snapshot=async()=>{
  const tables=(await c.query("select schemaname,tablename from pg_tables where schemaname in ('public','ship_dynamics_authority_private','ship_dynamics_quiescence_private') order by 1,2")).rows;
  const values=[];for(const t of tables){assert.match(t.schemaname,/^[a-z_][a-z_0-9]*$/);assert.match(t.tablename,/^[a-z_][a-z_0-9]*$/);values.push((await c.query(`select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'null')) h from ${t.schemaname}.${t.tablename} t`)).rows[0].h);}return values;
 };
 try{
  const before=await snapshot();
  for(const role of ['anon','authenticated']){
   await c.query('begin read only');await c.query('set local role '+role);
   const v=(await c.query('select read_ship_dynamics_browser_authority_v1($1) r',[qa.workspace])).rows[0].r;
   assert.deepEqual(v,raw);await c.query('commit');pass('BA-N01-readonly-'+role,'native-PG-role');
  }
  for(const [id,sql,args,code] of [
   ['invalid','select read_ship_dynamics_browser_authority_v1($1)',[' '+qa.workspace],'22023'],
   ['missing','select read_ship_dynamics_browser_authority_v1($1)',['missing-workspace'],'55000'],
   ['private','select * from ship_dynamics_authority_private.current_v1',[],'42501'],
   ['operator','select read_ship_dynamics_source_authority_v1($1)',[qa.workspace],'42501']]){
   await c.query('begin read only;set local role anon');await assert.rejects(()=>c.query(sql,args),e=>e.code===code);await c.query('rollback');pass('BA-N02-reject-'+id,'native-PG-role');
  }
  assert.deepEqual(await snapshot(),before);pass('BA-N03-all-business-control-ledger-unchanged','native-PG-role');
 }finally{await c.end();}
}
