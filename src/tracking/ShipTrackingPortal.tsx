import { useEffect, useRef, useState } from 'react';
import { getSupabaseConfig } from '../cloud';
import { createInitialData } from '../data/seed';
import type { AppData, InternalControlCase, UserAccount } from '../types';
import { vesselSelectionDisplayName } from '../vesselDisplay';
import { formatTaipeiDateTime } from '../taipeiTime';
import TrackingPage from './TrackingPage';
import type { TrackingUiCallbacks } from './trackingUiTypes';
import { ShipTrackingRepository, shipTrackingMessage, type ShipTrackingSnapshot } from './shipTracking';

/** UI-only projection. No roster, general workspace or task endpoint is read. */
function project(snapshot: ShipTrackingSnapshot, actorKey: string): { data: AppData; user: UserAccount } {
  const seed = createInitialData();
  const user: UserAccount = { id: actorKey, name: '船端跟蹤（未驗證身份）', username: '', department: '', role: 'vessel', isActive: true, managedVesselIds: [], passwordHash: '', createdAt: '', updatedAt: '' };
  const data: AppData = {
    revision: snapshot.revision, updatedAt: snapshot.updatedAt,
    settings: { ...seed.settings, sitePasswordHash: '', ...(snapshot.catalog || {}) },
    users: [user], vessels: snapshot.vessels.map(v => ({ ...seed.vessels[0], ...v, isActive: true, assignedUserIds: [], delegateManagers: [] })),
    trackingItems: snapshot.trackingItems, internalControlCases: snapshot.cases,
    tasks: [], meetings: [], agendaReports: [], taskDismissals: [], auditLogs: [], notifications: [],
  };
  return { data, user };
}

