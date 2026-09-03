import { firstItineraryRow, type ItineraryDocument } from './itineraryTypes';

export function currentTimeZoneFromItinerary(document: ItineraryDocument): string | null {
  return firstItineraryRow(document)?.calculationStartTimeZone.trim() || null;
}

export function previousPortNameFromItinerary(document: ItineraryDocument): string | null {
  return firstItineraryRow(document)?.previousPortName?.trim() || null;
}

export default function ItineraryVesselMetadata({ document }: { document: ItineraryDocument }) {
  return <span className="itinerary-vessel-metadata">
    <span className="itinerary-current-time-zone">現在所處時區：<b>{currentTimeZoneFromItinerary(document) || '未設定'}</b></span>
    <span className="itinerary-previous-port">上一港名稱：<b>{previousPortNameFromItinerary(document) || '未設定'}</b></span>
  </span>;
}
