import { useState } from 'react';
import { copyItineraryAndOpenMail } from './itineraryEmail';
import type { ItineraryDocument } from './itineraryTypes';

interface ItineraryCopyEmailButtonProps {
  document: ItineraryDocument;
  onNotice: (message: string) => void;
}

export default function ItineraryCopyEmailButton({ document, onNotice }: ItineraryCopyEmailButtonProps) {
  const [copying, setCopying] = useState(false);

  const copyAndOpenMail = async () => {
    if (copying) return;
    setCopying(true);
    try {
      await copyItineraryAndOpenMail(document, { onCopied: onNotice });
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '無法複製 Itinerary 表格。');
    } finally {
      setCopying(false);
    }
  };

  return <button
    type="button"
    className="btn ghost small itinerary-copy-email-button"
    title="複製 Voy No. 至 Dep ROB 表格，並請系統開啟郵件客戶端"
    disabled={copying}
    onClick={() => void copyAndOpenMail()}
  >{copying ? '複製中…' : '一鍵複製並發送郵件'}</button>;
}
