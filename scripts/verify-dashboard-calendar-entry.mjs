import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
 const {default:Dashboard}=await server.ssrLoadModule('/src/Dashboard.tsx');
 const noop=()=>{};
 const props={user:{id:'qa',role:'admin',isActive:true},itineraryActor:{userId:'qa'},users:[],vessels:[],tasks:[],calendarTasks:[],internalControlCases:[],meetings:[],selected:[],setSelected:noop,batchSelected:[],setBatchSelected:noop,onOpenVessel:noop,onEdit:noop,onAddTask:noop,onToggleAttention:noop,onAdjustAttention:noop,onStartMeeting:noop,onOpenReport:noop,onTaskMetric:noop,onOpenBatchManagedVessels:noop,canEdit:true,canCreateTasks:true,canUseMeetings:true,canUseReports:true};
 const html=renderToStaticMarkup(React.createElement(Dashboard,props));
 assert.match(html,/>顯示行事曆<\/button>/,'home has the approved concise calendar label');
 assert.match(html,/>顯示Itinerary<\/button>/,'home has the approved concise Itinerary label');
 assert.ok(html.indexOf('顯示行事曆')<html.indexOf('顯示Itinerary'),'calendar remains before Itinerary');
 assert.match(html,/>批量更新（已選 0）<\/button>/,'batch label retains the zero selection count');
 const selectedHtml=renderToStaticMarkup(React.createElement(Dashboard,{...props,batchSelected:['qa-v1','qa-v2']}));
 assert.match(selectedHtml,/>批量更新（已選 2）<\/button>/,'batch label retains the dynamic selection count');
 assert.match(html,/class="fleet-card-grid"/,'default remains cards');
 console.log('Dashboard concise toolbar labels, dynamic selected count and default cards: PASS (SSR).');
} finally { await server.close(); }
