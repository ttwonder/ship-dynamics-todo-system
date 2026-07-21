import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const types = read('../src/types.ts');
const meetings = read('../src/TemporaryMeetings.tsx');

assert.ok(types.includes("MeetingVesselScopeMode = 'all' | 'types' | 'vessels'"), '需定義全部／船型／逐船的會議範圍模式');
assert.ok(types.includes('vesselScopeMode?: MeetingVesselScopeMode'), '會議需持久化範圍模式並向後相容');
assert.ok(types.includes('vesselTypeScopes?: string[]'), '會議需持久化一個或多個船舶類型');
assert.ok(meetings.includes('全部船舶') && meetings.includes('按船舶類型') && meetings.includes('逐船選擇'), '新增／編輯頁需提供三種會議範圍');
assert.ok(meetings.includes('toggleVesselType') && meetings.includes('vesselTypeScopes'), '船舶類型必須支援多選');
assert.ok(meetings.includes('resolvedVesselIds'), '保存時需解析並保存實際涉會船舶 ID');
assert.ok(!meetings.includes("if (!resolvedVesselIds.length) return alert('請至少選擇一艘船舶')"), '臨會/專題需允許不選船舶就保存');
assert.ok(!meetings.includes('涉會船舶範圍 <span className="required-mark">*</span>'), '涉會船舶範圍不得標示為必填');
assert.ok(meetings.includes('未指定船舶類型；可直接保存為未指定船舶範圍'), '船型未選時需提示可保存未指定船舶範圍');
assert.ok(meetings.includes('船舶類型篩選') && meetings.includes('typeFilter'), '後續基本資訊清單需可按船型快速篩選');
assert.match(meetings, /scopeModeOf\([^)]*\)\s*===\s*'all'/, '船型清單篩選需納入全部船舶會議');
assert.ok(meetings.includes('meetingScopeLabel'), '清單需顯示全部船舶／船型／逐船範圍標籤');
assert.ok(!meetings.includes('<select multiple'), '船型多選不得使用會造成白頁的原生 multiple select');
console.log('Meeting vessel-scope contracts passed.');
