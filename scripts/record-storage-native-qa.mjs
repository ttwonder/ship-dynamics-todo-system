import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

// No connection-string/host/database input: only an owned fresh localhost cluster.
export async function createNativeRecordQa(run,receipt,{httpTransactions=false,beforeCommit=null}={}){
 assert.ok(!beforeCommit||httpTransactions,'Native commit barrier requires opt-in HTTP transactions');
 const bin=process.env.SHIP_QA_PG_BIN,modulePath=process.env.SHIP_QA_PG_MODULE;
 for(const p of [bin,modulePath])assert.ok(p&&path.isAbsolute(p),'Explicit absolute SHIP_QA_PG_BIN / SHIP_QA_PG_MODULE required');
 for(const k of Object.keys(process.env))if(/^PG/i.test(k))delete process.env[k];
 const env={...process.env};delete env.DATABASE_URL;
 const {Client}=createRequire(import.meta.url)(modulePath);
 const data=path.join(run,'data'),marker=path.join(run,'OWNED-QA.json');
 const clients=new Set();let port;
 const save=()=>fs.writeFileSync(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
 const command=(name,args)=>{
  const start=new Date().toISOString(),fd=fs.openSync(path.join(run,'postgres-commands.log'),'a');let exit=0;
  try{return execFileSync(path.join(bin,name+(process.platform==='win32'?'.exe':'')),args,{env,stdio:['ignore',fd,fd],windowsHide:true,timeout:30000});}
  catch(e){exit=e.status??e.code??1;throw e;}
  finally{fs.closeSync(fd);receipt.commands??=[];receipt.commands.push({name,args,start,end:new Date().toISOString(),exit});save();}
 };
 const connect=async name=>{
  const c=new Client({host:'127.0.0.1',port,user:'ship_qa',database:'postgres',password:'',ssl:false,application_name:'record_native_'+name,connectionTimeoutMillis:3000,statement_timeout:8000,query_timeout:10000});
  c.on('error',e=>{receipt.connectionErrors??=[];receipt.connectionErrors.push({name,code:e.code});save();});
  await c.connect();clients.add(c);
  const identity=(await c.query("select current_setting('data_directory') data,host(inet_server_addr()) host,inet_server_port() port,pg_backend_pid() pid,current_user as actor,version() version")).rows[0];
  assert.equal(path.resolve(identity.data).toLowerCase(),path.resolve(data).toLowerCase(),'Exact owned data directory');
  assert.equal(identity.host,'127.0.0.1');assert.equal(identity.port,port);assert.equal(identity.actor,'ship_qa');
  receipt.connections??=[];receipt.connections.push({name,...identity});save();return c;
 };
 const close=async()=>{
  // Roll back before closing: a queued peer cannot prevent the owner releasing.
  for(const c of clients)try{await c.query('rollback');}catch{}
  for(const c of clients)try{await c.end();}catch{}
  clients.clear();
  if(fs.existsSync(path.join(data,'postmaster.pid')))command('pg_ctl',['-D',data,'-m','fast','-w','-t','20','stop']);
  receipt.stopped=!fs.existsSync(path.join(data,'postmaster.pid'));
  assert.equal(receipt.stopped,true,'Owned postmaster stopped');
  if(port){
   receipt.portClosed=await new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',()=>resolve(true));s.setTimeout(2000,()=>{s.destroy();resolve(false);});});
   assert.equal(receipt.portClosed,true,'Owned port no longer listening');
  }
  if(fs.existsSync(data)){
   const owned=JSON.parse(fs.readFileSync(marker,'utf8'));assert.equal(owned.data,data);assert.equal(owned.kind,'records-v1-native-synthetic');
   await fs.promises.rm(data,{recursive:true,maxRetries:5,retryDelay:100});receipt.ownedDataRemoved=true;
  }
  save();
 };
 try{
  const listener=net.createServer();await new Promise((r,j)=>{listener.once('error',j);listener.listen(0,'127.0.0.1',r);});port=listener.address().port;await new Promise(r=>listener.close(r));
  fs.writeFileSync(marker,JSON.stringify({kind:'records-v1-native-synthetic',data,port}));
  receipt.isolation={data,host:'127.0.0.1',port,pgEnvironmentRemoved:true,connectionStringAccepted:false};save();
  command('initdb',['-D',data,'-U','ship_qa','--encoding=UTF8','--locale=C','--auth-local=trust','--auth-host=trust']);
  command('pg_ctl',['-D',data,'-l',path.join(run,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=${httpTransactions?24:12} -c timezone=UTC -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`,'-w','-t','20','start']);
  const setup=await connect('setup'),observer=await connect('observer'),a=await connect('writer_a'),b=await connect('writer_b');
  assert.equal(new Set(receipt.connections.map(c=>c.pid)).size,4);
  const adapter={query:(...args)=>setup.query(...args),exec:sql=>setup.query(sql),close:async()=>{},transaction:async fn=>{await setup.query('begin');try{const v=await fn(adapter);await setup.query('commit');return v;}catch(e){await setup.query('rollback');throw e;}}};
  if(httpTransactions){
   // Bounded reusable clients; identity is checked by connect BEFORE checkout.
   // Setup/observer/direct baseline clients never service HTTP transactions.
   const idle=[],waiting=[];let allocated=0;
   const acquire=async()=>{if(idle.length)return idle.pop();if(allocated<10){const n=++allocated;try{return await connect('http_'+n);}catch(e){allocated--;throw e;}}return new Promise(resolve=>waiting.push(resolve));};
   const release=c=>{const next=waiting.shift();if(next)next(c);else idle.push(c);};
   adapter.httpTransactions=true;adapter.qaKind='REAL_UI_SYNTHETIC_DATA_NATIVE_POSTGRES';
   adapter.transaction=async(fn,context={})=>{
    const c=await acquire(),pid=c.processID;
    const row={rpc:context.rpc,operationId:context.operationId,payloadHash:context.payloadHash,pid,started:new Date().toISOString()};
    receipt.httpTransactions??=[];receipt.httpTransactions.push(row);save();
    const tx={query:(...args)=>c.query(...args),exec:sql=>c.query(sql)};
    try{
     await c.query('begin');const value=await fn(tx);
     Object.assign(row,{sqlFinished:true,status:value?.ok===false?value.code:'SQL_OK',conflictKey:value?.conflict_key,revision:value?.revision});save();
     if(beforeCommit)await beforeCommit({context,pid,value});
     await c.query('commit');row.committed=true;return value;
    }catch(e){await c.query('rollback');row.rolledBack=true;row.errorCode=e.code;throw e;}
    finally{row.ended=new Date().toISOString();release(c);save();}
   };
  }
  return {adapter,observer,a,b,connect,close,save};
 }catch(e){try{await close();}catch(cleanup){receipt.cleanupError=cleanup.message;save();}throw e;}
}
