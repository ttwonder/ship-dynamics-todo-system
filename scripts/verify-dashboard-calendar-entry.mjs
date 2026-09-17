import assert from 'node:assert/strict';
import {createServer} from 'vite';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'});
try {
 const {default:Dashboard}=await server.ssrLoadModule('/src/Dashboard.tsx');
 const noop=()=>{};
 const html=renderToStaticMarkup(React.createElement(Dashboard,{user:{id:'qa',role:'admin',isActive:true},itineraryActor:{userId:'qa'},users:[],vessels:[],tasks:[],calendarTasks:[],internalControlCases:[],meetings:[],selected:[],setSelected:noop,batchSelected:[],setBatchSelected:noop,onOpenVessel:noop,onEdit:noop,onAddTask:noop,onToggleAttention:noop,onAdjustAttention:noop,onStartMeeting:noop,onOpenReport:noop,onTaskMetric:noop,onOpenBatchManagedVessels:noop,canEdit:true,canCreateTasks:true,canUseMeetings:true,canUseReports:true}));
 assert.match(html,/>切換行事曆顯示<\/button>/,'home has direct calendar entry');
 assert.ok(html.indexOf('切換行事曆顯示')<html.indexOf('切換顯示Itinerary信息'),'new button precedes existing itinerary entry');
 assert.match(html,/class="fleet-card-grid"/,'default remains cards');
 console.log('Dashboard direct calendar entry: 3 SSR assertions passed. Mounted selection checks run in original UI.');
} finally { await server.close(); }
