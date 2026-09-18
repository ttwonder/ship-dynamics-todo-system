import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
  const {createInitialData}=await server.ssrLoadModule('/src/data/seed.ts');
  const {BatchCreateModal}=await server.ssrLoadModule('/src/InternalControlModals.tsx');
  const data=createInitialData();
  const vessel=data.vessels[0];
  const user={id:'qa-ship-form',name:'QA FORM',username:'qa-form',role:'operator',department:'管理組',isActive:true,managedVesselIds:[vessel.id],createdAt:'2026-09-19T00:00:00Z',updatedAt:'2026-09-19T00:00:00Z'};
  data.users=[user];vessel.assignedUserIds=[user.id];
  const props={data,user,vessels:[vessel],close:()=>{},save:async()=>true};
  const shore=renderToStaticMarkup(createElement(BatchCreateModal,props));
  assert.match(shore,/結案日期（可選）/,'shore creation retains its existing close-on-create control');
  assert.match(shore,/保存 1 筆案件/);
  const draft={vesselId:vessel.id,reportDate:'2026-09-19',reportSource:'日常',rows:[{key:'row-1',description:'QA 船端訴求',priority:'低',category:'設備故障',equipmentSubcategory:data.settings.equipmentFailureSubcategories[0],isAware:false,status:'待岸端協助',departments:[data.settings.departments[0]],closedDate:'',syncToTask:false,taskCategories:['設備故障'],taskEquipmentSubcategory:'',taskExpectedDate:'',taskOwnerUserIds:[],taskIsAbnormal:false}]};
  const catalog={taskCategories:data.settings.taskCategories,priorities:data.settings.priorities,equipmentFailureSubcategories:data.settings.equipmentFailureSubcategories,departments:data.settings.departments,owners:[{id:user.id,name:user.name,username:user.username,department:user.department,isActive:true}],defaultOwnerIds:[user.id]};
  const ship=renderToStaticMarkup(createElement(BatchCreateModal,{...props,shipSubmission:{draft,catalog,busy:false,pending:false,message:'',onDraftChange:()=>{}}}));
  assert.doesNotMatch(ship,/結案日期/,'ship submission may only create open cases, not pre-closed cases');
  assert.match(ship,/提交 1 筆/);
  assert.match(shore,/同步到要事/,'shore optional task linkage remains available');
  assert.doesNotMatch(ship,/同步到要事|同步要事設定|追蹤窗口/,'ship may create internal-control cases only');
  for(const label of ['報告日期','報告來源','事項內容','解決計劃／最新狀態','標記為知曉事項','涉及部門','＋ 新增一筆'])assert.ok(ship.includes(label),`shared field retained: ${label}`);
  assert.match(ship,/QA 船端訴求/,'controlled ship draft is rendered, not reset to blank');
  globalThis.window={SHIP_DYNAMICS_SUPABASE_CONFIG:{supabaseUrl:'http://127.0.0.1:9999',supabaseAnonKey:'qa-public-form',workspaceKey:'qa',storageMode:'records-v1'}};
  globalThis.localStorage={getItem:()=>null};
  const {default:Portal}=await server.ssrLoadModule('/src/ShipInternalControlPortal.tsx');
  const portal=renderToStaticMarkup(createElement(Portal));
  assert.match(portal,/船端內控\/訴求/);assert.match(portal,/請選擇船舶/);assert.match(portal,/增加內控\/訴求/);assert.doesNotMatch(portal,/type="password"/);
  console.log('PASS ship internal-control: public selection, shore form preserved, ship internal-only and controlled draft');
} finally {await server.close();}
