import assert from 'node:assert/strict';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const server = await createServer({ root: process.cwd(), server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const cases = [];
const test = (name, run) => { try { run(); cases.push({ name, ok: true }); } catch (error) { cases.push({ name, ok: false, error: error.message.slice(0,280) }); } };
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const model = await server.ssrLoadModule('/src/itinerary/shipItineraryModel.ts');
  const domain = await server.ssrLoadModule('/src/itinerary/itineraryDomain.ts');
  const validation = await server.ssrLoadModule('/src/itinerary/itineraryValidation.ts');
  const projection = await server.ssrLoadModule('/src/itinerary/itineraryOperationalProjection.ts');
  const document = types.createEmptyItineraryDocument({ workspaceKey:'qa', vesselId:'v1', vesselName:'V1', rowId:'r1' });
  const state = { location:'Taiwan Strait', navigationStatus:'停泊', loadStatus:'滿載', statusList:['loading','drydock/repiar'] };
  document.rows[0].currentVesselState = structuredClone(state);
  document.rows[0].previousPortName = 'BUSAN';
  document.rows.push(types.createBlankItineraryRow('r2',1));
  const vessel = { id:'v1', name:'V1', position:{location:'OLD',navigationStatus:'航行'}, cargo:{loadStatus:'空載'}, note:{statusList:['waiting order']} };
  const values = d => projection.projectItineraryOperationalDocument(d,'2026-09-01T00:00:00Z');
  test('confirmed formal four-field projection', () => {
    const actual = projection.applyItineraryOperationalProjection(vessel,values(document));
    assert.equal(actual.position.location,state.location); assert.equal(actual.position.navigationStatus,state.navigationStatus);
    assert.equal(actual.cargo.loadStatus,state.loadStatus); assert.deepEqual(actual.note.statusList,state.statusList);
    actual.note.statusList.push('to load'); assert.deepEqual(document.rows[0].currentVesselState,state);
  });
  test('missing keys preserve legacy; explicit empty values clear', () => {
    const d=structuredClone(document); d.rows[0].currentVesselState={location:'',statusList:[]};
    const actual=projection.applyItineraryOperationalProjection(vessel,values(d));
    assert.equal(actual.position.location,''); assert.deepEqual(actual.note.statusList,[]);
    assert.equal(actual.position.navigationStatus,'航行'); assert.equal(actual.cargo.loadStatus,'空載');
    delete d.rows[0].currentVesselState;
    const legacy=projection.applyItineraryOperationalProjection(vessel,values(d));
    assert.equal(legacy.position.location,'OLD'); assert.deepEqual(legacy.note.statusList,['waiting order']);
    assert.equal(validation.validateItineraryDocument(d).value.rows[0].currentVesselState,undefined);
  });
  test('frozen snapshot owns a copy of confirmed state', () => {
    const d=structuredClone(document);
    const snapshot=projection.buildItineraryProjectionSnapshot([vessel],{v1:{status:'ready',document:d}},'2026-09-01T00:00:00Z');
    d.rows[0].currentVesselState.location='LATER';
    assert.equal(projection.applyItineraryProjectionSnapshot([vessel],snapshot.itineraryProjections)[0].position.location,state.location);
  });
  test('valid enums including stored alias and partial metadata', () => {
    assert.equal(validation.validateItineraryDocument(document).ok,true);
    const d=structuredClone(document); d.rows[0].currentVesselState={}; assert.equal(validation.validateItineraryDocument(d).ok,true);
  });
  for (const bad of [null,[],{location:7},{location:'x'.repeat(241)},{navigationStatus:''},{navigationStatus:'bad'},{loadStatus:'bad'},{statusList:'loading'},{statusList:['drydock/repair']},{statusList:['loading','loading']},{unknown:'x'}]) {
    test(`reject invalid current state ${JSON.stringify(bad).slice(0,65)}`, () => {
      const d=structuredClone(document);d.rows[0].currentVesselState=bad;assert.equal(validation.validateItineraryDocument(d).ok,false);
    });
  }
  test('metadata rejected outside formal first row', () => {
    const d=structuredClone(document); d.rows[1].currentVesselState={}; assert.equal(validation.validateItineraryDocument(d).ok,false);
    delete d.rows[1].currentVesselState;
    const alt=model.addShipAlternativePlan(d,'alt','a1'); alt.alternativePlans[0].rows[0].currentVesselState={};
    assert.equal(validation.validateItineraryDocument(alt).ok,false);
  });
  test('delete first row transfers metadata', () => assert.deepEqual(model.removeShipDraftRow(document,'r1').rows[0].currentVesselState,state));
  test('reorder and recalculate retain metadata on first row only', () => {
    const rows=domain.recalculateItineraryRows([...document.rows].reverse()).rows;
    assert.deepEqual(rows[0].currentVesselState,state); assert.equal(Object.hasOwn(rows[1],'currentVesselState'),false);
  });
  test('replacement/import cannot override or lose existing metadata', () => {
    const rows=[types.createBlankItineraryRow('import',0)]; rows[0].currentVesselState={location:'FORGED'};
    assert.deepEqual(model.replaceShipDraftRows(document,rows).rows[0].currentVesselState,state);
  });
  test('blank/new voyage retains vessel state without adding legacy defaults', () => {
    assert.deepEqual(model.createShipDraft(document,'blank').rows[0].currentVesselState,state);
    const d=structuredClone(document);delete d.rows[0].currentVesselState;
    assert.equal(Object.hasOwn(model.createShipDraft(d,'blank').rows[0],'currentVesselState'),false);
  });
  test('alternative promotion retains formal metadata; alternative patch cannot own it', () => {
    const d=model.addShipAlternativePlan(document,'alt','a1');
    const edited=model.updateShipAlternativePlanRow(d,'alt','a1',{currentVesselState:{location:'FORGED'}});
    assert.equal(Object.hasOwn(edited.alternativePlans[0].rows[0],'currentVesselState'),false);
    assert.deepEqual(model.promoteShipAlternativePlanToDraft(d,'alt',()=> 'promoted').rows[0].currentVesselState,state);
  });
  test('header-only current state is saveable business content',()=>{const d=types.createEmptyItineraryDocument({workspaceKey:'qa',vesselId:'v1',vesselName:'V1'});d.rows[0].currentVesselState={statusList:[]};assert.equal(model.hasShipDraftBusinessContent(d),true);});
  test('other ship field edits never create defaults or blank metadata', () => {
    assert.deepEqual(model.updateShipDraftRow(document,'r1',{voyageNumber:'NEW'}).rows[0].currentVesselState,state);
    const d=structuredClone(document);delete d.rows[0].currentVesselState;
    assert.equal(Object.hasOwn(model.updateShipDraftRow(d,'r1',{voyageNumber:'NEW'}).rows[0],'currentVesselState'),false);
  });
  const ship = await server.ssrLoadModule('/src/itinerary/ShipItineraryEditor.tsx');
  const quick = await server.ssrLoadModule('/src/EditModals.tsx');
  const batch = await server.ssrLoadModule('/src/BatchManagedVesselModal.tsx');
  const renderShip = (d,readOnly=false) => renderToStaticMarkup(React.createElement(ship.default,{document:d,readOnly,canSave:true,onChange(){}}));
  test('ship header renders exact hints and all choices as optional controls', () => {
    const html=renderShip(document);
    assert.match(html,/非經緯度，而是大致區域位置/);
    assert.match(html,/請選擇實際計算值，如台北，則是UTC\+8/);
    assert.match(html,/<input[^>]*name="currentLocation"[^>]*value="Taiwan Strait"/);
    for(const [label,choices] of [['目前航行狀態',['航行','拋錨','進港中','出港中','停泊','漂航']],['目前載況',['空載','非空載','滿載']]]) {
      const select=html.match(new RegExp('<select[^>]*aria-label="'+label+'"[^>]*>([\\s\\S]*?)</select>'));
      assert.ok(select,label);for(const choice of choices)assert.ok(select[1].includes('>'+choice+'</option>'));
    }
    const status=html.match(/<details[^>]*data-current-vessel-status[^>]*>([\s\S]*?)<\/details>/)?.[1]||'';
    for(const choice of ['loading','unloading','to load','to unload','waiting order','drydock/repair']) assert.ok(status.includes(choice),choice);
    assert.equal((status.match(/type="checkbox"/g)||[]).length,6);
    const d=structuredClone(document);delete d.rows[0].currentVesselState;
    assert.match(renderShip(d),/<option value="" disabled="" selected="">/);
    assert.match(renderShip(d,true),/<input(?=[^>]*name="currentLocation")(?=[^>]*disabled="")[^>]*>/);
  });
  const full={...vessel,shortName:'V1',fullName:'V1',cargo:{...vessel.cargo,items:[]},note:{...vessel.note,captain:'',chiefOfficer:'',chiefEngineer:'',firstEngineer:'',recentDynamics:'',maintenanceOverview:'',statusSupplement:''}};
  for(const [name,component,props] of [
    ['quick',quick.VesselEditModal,{vessel:full,data:{tasks:[],settings:{vesselStatuses:['loading','drydock/repiar']}},currentUser:{},close(){}}],
    ['batch',batch.default,{vessels:[full],lockedVesselIds:['v1'],readOnly:false,saving:false}]
  ])test(name+' renders protected fields read-only with no status edit',()=>{
    const html=renderToStaticMarkup(React.createElement(component,props));
    assert.match(html,/<input[^>]*readonly=""[^>]*value="OLD"/i);
    assert.doesNotMatch(html,/<select[^>]*>[\s\S]*?航行/);
    assert.doesNotMatch(html,/type="checkbox"/);
    assert.match(html,/船端 Itinerary/);
    assert.match(html,/下一港依首列 ETD/);
    if(name==='quick')assert.match(html,/<label>下一港<\/label>[\s\S]*?<small>依首列 ETD 判斷第一／第二列；無第二列為 TBA<\/small>/);
  });
} finally { await server.close(); }
console.log(JSON.stringify({layer:'SSR domain/model/projection',cases},null,2));
if(cases.some(item=>!item.ok))process.exitCode=1;
