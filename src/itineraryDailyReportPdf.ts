type ItineraryDailyReportGeneration = 'scheduled' | 'manual';

function taipeiTimeToken(generatedAt: string): string {
  const instant = new Date(generatedAt);
  if (Number.isNaN(instant.getTime())) return 'time-unknown';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Taipei', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '00';
  return `${part('hour')}${part('minute')}${part('second')}`;
}

export function itineraryDailyReportPdfTitle(
  businessDate: string,
  generatedAt: string,
  generatedBy: ItineraryDailyReportGeneration,
  reportId: string,
): string {
  const source = generatedBy === 'manual' ? '手動' : '自動';
  return `每日正式 Itinerary_${businessDate}_${taipeiTimeToken(generatedAt)}_${source}_R${reportId}`;
}

export function printItineraryDailyReportPdf(
  businessDate: string,
  generatedAt: string,
  generatedBy: ItineraryDailyReportGeneration,
  reportId: string,
): void {
  const previousTitle = document.title;
  document.title = itineraryDailyReportPdfTitle(businessDate, generatedAt, generatedBy, reportId);
  document.body.classList.add('printing-itinerary-daily-report');
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('printing-itinerary-daily-report');
    document.title = previousTitle;
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(() => {
    window.print();
    window.setTimeout(cleanup, 2_000);
  }, 80);
}
