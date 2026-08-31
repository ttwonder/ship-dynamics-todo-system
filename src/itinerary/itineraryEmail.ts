export interface ItineraryMailtoInput {
  vesselName: string;
  fileName: string;
  revision: number;
}

export function buildItineraryMailto({ vesselName, fileName, revision }: ItineraryMailtoInput): string {
  const subject = `${vesselName} Itinerary - Revision ${revision}`;
  const body = [
    `Dear all,`,
    '',
    `Please find the latest ${vesselName} Itinerary (Revision ${revision}).`,
    '',
    `Excel file downloaded by the system: ${fileName}`,
    `Please attach this downloaded file before sending.`,
    '',
    `Best regards,`,
  ].join('\r\n');
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
