import {lazy, Suspense, useState} from 'react';
import type {VesselNameSource} from '../vesselDisplay';
import './fleetRisk.css';

const FleetRiskModal = lazy(() => import('./FleetRiskModal'));

export default function FleetRiskEntry({vessels}:{vessels:VesselNameSource[]}) {
  const [open,setOpen] = useState(false);
  return <>
    <button type="button" className="btn fleet-risk-trigger" aria-label="船隊風險清單" onClick={()=>setOpen(true)}>船隊風險清單</button>
    {open && <Suspense fallback={<span role="status">開啟風險清單…</span>}><FleetRiskModal vessels={vessels} close={()=>setOpen(false)}/></Suspense>}
  </>;
}
