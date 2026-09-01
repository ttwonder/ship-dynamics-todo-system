export const ITINERARY_MAIN_FIELD_LABELS = [
  'Voy No.',
  'Next Port & Dock Name',
  'UTC Offset',
  'Purpose',
  'B/F or I/F Qty (MT/BBLS)',
  'ETA (LT)',
  'ETB (LT)',
  '預計L/D rate (MT/h)',
  'ETC (LT)',
  'ETD (LT)',
  'Arr Draft',
  'Dep Draft',
  'Arr ROB\n(Cargo/Fuel/FW)',
  'Dep ROB\n(Cargo/Fuel/FW)',
  '備註信息',
] as const;

export const ITINERARY_PARAMETER_FIELD_LABELS = [
  'DTG(NM)',
  '預估航速(kn)',
  '剩餘航行時間(h)',
  '預估等待時間(靠泊前)(h)',
  '預計航道航行時間(h)',
  '作業艙號',
  '裝卸貨量(MT)',
  '預計L/D rate (MT/h)',
  '預計作業時間(h)',
  '預估等待/延誤時間(完貨前)(h)',
  '預估等待/延誤時間(完貨後)(h)',
] as const;

export const ITINERARY_EDITOR_ROW_NUMBER_WIDTH = 34;
export const ITINERARY_EDITOR_ACTION_WIDTH = 36;

export const ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS = [
  70, 175, 96, 155, 155, 246, 246, 80, 246, 246, 98, 98, 147, 147, 175,
] as const;

export const ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS = [
  82, 82, 82, 82, 82, 135, 100, 82, 82, 82, 82,
] as const;

export const ITINERARY_EDITOR_MAIN_TABLE_WIDTH = ITINERARY_EDITOR_ROW_NUMBER_WIDTH
  + ITINERARY_EDITOR_ACTION_WIDTH
  + ITINERARY_EDITOR_MAIN_COLUMN_WIDTHS.reduce((total, width) => total + width, 0);

export const ITINERARY_EDITOR_PARAMETER_TABLE_WIDTH = ITINERARY_EDITOR_ROW_NUMBER_WIDTH
  + ITINERARY_EDITOR_PARAMETER_COLUMN_WIDTHS.reduce((total, width) => total + width, 0);

export const ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS = [
  74, 170, 92, 150, 175, 142, 142, 105, 142, 142, 105, 105, 145, 145, 170,
] as const;

export const ITINERARY_BROWSE_PARAMETER_COLUMN_WIDTHS = [
  100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
] as const;

export const ITINERARY_BROWSE_MAIN_TABLE_WIDTH = ITINERARY_BROWSE_MAIN_COLUMN_WIDTHS
  .reduce((total, width) => total + width, 0);

export const ITINERARY_BROWSE_EXPANDED_TABLE_WIDTH = ITINERARY_BROWSE_MAIN_TABLE_WIDTH
  + ITINERARY_BROWSE_PARAMETER_COLUMN_WIDTHS.reduce((total, width) => total + width, 0);
