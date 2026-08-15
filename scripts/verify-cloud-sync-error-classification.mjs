import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'vite';

const app=fs.readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const errors=await server.ssrLoadModule('/src/cloudSyncError.ts');
  assert.deepEqual(errors.classifyCloudSyncFailure({conflicts:['authorization-domain']}),{
    kind:'authorization',
    message:'最新雲端身份、角色、權限或涉船範圍已變更；已拒絕用舊權限保存，本機修改仍保留。若不需要保留未上傳修改，請按「修復此瀏覽器」重新載入雲端；如需保留，請聯絡管理員。',
  });
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['缺少可信的雲端合併基線']}).kind,'safety');
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['雲端revision 2低於已確認的durable floor 3，疑似rollback']}).kind,'safety');
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['tasks:t1.status']}).kind,'field');
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['dependency:meeting-task']}).kind,'field');
  assert.equal(errors.classifyCloudSyncFailure(new Error('network unavailable')).kind,'transport');
  const structured={code:'57014',message:'canceling statement due to statement timeout',details:'while applying block patch',hint:'retry a smaller patch'};
  const structuredMessage=errors.cloudErrorMessage(structured);
  assert.match(structuredMessage,/canceling statement due to statement timeout/);
  assert.match(structuredMessage,/57014/);
  assert.ok(!structuredMessage.includes('[object Object]'),'structured Supabase/PostgREST errors must never degrade to [object Object]');
  assert.ok(!errors.classifyCloudSyncFailure(structured).message.includes('[object Object]'),'sync transport copy must use the structured cloud error formatter');
  assert.ok(app.includes('const message=cloudErrorMessage(error)'),'visible cloud-save failure reporting must use the same structured formatter');
  assert.ok(!errors.classifyCloudSyncFailure({conflicts:['authorization-domain']}).message.includes('真正欄位衝突'));
  assert.match(errors.classifyCloudSyncFailure({conflicts:['authorization-domain']}).message,/修復此瀏覽器/);
  console.log('Cloud sync error classification contracts passed.');
}finally{
  await server.close();
}
