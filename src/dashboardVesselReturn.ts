export const dashboardVesselCardId = (vesselId: string) => `dashboard-vessel-card-${vesselId}`;

type DashboardVesselDocument = Pick<Document, 'getElementById'>;

export function scrollToDashboardVesselCard(
  vesselId: string,
  documentRoot: DashboardVesselDocument = document,
): boolean {
  const card = documentRoot.getElementById(dashboardVesselCardId(vesselId));
  if (!card) return false;
  card.scrollIntoView({ behavior: 'auto', block: 'start', inline: 'nearest' });
  return true;
}
