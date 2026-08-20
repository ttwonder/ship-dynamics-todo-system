export function morningReportPdfDocumentTitle(reportDate: string): string {
  const safeDate = reportDate.trim().replace(/[\\/]/g, '-') || '未設定日期';
  return `船舶早會動態暨待辦報告_${safeDate}`;
}

export function printMorningReportPdf(reportDate: string): void {
  const originalTitle = document.title;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = originalTitle;
    document.body.classList.remove('printing-report');
    window.removeEventListener('afterprint', cleanup);
  };
  document.title = morningReportPdfDocumentTitle(reportDate);
  document.body.classList.add('printing-report');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.setTimeout(() => {
    try {
      window.print();
    } catch {
      cleanup();
    }
  }, 80);
}
