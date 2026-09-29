import type { ReactNode } from 'react';
import fpmcLogo from './assets/fpmc-logo.png';

export default function ShipPortalBrand({ children }: { children: ReactNode }) {
  return <div className="ship-portal-brand">
    <img className="ship-portal-logo" src={fpmcLogo} alt="FPMC LOGO" width={241} height={197} />
    <div className="ship-portal-brand-copy">{children}</div>
  </div>;
}
