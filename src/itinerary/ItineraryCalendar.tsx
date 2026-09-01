import { useMemo, useState } from 'react';
import { buildItineraryCalendarEntries, calendarRangeFromLocalDate } from './itineraryCalendarModel';
import { instantToWallTime } from './itineraryTime';
import type { ItineraryDocument } from './itineraryTypes';
import UtcOffsetSelect from './UtcOffsetSelect';

interface ItineraryCalendarProps { documents: ItineraryDocument[] }

function todayInZone(zone: string): string {
  const local = instantToWallTime(new Date().toISOString(), zone);
  return local.ok ? local.date : new Date().toISOString().slice(0, 10);
}

export default function ItineraryCalendar({ documents }: ItineraryCalendarProps) {
  const [timeZone, setTimeZone] = useState('UTC+8');
  const [startDate, setStartDate] = useState(() => todayInZone('UTC+8'));
  const [days, setDays] = useState(14);
  const [dayWidth, setDayWidth] = useState(72);
  const [fields, setFields] = useState({ voyage: true, port: true, operation: true, times: false });
  const range = useMemo(() => calendarRangeFromLocalDate(startDate, days, timeZone), [startDate, days, timeZone]);
  const entries = useMemo(() => range.ok ? buildItineraryCalendarEntries(documents, range.startInstant, range.endInstant) : [], [documents, range]);
  const labels = range.ok ? range.dayStarts.slice(0, -1).map(instant => {
    const local = instantToWallTime(instant, timeZone);
    return local.ok ? local.date.slice(5) : '—';
  }) : [];
  const toggle = (field: keyof typeof fields) => setFields(previous => ({ ...previous, [field]: !previous[field] }));
  const trackWidth = days * dayWidth;

  if (!documents.length) return <div className="itinerary-empty"><b>先選取船舶</b><span>行事曆只顯示 Itinerary 選取狀態，不使用船舶卡片的批量選取。</span></div>;
  return <div className="itinerary-calendar">
    <div className="itinerary-calendar-controls no-print">
      <label>開始<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
      <label>期間<select value={days} onChange={event => setDays(Number(event.target.value))}><option value={7}>7 天</option><option value={14}>14 天</option><option value={30}>30 天</option></select></label>
      <label>日欄寬<input type="range" min="48" max="150" step="6" value={dayWidth} onChange={event => setDayWidth(Number(event.target.value))} /><span>{dayWidth}px</span></label>
      <label>顯示時區<UtcOffsetSelect value={timeZone} onChange={setTimeZone} /></label>
      <div className="itinerary-calendar-fields">內容：{(Object.keys(fields) as Array<keyof typeof fields>).map(field => <label key={field}><input type="checkbox" checked={fields[field]} onChange={() => toggle(field)} />{{ voyage: '航次', port: '港口', operation: '裝卸', times: 'ETA–ETD' }[field]}</label>)}</div>
    </div>
    {!range.ok ? <div className="itinerary-notice">日期、期間或 UTC Offset 無效，已停止繪製。</div> : <div className="itinerary-calendar-scroll">
      <div className="itinerary-calendar-grid" style={{ width: 164 + trackWidth }}>
        <div className="itinerary-calendar-axis"><div className="itinerary-calendar-vessel-label">船舶／港序</div><div className="itinerary-calendar-day-track" style={{ width: trackWidth }}>{labels.map(label => <span style={{ width: dayWidth }} key={label}>{label}</span>)}</div></div>
        {entries.map((entry) => {
          const content = [fields.voyage && entry.row.voyageNumber, fields.port && entry.row.portDockName, fields.operation && entry.row.operation].filter(Boolean).join('｜') || 'Itinerary';
          const localTime = (instant: string | null) => {
            if (!instant) return '—';
            const value = instantToWallTime(instant, timeZone);
            return value.ok ? `${value.date.slice(5)} ${value.time}` : '—';
          };
          const timeText = fields.times ? `${localTime(entry.row.etaUtc)} → ${localTime(entry.row.etdUtc)}` : '';
          return <div className="itinerary-calendar-row" key={`${entry.vesselId}-${entry.row.rowId}`}>
            <div className="itinerary-calendar-vessel-label"><b>{entry.vesselName}</b><span>#{entry.row.sortOrder + 1}</span></div>
            <div className="itinerary-calendar-track" style={{ width: trackWidth, backgroundSize: `${dayWidth}px 100%` }}>
              <div className={`itinerary-calendar-event ${entry.row.operation === 'Unloading' ? 'unloading' : 'loading'}`} style={{ left: `${entry.leftPercent}%`, width: `${entry.widthPercent}%` }} title={`${entry.vesselName} ${content}`}><b>{content}</b>{timeText && <span>{timeText}</span>}</div>
            </div>
          </div>;
        })}
        {!entries.length && <div className="itinerary-calendar-no-events">此期間沒有可顯示的 ETA–ETD。</div>}
      </div>
    </div>}
  </div>;
}
