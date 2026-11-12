import {fleetRiskCardDescription} from './cardRisk';
import type {FleetRiskRow} from './model';
import './fleetRisk.css';

export default function VesselRiskBadge({row,snapshotId,notice='',onClick}:{row?:FleetRiskRow;snapshotId?:string;notice?:string;onClick?:()=>void}) {
  const description=fleetRiskCardDescription(row,notice,Boolean(onClick));
  const props={className:`fleet-risk-code-badge fr-${row?.risk||'unknown'}`,'data-risk':row?.risk||'unknown','data-imo':row?.imo,'data-snapshot-id':snapshotId,title:description,'aria-label':description};
  return <span className="fleet-risk-code">{onClick?<button type="button" {...props} onClick={onClick}>{row?.risk||'—'}</button>:<span {...props}>{row?.risk||'—'}</span>}{notice&&<small className="fleet-risk-card-notice">{notice}</small>}</span>;
}
