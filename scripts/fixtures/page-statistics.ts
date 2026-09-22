import {createDataAnalysisFixture} from './data-analysis';
import type {TemporaryMeeting} from '../../src/types';
export function createPageStatisticsFixture(){
 const fixture=createDataAnalysisFixture();const {data}=fixture;
 Object.assign(data.tasks[0],{expectedDate:'2026-01-06',closedDate:'2026-01-05'});
 Object.assign(data.tasks[1],{expectedDate:'2026-01-09'});
 Object.assign(data.tasks[3],{sourceMeetingItemId:'decision-1',expectedDate:'2026-03-20'});
 data.tasks[3].vesselProgress![0].closedDate='2026-03-18';
 Object.assign(data.tasks[4],{expectedDate:'2026-05-01',closedDate:'2026-05-03'});
 const meeting=(id:string,patch:Partial<TemporaryMeeting>={}):TemporaryMeeting=>({id,subject:'測試會議 '+id,status:'追蹤中',meetingDate:'2026-03-01',vesselScopeMode:'vessels',vessels:['qa-v1','qa-v2'],reason:'測試原因',departments:['海務'],participantUserIds:['qa-a'],trackingUserIds:['qa-c'],responsibleUserIds:['qa-b'],resolution:'',taskDescription:'',taskItems:[],expectedDate:'2026-03-20',priority:'高',isAbnormal:false,isInternalControl:false,createdBy:'qa-a',createdAt:'2026-03-01T00:00:00Z',...patch});
 data.meetings=[meeting('qa-meeting',{taskItems:[{id:'decision-1',description:'分船追蹤',categories:['設備']},{id:'unlinked',description:'未派生決議',categories:['管理'],isClosed:true,closedDate:'2026-03-10'}]}),meeting('finished',{subject:'已完成測試會議',status:'已完成',completedDate:'2026-03-18'}),meeting('future',{subject:'待召開測試會議',status:'待召開',expectedDate:'2099-01-01'})];
 return fixture;
}
