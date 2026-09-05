import React, { useEffect, useRef, useState } from 'react';
import { getSupabaseConfig } from './cloud';
import { formatTaipeiDateTime } from './taipeiTime';
import {
  clearPendingManualItineraryReportSave,
  createPendingManualItineraryReportSave,
  itineraryDailyReportErrorMessage,
  ItineraryDailyReportRpcError,
  readPendingManualItineraryReportSave,
  saveManualItineraryDailyReport,
  writePendingManualItineraryReportSave,
  type PendingManualItineraryReportSave,
} from './itineraryDailyReports';

export default function ManualItineraryReportSaveButton({ actorUserId, onSaved }: {
  actorUserId: string;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<PendingManualItineraryReportSave | null>(null);
  const actorRef = useRef(actorUserId);
  actorRef.current = actorUserId;

  useEffect(() => {
    const config = getSupabaseConfig();
    setPending(config ? readPendingManualItineraryReportSave(config, actorUserId) : null);
    setSaving(false);
  }, [actorUserId]);

  const submit = async () => {
    if (saving) return;
    const config = getSupabaseConfig();
    if (!config) {
      window.alert('尚未配置 Supabase，無法手動保存目前 Itinerary。');
      return;
    }
    const actorAtSubmit = actorUserId;
    let envelope = pending || readPendingManualItineraryReportSave(config, actorAtSubmit);
    if (!envelope) {
      envelope = createPendingManualItineraryReportSave({
        operationId:crypto.randomUUID(),
        actorUserId:actorAtSubmit,
      }, config);
      try {
        writePendingManualItineraryReportSave(envelope, config);
      } catch {
        window.alert('無法保存本次操作的對帳資料，因此尚未送出。請確認瀏覽器儲存空間後重試。');
        return;
      }
      setPending(envelope);
    }

    setSaving(true);
    try {
      const result = await saveManualItineraryDailyReport(envelope, config);
      clearPendingManualItineraryReportSave(config, actorAtSubmit);
      if (actorRef.current === actorAtSubmit) {
        setPending(null);
        onSaved();
        window.alert(`${result.created ? '目前正式 Itinerary 已新增一份手動快照' : '上次手動保存已完成對帳'}。\n保存時間：${formatTaipeiDateTime(result.report.generatedAt)}\n${result.report.vesselCount} 艘｜${result.report.rowCount} 列`);
      }
    } catch (error) {
      const definitive = error instanceof ItineraryDailyReportRpcError && error.definitive;
      if (definitive) clearPendingManualItineraryReportSave(config, actorAtSubmit);
      if (actorRef.current === actorAtSubmit) {
        if (definitive) setPending(null);
        else setPending(envelope);
        const suffix = definitive ? '' : '\n結果尚未確認；請按同一按鈕對帳，不會重複新增。';
        window.alert(`${itineraryDailyReportErrorMessage(error)}${suffix}`);
      }
    } finally {
      if (actorRef.current === actorAtSubmit) setSaving(false);
    }
  };

  return <button
    className="btn green"
    disabled={saving}
    title="只保存雲端已正式提交的主 Itinerary；不包含未保存草稿或備選方案"
    onClick={() => void submit()}
  >{saving ? '雲端確認中…' : pending ? '對帳上次 Itinerary 保存' : '手動保存目前 Itinerary'}</button>;
}