export default function ShipTrackingPortal() {
  const [connection] = useState(() => {
    try { const config = getSupabaseConfig(); return config ? { backend: new ShipTrackingRepository(config), error: '' } : { backend: null, error: '船端跟蹤服務未配置，沒有讀取或写入雲端資料。' }; }
    catch (error) { return { backend: null, error: shipTrackingMessage(error) }; }
  });
  const backend = connection.backend;
  const [view, setView] = useState<ReturnType<typeof project> | null>(null);
  const [notice, setNotice] = useState(connection.error), [refreshing, setRefreshing] = useState(false);
  const [caseView, setCaseView] = useState<InternalControlCase | null>(null);
  const [, rerender] = useState(0);
  const live = useRef(true), selected = useRef<string | null>(null), generation = useRef(0);
  const navigation = useRef<null | (() => Promise<boolean>)>(null);
  const dirty = useRef(false), changing = useRef(false), renewing = useRef(false);
  const publish = (snapshot: ShipTrackingSnapshot) => { const projected = project(snapshot, backend!.actorKey); setView(projected); return projected.data; };
  const load = async (vesselId: string | null) => {
    if (!backend) return null;
    const token = ++generation.current; selected.current = vesselId;
    try {
      if (vesselId) backend.rememberVessel(vesselId);
      const result = await backend.load(vesselId);
      if (!live.current || token !== generation.current) return null;
      return publish(result);
    } catch (e) { if (live.current && token === generation.current) setNotice(shipTrackingMessage(e)); return null; }
  };
  const refresh = async () => { if (refreshing || changing.current) return; setRefreshing(true); const result = await load(selected.current); if (result) setNotice('已讀回所選船的最新雲端資料；未改動本機草稿。'); setRefreshing(false); };
  useEffect(() => {
    live.current = true; if (backend) void load(null);
    const heartbeat = setInterval(() => {
      if (!backend || renewing.current) return;
      renewing.current = true;
      void backend.renew().catch(e => { if (live.current) setNotice(shipTrackingMessage(e)); }).finally(() => { renewing.current = false; if (live.current) rerender(n => n + 1); });
    }, 15000);
    const refreshTimer = setInterval(() => { if (backend && selected.current && !dirty.current && !changing.current && !caseView) void load(selected.current); }, 30000);
    return () => { live.current = false; generation.current++; clearInterval(heartbeat); clearInterval(refreshTimer); };
  }, [backend]);
  const callbacks: TrackingUiCallbacks = {
    onPrivateDraftChange: (_token, value) => { dirty.current = value; },
    load: id => load(id),
    claim: async (id, ids, creation=false) => {
      if (!backend) return null;
      changing.current = true; const token = generation.current;
      try { const snapshot = await backend.claim(id, ids, creation); if (!live.current || token !== generation.current || selected.current !== id) { await backend.release(); return null; } setNotice('已取得完整編輯權；保存確認或關閉後釋放。'); return publish(snapshot); }
      catch (e) { setNotice(shipTrackingMessage(e)); return null; }
      finally { changing.current = false; }
    },
    isWritable: ids => Boolean(backend?.isWritable(ids)),
    submit: async submission => {
      if (!backend || changing.current) return false;
      changing.current = true; const token = generation.current;
      try {
        const result = await backend.submit(submission);
        if (!live.current || token !== generation.current) return false;
        if (result.kind !== 'committed') { setNotice(result.message); return false; }
        publish(result.snapshot); setNotice('已收到伺服器確認並讀回；船岸使用同一份資料。'); return true;
      } finally { changing.current = false; }
    },
    release: async () => { try { const result = await backend?.release(); rerender(n => n + 1); return result === true; } catch (e) { setNotice(shipTrackingMessage(e)); return false; } },
    discardRejected: async () => { try { return await backend?.discardRejected() === true; } catch (e) { setNotice(shipTrackingMessage(e)); return false; } },
    registerNavigationGuard: guard => { navigation.current = guard; },
    openCase: id => { void (async () => { if (navigation.current && !await navigation.current()) return; if (!selected.current) return; const data = await load(selected.current); const item = data?.internalControlCases.find(c => c.id === id); if (item) setCaseView(item); else setNotice('此內控目前不在所選船的有效跟蹤關聯中，未開啟。'); })(); },
    captureExport: async id => { if (!backend || changing.current || dirty.current) return null; const token = generation.current; try { const snapshot = await backend.load(id); return { items: snapshot.trackingItems, isCurrent: () => live.current && token === generation.current && selected.current === id && !changing.current && !dirty.current }; } catch (e) { setNotice(shipTrackingMessage(e)); return null; } },
  };
  return <main className="ship-portal-shell ship-tracking-portal">
    <header className="ship-portal-header"><div><h1>船端配件／物料／工程跟蹤</h1><p>免登入選船｜船岸共用資料｜只有雲端確認並讀回才算保存。選船不代表驗證身份。</p></div><button className="btn small" disabled={!backend || refreshing || changing.current} onClick={() => void refresh()}>{refreshing ? '讀取中…' : '讀取最新資料'}</button></header>
    {notice && <p className="ship-notice" role="status">{notice}</p>}
    {view && backend ? <TrackingPage data={view.data} vessels={view.data.vessels} user={view.user} workspace={backend.namespace} identity={backend.identity} canCreate canEdit canClose canExport audience="ship" callbacks={callbacks}/> : !notice && <p role="status">正在讀取啟用船舶…</p>}
    {caseView && <div className="modal-backdrop"><section className="modal ship-tracking-case" role="dialog" aria-modal="true" aria-label="已同步內控內容"><div className="modal-head"><h2>已同步內控內容</h2><button className="btn ghost" onClick={() => setCaseView(null)}>關閉內控內容</button></div><p>{vesselSelectionDisplayName(view?.data.vessels.find(v => v.id === caseView.vesselId))}｜{caseView.reportDate}｜{caseView.reportSource}</p><p>{caseView.priority}｜{caseView.category}｜{caseView.departments.join('、')}｜{caseView.isClosed ? `已結案 ${caseView.closedDate}` : '未結案'}</p><h3>事項內容</h3><p className="ship-tracking-text">{caseView.description}</p><h3>最新狀態</h3><p className="ship-tracking-text">{caseView.status}</p><p>期望完成日期/DL：{caseView.expectedDate || '未填'}</p><details><summary>更新記錄</summary>{caseView.statusLogs.map(log => <p key={log.id}>{formatTaipeiDateTime(log.at)}｜{log.by}<br/>{log.text}</p>)}</details><p>此處唯讀；回到跟蹤清單更新進度、結案或重開，雲端核對有效關聯後同步。</p></section></div>}
  </main>;
}
