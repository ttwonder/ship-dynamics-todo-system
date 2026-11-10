import {lazy, Suspense} from 'react';
import type {FleetRiskController} from './useFleetRisk';
import type {VesselNameSource} from '../vesselDisplay';
import './fleetRisk.css';

const FleetRiskModal = lazy(() => import('./FleetRiskModal'));

export default function FleetRiskEntry({vessels,risk,open,onOpen,close}:{vessels:VesselNameSource[];risk:FleetRiskController;open:boolean;onOpen:()=>void;close:()=>void}) {
  return <>
    <button type="button" className="btn fleet-risk-trigger" aria-label="船隊風險清單" onClick={onOpen}>船隊風險清單</button>
    {open && <Suspense fallback={<span role="status">開啟風險清單…</span>}><FleetRiskModal vessels={vessels} risk={risk} close={close}/></Suspense>}
  </>;
}
