import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const vite = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const types = await vite.ssrLoadModule('/src/itinerary/itineraryTypes.ts');
  const Editor = (await vite.ssrLoadModule('/src/itinerary/ItineraryEditor.tsx')).default;
  const doc = types.createEmptyItineraryDocument({workspaceKey:'qa',vesselId:'v1',vesselName:'QA V1',rowId:'r1'});
  doc.rows[0].currentVesselState = {location:'Indian Ocean',navigationStatus:'航行',loadStatus:'非空載',statusList:['bunker','drydock/repiar']};
  const html = renderToStaticMarkup(React.createElement(Editor,{document:doc,actorId:'qa',lease:{},onSave(){},onRenewLease(){},onCancel(){},onSaved(){}}));
  assert.match(html,/<fieldset[^>]*aria-label="目前船舶資料"/,'original shore modal must expose four editable current fields');
  assert.match(html,/<input(?=[^>]*aria-label="目前位置")(?=[^>]*value="Indian Ocean")(?![^>]*readonly)[^>]*>/);
  assert.match(html,/<select[^>]*aria-label="目前航行狀態"/);
  assert.match(html,/<select[^>]*aria-label="目前載況"/);
  assert.match(html,/data-current-vessel-status/);
  assert.match(html,/drydock\/repair/);
  console.log('SHORE_CURRENT_STATE_RENDER_PASS');
} finally { await vite.close(); }
