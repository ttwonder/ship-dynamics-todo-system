export function printItineraryDailyReportPdf(businessDate: string): void {
  const previousTitle = document.title;
  document.title = `每日正式 Itinerary_${businessDate}`;
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
