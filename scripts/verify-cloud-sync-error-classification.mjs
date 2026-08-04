import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const errors=await server.ssrLoadModule('/src/cloudSyncError.ts');
  assert.deepEqual(errors.classifyCloudSyncFailure({conflicts:['authorization-domain']}),{
    kind:'authorization',
    message:'最新雲端身份、角色、權限或涉船範圍已變更；本機修改仍保留，但已拒絕用舊權限保存。請重新登入或與管理員確認。',
  });
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['缺少可信的雲端合併基線']}).kind,'safety');
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['雲端revision 2低於已確認的durable floor 3，疑似rollback']}).kind,'safety');
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['tasks:t1.status']}).kind,'field');
  assert.equal(errors.classifyCloudSyncFailure({conflicts:['dependency:meeting-task']}).kind,'field');
  assert.equal(errors.classifyCloudSyncFailure(new Error('network unavailable')).kind,'transport');
  assert.ok(!errors.classifyCloudSyncFailure({conflicts:['authorization-domain']}).message.includes('真正欄位衝突'));
  console.log('Cloud sync error classification contracts passed.');
}finally{
  await server.close();
}
