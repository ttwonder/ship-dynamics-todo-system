import assert from 'node:assert/strict';
import {createServer} from 'vite';
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom',logLevel:'silent'});
const cases=[];
try {
  const {shipTrackingCommand}=await vite.ssrLoadModule('/src/tracking/shipTracking.ts');
  const wrap=command=>({command,context:{actorId:'qa',at:'2026-09-01T00:00:00Z',operationId:'qa-op'},identity:'qa'});
  const item={id:'qa-1',expectedUpdatedAt:'2026-09-01T00:00:00Z',requestType:'annual-inspection',actualDate:'',deliveryStatus:'partially-delivered'};
  const command={type:'reclassify',items:[{...item,description:'must not be serialized',kind:'supply',completionDate:'1999-01-01'}],date:'must not become lifecycle'};
  const before=structuredClone(command);
  assert.equal(JSON.stringify(shipTrackingCommand(wrap(command),'qa-v1')),JSON.stringify({type:'reclassify',items:[item]}),'serialize exactly the named item fields in a reclassify command, not the whole draft or lifecycle');
  assert.deepEqual(command,before);
  cases.push('exact-reclassify-whitelist-no-draft-mutation');
  for(const command of [
    {type:'progress',items:[{id:'qa-1',expectedUpdatedAt:'old',text:'new'}]},
    {type:'edit',items:[{id:'qa-1',expectedUpdatedAt:'old',changes:{requestType:'spares',completionDate:undefined,actualDeliveryDate:''}}]},
    {type:'delivery',items:[{id:'qa-1',expectedUpdatedAt:'old',status:'delivered',date:'2026-09-01'}]},
    {type:'lifecycle',action:'reopen',date:'',outcome:'completed',targets:[{id:'qa-1',expectedUpdatedAt:'old',entry:'tracking'}]},
  ])assert.equal(JSON.stringify(shipTrackingCommand(wrap(command),'qa-v1')),JSON.stringify(command),'existing pending request byte signatures remain unchanged');
  cases.push('legacy-non-create-pending-signature-compatibility');
  console.log(JSON.stringify({gate:'tracking-reclassify-client',status:'PASS',caseCount:cases.length,cases}));
} finally {await vite.close();}
