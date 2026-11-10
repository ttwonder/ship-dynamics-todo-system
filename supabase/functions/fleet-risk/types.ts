export interface ShipIdentity {
  name: string;
  imo: string;
}
export interface RosterShip extends ShipIdentity {
  huid: string;
}
export type Risk = "HRS" | "SRS" | "LRS";
export type Priority = "Priority I" | "Priority II" | "No Priority";
export interface ShipRisk {
  risk: Risk;
  priority: Priority;
  companyName: string;
  companyImo: string;
  windowFrom: string | null;
  windowTo: string | null;
  sourceUpdatedAt: null;
}
export interface DetailRow extends ShipIdentity {
  retrievedAt: string;
  status: "ok" | "error";
  risk: Risk | null;
  priority: Priority | null;
  companyName: string | null;
  companyImo: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  sourceUpdatedAt: null;
  errorCode?: string;
  sourceUrl: "https://apcis.tmou.org/public/";
}
export interface Company {
  name: string;
  imo: "0882415";
  performance: string;
}
export interface Coverage {
  referenceCount: number;
  missingReferenceImos: string[];
  addedReferenceImos: string[];
}
export type FleetRiskRequest =
  | { action: "roster"; queryId: string }
  | { action: "details"; queryId: string; ships: RosterShip[] };
export type FleetRiskResponse =
  | {
    ok: true;
    action: "roster";
    queryId: string;
    queryStartedAt: string;
    rosterRetrievedAt: string;
    declaredTotal: number;
    company: Company;
    ships: RosterShip[];
    coverage: Coverage;
  }
  | { ok: true; action: "details"; queryId: string; rows: DetailRow[]; completedAt: string }
  | { ok: false; error: string };
