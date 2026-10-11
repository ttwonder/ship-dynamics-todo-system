import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ExcelJS from 'exceljs';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const cases = [];
const check = async (name, run) => { try { await run(); cases.push({ name, ok: true }); } catch (error) { cases.push({ name, ok: false, error: error.message }); } };
const label = 'B/F or I/F Qty(Cargo Name + MT/BBLS/M3)';
try {
  const types = await server.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const excel = await server.ssrLoadModule('/src/itinerary/itineraryExcel.ts');
  const validation = await server.ssrLoadModule('/src/itinerary/itineraryValidation.ts');
  const doc = types.createEmptyItineraryDocument({ workspaceKey:'qa', vesselId:'v1', vesselName:'QA V1', rowId:'r1' });
  Object.assign(doc.rows[0], { previousPortName:'BUSAN', portDockName:'KAOHSIUNG', portTimeZone:'UTC+8', calculationStartUtc:'2026-09-01T00:00:00Z', calculationStartTimeZone:'UTC+8', operation:'To Load / bunker', cargoQuantityText:'Crude Oil 1200 MT' });
  await check('bunker appended; canonical multiselect and removal preserve existing purposes', () => {
    assert.deepEqual(types.ITINERARY_PURPOSE_OPTIONS.map(x=>x.label), ['To Load','To Unload','docking','waiting order','repair','inspection','bunker']);
    assert.equal(types.normalizeItineraryOperation('bunker / inspection / loading'), 'To Load / inspection / bunker');
    assert.equal(types.setItineraryOperationSelected('To Load', 'bunker', true), 'To Load / bunker');
    assert.equal(types.setItineraryOperationSelected('To Load / bunker', 'bunker', false), 'To Load');
    assert.equal(types.itineraryOperationSelected('bunker', 'bunker'), true);
    assert.equal(types.normalizeItineraryOperation('not-a-purpose'), null);
    assert.equal(validation.validateItineraryDocument(doc).ok, true);
  });
  const noop = () => {};
  const render = async (file, props) => {
    const module = await server.ssrLoadModule('/src/itinerary/'+file);
    return renderToStaticMarkup(React.createElement(module.default || module.ItineraryBrowseTable, props));
  };
  const consumers = [
    ['company editor','ItineraryEditor.tsx',{document:doc,actorId:'qa',lease:{},onSave:noop,onRenewLease:noop,onCancel:noop,onSaved:noop},true],
    ['ship formal editor','ShipItineraryPlanWorkspace.tsx',{rows:doc.rows,readOnly:false,onPatchRow:noop,onRemoveRow:noop},true],
    ['ship alternative editor','ShipItineraryPlanWorkspace.tsx',{rows:doc.rows,readOnly:false,labelPrefix:'備選方案1',onPatchRow:noop,onRemoveRow:noop},true],
    ['shared company/ship browse','ItineraryBrowseTable.tsx',{rows:doc.rows,nowMs:0},false],
  ];
  for (const [name,file,props,editable] of consumers) await check(name+' renders updated header and bunker', async () => {
    const html = await render(file,props);
    const headings = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(x=>x[1].replace(/<[^>]*>/g,'').replace(/\n/g,''));
    assert.equal(headings.filter(x=>x===label).length,1, name+' quantity heading');
    if (editable) {
      const purpose = html.match(/aria-label="Purpose（可多選）"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
      assert.equal((purpose.match(/type="checkbox"/g)||[]).length,7);
      assert.match(purpose,/<label>[\s\S]*?checked=""[\s\S]*?<span>bunker<\/span>/);
    } else assert.ok(html.includes('To Load / bunker'));
  });
  await check('Excel exports exact header, bunker dropdown and canonical mixed purpose; old header remains importable', async () => {
    const bytes = await excel.buildItineraryWorkbook([doc],fs.readFileSync('public/templates/itinerary-template-v1.xlsx'));
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(bytes));
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.getCell('D3').value,label);
    assert.equal(sheet.getCell('C4').value,'To Load / bunker');
    assert.ok(sheet.getCell('C4').dataValidation.formulae[0].includes(',bunker,'));
    assert.equal(sheet.getCell('D4').value,'Crude Oil 1200 MT');
    const parsed = await excel.parseItineraryWorkbook(bytes);
    assert.equal(parsed.sheets[0].issues.length,0,JSON.stringify(parsed.sheets[0].issues)); assert.equal(parsed.sheets[0].rows[0].operation,'To Load / bunker');
    sheet.getCell('D3').value='B/F or I/F Qty (MT/BBLS)';
    const old = await excel.parseItineraryWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    assert.equal(old.sheets[0].issues.length,0); assert.equal(old.sheets[0].rows[0].cargoQuantityText,'Crude Oil 1200 MT');
  });
} finally { await server.close(); }
console.log(JSON.stringify({layer:'domain/SSR/ExcelJS',cases},null,2));
if(cases.some(x=>!x.ok))process.exitCode=1;
