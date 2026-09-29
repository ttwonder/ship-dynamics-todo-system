export function morningReportPdfDocumentTitle(reportDate: string): string {
  const safeDate = reportDate.trim().replace(/[\\/]/g, '-') || '未設定日期';
  return `船舶早會動態暨待辦報告_${safeDate}`;
}

export function morningReportReadError(error: unknown): string {
  const message=error&&typeof error==='object'&&'message' in error?String(error.message):String(error);
  return /statement timeout/i.test(message)
    ? '讀取最新早會資料逾時；本次未建立 PDF，也未使用舊資料。請稍後重試；若持續發生，請回報此訊息：'+message
    : '準備 PDF 時無法確認最新資料；本次未建立報告。'+message;
}

export function printMorningReportPdf(reportDate: string, canPrint:()=>boolean=()=>true): void {
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
      if(!canPrint()){cleanup();return;}
      window.print();
    } catch {
      cleanup();
    }
  }, 80);
}
