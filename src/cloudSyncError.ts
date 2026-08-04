export type CloudSyncFailureKind='authorization'|'safety'|'field'|'transport';

const SAFETY_MARKERS=['缺少可信','durable','rollback','工作區已變更','工作區不存在','來源未綁定','主資料遺失','identity','registry損壞','雲端工作區沒有主資料'];

export function classifyCloudSyncFailure(error:unknown):{kind:CloudSyncFailureKind;message:string}{
  const conflicts=Array.isArray((error as{conflicts?:unknown})?.conflicts)
    ?(error as{conflicts:unknown[]}).conflicts.map(value=>String(value))
    :[];
  if(conflicts.includes('authorization-domain'))return{
    kind:'authorization',
    message:'最新雲端身份、角色、權限或涉船範圍已變更；本機修改仍保留，但已拒絕用舊權限保存。請重新登入或與管理員確認。',
  };
  if(conflicts.length){
    const detail=conflicts.join('、');
    if(conflicts.some(conflict=>SAFETY_MARKERS.some(marker=>conflict.includes(marker))))return{
      kind:'safety',
      message:`同步被資料安全機制阻擋：${detail}；本機修改仍完整保留，未採用或覆蓋可疑雲端資料。`,
    };
    return{
      kind:'field',
      message:`同步發現真正欄位衝突：${detail}；本機編輯內容仍完整保留，未被雲端資料覆蓋。請協調衝突欄位後再保存。`,
    };
  }
  const message=error instanceof Error?error.message:String(error);
  return{kind:'transport',message:`同步失敗：${message}；本機編輯內容仍完整保留。`};
}
