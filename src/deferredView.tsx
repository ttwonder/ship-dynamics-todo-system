import React, { lazy, Suspense, type ComponentProps, type ComponentType } from 'react';

/** Keep loading/failure local: a page download must not unmount the App or its drafts. */
export function deferredView<T extends ComponentType<any>>(load:()=>Promise<{default:T}>){
  // Browsers can cache a rejected import for the life of this document. Do not
  // offer a retry that cannot recover it, or reload automatically over a draft.
  const View=lazy<ComponentType<ComponentProps<T>>>(()=>load().catch(()=>({default:()=>
    <div className="empty-note" role="alert">功能程式下載失敗；本機內容保留。請先保留未保存內容，再重新開啟網頁。</div>
  })));
  return function DeferredView(props:ComponentProps<T>){
    return <Suspense fallback={<div className="empty-note" role="status">正在載入功能…</div>}><View {...props}/></Suspense>;
  };
}
