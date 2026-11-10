import {vesselSelectionDisplayName, type VesselNameSource} from '../vesselDisplay';
import {formatRiskTime,riskLabels,riskSortedRows,riskSummary,type FleetRiskSnapshot} from './model';

export function displayRiskName(name:string,vessels:VesselNameSource[]):string {
  // Names enrich display only. Risk identity always comes from official IMO.
  const matches=vessels.filter(v=>(v.fullName||'').trim().toUpperCase()===name.toUpperCase());
  return matches.length===1?vesselSelectionDisplayName(matches[0]):name;
}
export default function FleetRiskReport({snapshot,vessels}:{snapshot:FleetRiskSnapshot;vessels:VesselNameSource[]}){
  const counts=riskSummary(snapshot);
  return <article className="fr-report" data-snapshot-id={snapshot.id}>
    <h1>台塑海運船隊風險清單</h1>
    <p>FORMOSA PLASTICS MARINE CORPORATION｜公司 IMO 0882415｜船舶 {snapshot.count} 艘</p>
    <p>{snapshot.trigger==='scheduled'?'每日定期更新':'手動強制更新'}｜完成：{formatRiskTime(snapshot.queryCompletedAt)}（台北）</p>
    <p>本次取得區間：{formatRiskTime(snapshot.queryStartedAt)} ～ {formatRiskTime(snapshot.queryCompletedAt)}（台北）</p>
    <div className="fr-summary" aria-label="Tokyo MOU 風險統計">{(['HRS','SRS','LRS'] as const).map(risk=><span key={risk} className={`fr-badge fr-${risk}`}>{riskLabels[risk]}：{counts[risk]} 艘</span>)}</div>
    <div className="fr-table-wrap"><table className="fr-table">
      <colgroup><col style={{width:'23%'}}/><col style={{width:'18%'}}/><col style={{width:'20%'}}/><col style={{width:'12%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/></colgroup>
      <thead><tr><th>船名／IMO</th><th>Tokyo MOU<br/>目前風險</th><th>檢查優先級／窗口</th><th>Paris MoU</th><th>USCG</th><th>本次取得<br/>台北時間</th></tr></thead>
      <tbody>{riskSortedRows(snapshot).map(row=><tr key={row.imo} data-imo={row.imo} className={row.risk==='HRS'?'fr-high-row':''}>
        <td><span className="fr-name">{displayRiskName(row.name,vessels)}</span><small>IMO {row.imo}</small>{row.companyImo!=='0882415'&&<small>委外管理：{row.companyName}<br/>公司 IMO {row.companyImo}</small>}</td>
        <td><span className={`fr-badge fr-${row.risk}`}>{riskLabels[row.risk]}</span></td>
        <td>{row.priority==='No Priority'?'無優先級':row.priority}{row.windowFrom&&row.windowTo&&<small>{row.windowFrom}<br/>～ {row.windowTo}</small>}</td>
        <td><span className="fr-unknown">— 未取得<br/>現時等級</span></td>
        <td><span className="fr-unknown">— 未取得<br/>現時等級</span></td>
        <td>{formatRiskTime(row.retrievedAt)}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="fr-notes">
      <p><strong>來源與範圍：</strong><a href="https://apcis.tmou.org/public/" target="_blank" rel="noreferrer">Tokyo MOU APCIS</a> 單船詳細頁的目前風險；不是上次檢查時的等級。名冊按公司資料及 FPMC 船名結果核對，包含委外管理船。</p>
      <p>官網未提供整批資料的更新／生效時間；以上是本系統取得時間。檢查優先級與船舶風險為不同欄位，不相互換算。</p>
      <p><a href="https://parismou.org/inspection-search" target="_blank" rel="noreferrer">Paris MoU</a>／<a href="https://cgmix.uscg.mil/psix/" target="_blank" rel="noreferrer">USCG</a> 公開檢查紀錄未能確認各船現時等級；「未取得」不代表低風險，也不以歷史檢查或 QUALSHIP21 資格推算。</p>
      {snapshot.coverage.addedReferenceImos.length>0&&<p>官網較參考名冊新增 IMO：{snapshot.coverage.addedReferenceImos.join('、')}，已納入本次查詢。</p>}
      <p>本清單僅供查核參考；實際檢查安排以主管機關為準。對外轉載／使用須遵守各來源條款。</p>
    </div>
  </article>;
}
