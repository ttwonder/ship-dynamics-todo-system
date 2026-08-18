import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserAccount } from './types';
import { getSupabaseConfig } from './cloud';
import {
  clearPendingRevisionPrune,
  createPendingRevisionPrune,
  dataManagementErrorMessage,
  DataManagementRpcError,
  formatDataBytes,
  getShipDynamicsStorageStats,
  pruneShipDynamicsRevisionHistory,
  readPendingRevisionPrune,
  writePendingRevisionPrune,
  type PendingRevisionPrune,
  type ShipDynamicsStorageStats,
} from './dataManagement';
import { formatTaipeiDateTime } from './taipeiTime';

interface Props {
  currentUser: UserAccount;
}

type DataView = 'overview' | 'items' | 'history';
const HISTORY_PAGE_SIZE = 100;

const revisionListLabel = (revisions: number[]) => revisions.length <= 12
  ? revisions.map(revision => `r${revision}`).join('、')
  : `${revisions.slice(0, 12).map(revision => `r${revision}`).join('、')}，另 ${revisions.length - 12} 份`;

export default function DataManagementPanel({ currentUser }: Props) {
  const owner = currentUser.role === 'owner';
  const [view, setView] = useState<DataView>('overview');
  const [stats, setStats] = useState<ShipDynamicsStorageStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedRevisions, setSelectedRevisions] = useState<number[]>([]);
  const [pending, setPending] = useState<PendingRevisionPrune | null>(null);
  const [itemQuery, setItemQuery] = useState('');
  const [itemCollection, setItemCollection] = useState('all');
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setErrorText('');
    try {
      const config = getSupabaseConfig();
      if (config) setPending(readPendingRevisionPrune(config, currentUser.id));
      const next = await getShipDynamicsStorageStats(currentUser.id, config);
      if (activeRequest !== requestId.current) return;
      setStats(next);
      const available = new Set(next.revisions.filter(row => !row.current).map(row => row.revision));
      setSelectedRevisions(previous => previous.filter(revision => available.has(revision)));
    } catch (error) {
      if (activeRequest !== requestId.current) return;
      setErrorText(dataManagementErrorMessage(error));
    } finally {
      if (activeRequest === requestId.current) setLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    setStats(null);
    setSelectedRevisions([]);
    setPending(null);
    setNotice('');
    void refresh();
    return () => { requestId.current += 1; };
  }, [currentUser.id, refresh]);

  const performPrune = async (envelope: PendingRevisionPrune, reconciling: boolean) => {
    const config = getSupabaseConfig();
    if (!config) {
      setErrorText(dataManagementErrorMessage(new DataManagementRpcError('CLOUD_NOT_CONFIGURED', '', true)));
      return;
    }
    setActing(true);
    setErrorText('');
    setNotice('');
    try {
      const result = await pruneShipDynamicsRevisionHistory(envelope, config);
      clearPendingRevisionPrune(config, currentUser.id);
      setPending(null);
      setSelectedRevisions([]);
      setNotice(`${reconciling ? '上次操作已對帳' : '歷史版本已刪除'}：${result.deletedCount} 份，邏輯量 ${formatDataBytes(result.deletedBytes)}。目前正式資料未變更。`);
      await refresh();
    } catch (error) {
      const definitive = error instanceof DataManagementRpcError && error.definitive;
      const message = dataManagementErrorMessage(error);
      if (definitive) {
        clearPendingRevisionPrune(config, currentUser.id);
        setPending(null);
      } else {
        setPending(envelope);
      }
      if (definitive && error instanceof DataManagementRpcError && error.code === 'REVISION_SET_CHANGED') {
        await refresh();
      }
      setErrorText(message);
    } finally {
      setActing(false);
    }
  };

  const startPrune = async () => {
    if (!owner || !stats || pending || acting) return;
    const chosen = Array.from(new Set(selectedRevisions)).sort((left, right) => left - right);
    if (!chosen.length) {
      setErrorText('請先人工勾選要刪除的歷史版本。');
      return;
    }
    if (chosen.includes(stats.currentRevision)) {
      setErrorText('目前正式 Revision 不可刪除。');
      return;
    }
    const selectedRows = stats.revisions.filter(row => chosen.includes(row.revision));
    const selectedBytes = selectedRows.reduce((sum, row) => sum + row.logicalBytes, 0);
    const confirmed = window.confirm([
      `確定刪除 ${chosen.length} 份 Ship Dynamics 歷史版本？`,
      `版本：${revisionListLabel(chosen)}`,
      `預估邏輯量：${formatDataBytes(selectedBytes)}`,
      '',
      `目前正式 Revision r${stats.currentRevision}、待辦、船舶、會議、內控、操作紀錄與其他正常資料都不會刪除。`,
      '刪除後無法復原；PostgreSQL 物理總量不一定立即縮小。',
    ].join('\n'));
    if (!confirmed) return;
    const config = getSupabaseConfig();
    if (!config) {
      setErrorText('尚未配置 Supabase，無法刪除雲端歷史版本。');
      return;
    }
    const envelope = createPendingRevisionPrune({
      operationId: crypto.randomUUID(),
      actorUserId: currentUser.id,
      expectedRevisions: stats.revisions.map(row => row.revision),
      deleteRevisions: chosen,
    }, config);
    try {
      writePendingRevisionPrune(envelope, config);
    } catch {
      setErrorText('瀏覽器無法保存刪除對帳資料；為避免結果無法追蹤，本次未送出任何刪除。');
      return;
    }
    setPending(envelope);
    await performPrune(envelope, false);
  };

  const selectedBytes = useMemo(() => stats?.revisions
    .filter(row => selectedRevisions.includes(row.revision))
    .reduce((sum, row) => sum + row.logicalBytes, 0) || 0, [stats, selectedRevisions]);
  const filteredItems = useMemo(() => {
    const query = itemQuery.trim().toLocaleLowerCase('zh-TW');
    return (stats?.items || [])
      .filter(item => itemCollection === 'all' || item.collectionKey === itemCollection)
      .filter(item => !query || `${item.label} ${item.id} ${item.collectionLabel}`.toLocaleLowerCase('zh-TW').includes(query))
      .sort((left, right) => right.logicalBytes - left.logicalBytes || left.label.localeCompare(right.label, 'zh-TW'));
  }, [stats, itemCollection, itemQuery]);

  const nav = [
    { id: 'overview' as const, icon: '▦', label: '空間總覽', meta: stats ? formatDataBytes(stats.databaseTotalBytes) : '—' },
    { id: 'items' as const, icon: '≡', label: '單項資料用量', meta: stats ? `${stats.items.length} 項` : '—' },
    { id: 'history' as const, icon: '↺', label: '歷史版本清理', meta: stats ? `${stats.revisionHistoryCount} 份` : '—' },
  ];

  return <>
    <div className="management-master data-management-master">
      <div className="management-master-heading"><div><h2>數據管理</h2><small>Supabase 用量與安全清理</small></div><button className="btn small ghost" onClick={() => void refresh()} disabled={loading || acting}>{loading ? '讀取中…' : '↻ 刷新空間'}</button></div>
      <div className="management-list">{nav.map(item => <button key={item.id} className={`management-list-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)}><span className="management-avatar data">{item.icon}</span><span><b>{item.label}</b><small>{item.id === 'overview' ? '物理量與邏輯量分開' : item.id === 'items' ? '目前正式資料，只供判斷' : '只清理 revision snapshots'}</small></span><em>{item.meta}</em></button>)}</div>
      <div className="data-management-scope-note"><b>安全邊界</b><span>數據管理不直接刪除待辦、船舶、會議、內控、帳號或操作紀錄。</span></div>
    </div>

    <div className="management-detail data-management-detail">
      <div className="management-editor data-management-editor">
        <div className="management-editor-heading"><div><h2>{view === 'overview' ? 'Supabase 空間使用' : view === 'items' ? '單項資料用量' : '歷史版本選擇性清理'}</h2><p>{view === 'overview' ? '資料庫物理量、目前內容、revision history 與 Storage 分開顯示。' : view === 'items' ? '逐分類及逐筆計算目前 payload 的 JSONB 邏輯量；不等於物理磁碟分攤。' : '由 Owner 人工勾選舊 revision；目前正式 revision 永久保護。'}</p></div>{stats?.generatedAt && <small className="data-management-updated">更新：{formatTaipeiDateTime(stats.generatedAt)}</small>}</div>

        {errorText && <div className="data-management-message error" role="alert">{errorText}</div>}
        {notice && <div className="data-management-message success" role="status">{notice}</div>}
        {pending && <div className="data-management-pending" role="alert"><div><b>上次刪除結果尚未確認</b><span>操作 {pending.operationId.slice(0, 8)}｜預定刪除 {pending.deleteRevisions.length} 份。系統不會另建刪除操作；請用相同 operation 對帳。</span></div><button className="btn danger" disabled={acting} onClick={() => void performPrune(pending, true)}>{acting ? '對帳中…' : '對帳上次操作'}</button></div>}

        {!stats && !loading && !errorText && <div className="management-empty"><b>尚無空間資料</b><span>按「刷新空間」讀取 Supabase。</span></div>}
        {!stats && loading && <div className="management-empty"><b>正在讀取 Supabase</b><span>只讀取用量與 revision metadata，不下載歷史 payload。</span></div>}

        {stats && view === 'overview' && <Overview stats={stats}/>}
        {stats && view === 'items' && <ItemsView stats={stats} items={filteredItems} query={itemQuery} setQuery={setItemQuery} collection={itemCollection} setCollection={setItemCollection}/>}
        {stats && view === 'history' && <HistoryView stats={stats} owner={owner} pending={Boolean(pending)} acting={acting} selected={selectedRevisions} setSelected={setSelectedRevisions} selectedBytes={selectedBytes} onDelete={startPrune}/>}
      </div>
    </div>
  </>;
}

function Overview({ stats }: { stats: ShipDynamicsStorageStats }) {
  return <>
    <div className="data-management-metrics">
      <article className="database"><small>Supabase 資料庫總用量</small><b>{formatDataBytes(stats.databaseTotalBytes)}</b><span>整個 Project database；含本系統、其他表及索引。</span></article>
      <article className="application"><small>本系統資料表用量</small><b>{formatDataBytes(stats.appDatabasePhysicalBytes)}</b><span>ship_dynamics_*／sd_* 的 heap、index、TOAST。</span></article>
      <article className="storage"><small>Supabase Storage 檔案</small><b>{formatDataBytes(stats.storageObjectBytes)}</b><span>{stats.storageObjectCount} 個物件；整個 Project Bucket 合計。</span></article>
      <article className="static"><small>網站程式檔</small><b>{stats.staticSiteHost}</b><span>HTML／JS／CSS 不佔 Supabase Storage。</span></article>
    </div>
    <section className="management-editor-section"><h3>目前內容與歷史邏輯量</h3><div className="management-editor-section-body"><div className="data-management-secondary-metrics"><span><small>目前雲端主資料</small><b>{formatDataBytes(stats.currentStateBytes)}</b></span><span><small>歷史版本合計</small><b>{formatDataBytes(stats.revisionHistoryBytes)}</b></span><span><small>歷史版本數</small><b>{stats.revisionHistoryCount}</b></span><span><small>目前 Revision</small><b>r{stats.currentRevision}</b></span></div></div></section>
    <div className="data-management-warning"><b>計量說明</b><p>資料庫總用量與本系統資料表用量是物理配置量，後者已包含在前者內，不能相加。單項／目前內容／歷史版本使用 <code>pg_column_size</code> 邏輯量；刪除後邏輯量會下降，但 MVCC、索引與 TOAST 頁面可能保留，因此物理量不一定立即縮小。</p></div>
  </>;
}

function ItemsView({ stats, items, query, setQuery, collection, setCollection }: { stats:ShipDynamicsStorageStats; items:ShipDynamicsStorageStats['items']; query:string; setQuery:(value:string)=>void; collection:string; setCollection:(value:string)=>void }) {
  return <>
    <section className="management-editor-section"><h3>目前資料分類</h3><div className="management-editor-section-body"><div className="data-management-table-wrap"><table className="data-management-table"><thead><tr><th>資料分類</th><th>筆數</th><th>目前邏輯量</th><th>平均／筆</th></tr></thead><tbody>{stats.collections.map(row => <tr key={row.key}><td><b>{row.label}</b><small>{row.key}</small></td><td>{row.itemCount}</td><td>{formatDataBytes(row.logicalBytes)}</td><td>{row.itemCount ? formatDataBytes(row.logicalBytes / row.itemCount) : '—'}</td></tr>)}</tbody></table></div></div></section>
    <section className="management-editor-section"><h3>逐筆邏輯量</h3><div className="management-editor-section-body"><div className="data-management-filters"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋名稱或系統 ID…"/><select value={collection} onChange={event => setCollection(event.target.value)}><option value="all">全部分類</option>{stats.collections.filter(row => row.key !== 'settings').map(row => <option key={row.key} value={row.key}>{row.label}</option>)}</select><span>顯示 {items.length} 項</span></div><div className="data-management-table-wrap items"><table className="data-management-table"><thead><tr><th>分類</th><th>單項資料</th><th>系統 ID</th><th>邏輯量</th></tr></thead><tbody>{items.map(item => <tr key={`${item.collectionKey}:${item.id}`}><td>{item.collectionLabel}</td><td title={item.label}><b>{item.label}</b></td><td><code>{item.id}</code></td><td>{formatDataBytes(item.logicalBytes)}</td></tr>)}{!items.length && <tr><td colSpan={4} className="data-management-empty-row">沒有符合條件的資料。</td></tr>}</tbody></table></div></div></section>
    <div className="data-management-warning safe"><b>只供人工判斷</b><p>這一頁不提供正式業務資料的刪除鍵。待辦、船舶、會議、內控、人員與操作紀錄必須沿用各自原本的權限、關聯與保存流程處理；只有「歷史版本清理」可移除獨立 revision snapshot。</p></div>
  </>;
}

function HistoryView({ stats, owner, pending, acting, selected, setSelected, selectedBytes, onDelete }: { stats:ShipDynamicsStorageStats; owner:boolean; pending:boolean; acting:boolean; selected:number[]; setSelected:React.Dispatch<React.SetStateAction<number[]>>; selectedBytes:number; onDelete:()=>Promise<void> }) {
  const pageCount = Math.max(1, Math.ceil(stats.revisions.length / HISTORY_PAGE_SIZE));
  const [page, setPage] = useState(1);
  useEffect(() => setPage(previous => Math.min(previous, pageCount)), [pageCount]);
  const pageStart = (page - 1) * HISTORY_PAGE_SIZE;
  const pageRows = stats.revisions.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
  const toggle = (revision:number) => setSelected(previous => previous.includes(revision) ? previous.filter(value => value !== revision) : [...previous, revision]);
  return <>
    <div className="data-management-retention-head"><div><b>{owner ? `已人工選擇 ${selected.length} 份` : '管理員可查看；只有 Owner 可清理'}</b><span>{owner ? `預估邏輯量 ${formatDataBytes(selectedBytes)}` : '正式資料與歷史版本均為唯讀'}</span></div>{owner && <><button className="btn small ghost" disabled={!selected.length || acting || pending} onClick={() => setSelected([])}>清除選擇</button><button className="btn danger" disabled={!selected.length || acting || pending} onClick={() => void onDelete()}>{acting ? '處理中…' : `刪除所選 ${selected.length} 份`}</button></>}</div>
    <div className="data-management-history-pagination"><button className="btn small ghost" disabled={page <= 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}>← 上一頁</button><label><span>第</span><select aria-label="歷史版本頁次" value={page} onChange={event => setPage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select><span>／{pageCount} 頁</span></label><button className="btn small ghost" disabled={page >= pageCount} onClick={() => setPage(previous => Math.min(pageCount, previous + 1))}>下一頁 →</button><em>顯示 {stats.revisions.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageRows.length, stats.revisions.length)}／共 {stats.revisions.length} 份</em></div>
    <div className="data-management-table-wrap history"><table className="data-management-table"><thead><tr><th>選擇</th><th>Revision</th><th>保存時間</th><th>保存者</th><th>單份邏輯量</th><th>保護狀態</th></tr></thead><tbody>{pageRows.map(row => <tr key={row.revision} className={row.current ? 'current' : selected.includes(row.revision) ? 'selected' : ''}><td>{row.current ? <span className="data-management-lock">🔒</span> : <input type="checkbox" aria-label={`選擇刪除 revision ${row.revision}`} disabled={!owner || pending || acting} checked={selected.includes(row.revision)} onChange={() => toggle(row.revision)}/>}</td><td><b>r{row.revision}</b></td><td>{row.savedAt ? formatTaipeiDateTime(row.savedAt) : '未記錄'}</td><td>{row.savedBy || '未記錄'}</td><td>{formatDataBytes(row.logicalBytes)}</td><td>{row.current ? <strong>目前正式版本｜不可刪</strong> : '歷史快照'}</td></tr>)}</tbody></table></div>
    <div className="data-management-warning danger"><b>刪除範圍</b><p>只會 DELETE 所勾選的 <code>ship_dynamics_app_revisions</code> 列；不會改動 <code>ship_dynamics_app_state</code>、目前 Revision、任何正式業務資料、Storage object、Lease 或一般操作紀錄。送出時會核對完整 revision 集合；預覽後若有新保存，整次 fail closed，不刪除任何版本。</p></div>
  </>;
}
