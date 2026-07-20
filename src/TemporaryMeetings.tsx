import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type {
  AppData,
  MeetingTaskItem,
  MeetingVesselScopeMode,
  StatusLog,
  TaskPriority,
  TemporaryMeeting,
  TemporaryMeetingStatus,
  UserAccount,
  Vessel,
} from './types';
import { nowIso, roleLabel, todayDate, uid, withAudit } from './utils';
import { canAccessAllVessels, hasPermission, isEligibleTaskOwner } from './permissions';
import { buildTaskScopeChangeNotifications } from './taskWorkflow';
import { reconcileMeetingTasks, meetingTaskItems, meetingTaskNotificationEvents, unchangedMeetingTaskItemIds } from './meetingTaskWorkflow';
import { canEditTemporaryMeetings, meetingAppliesToUser } from './meetingAccess';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskShipTypeLabel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import MeetingPeoplePicker from './MeetingPeoplePicker';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { meetingPdfVesselSummary } from './meetingPdf';
import { addMeetingStatusRecord } from './meetingStatusWorkflow';
import RichTextEditor from './RichTextEditor';
import RichTextContent from './RichTextContent';
import { richTextToPlainText, isRichTextEmpty } from './richText';
import { normalizeMeetingTaskCategoryList } from './taskCategories';

type Props = {
  data: AppData;
  visibleVessels: Vessel[];
  currentUser: UserAccount;
  canExportReports: boolean;
  setData: Dispatch<SetStateAction<AppData>>;
  commit: (mutate: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
};

type MeetingDraft = Pick<
  TemporaryMeeting,
  'subject' | 'meetingDate' | 'vessels' | 'reason' | 'departments' | 'participantUserIds' | 'trackingUserIds' | 'responsibleUserIds' | 'resolution' | 'taskItems' | 'expectedDate' | 'priority'
> & {
  status: TemporaryMeetingStatus;
  vesselScopeMode: MeetingVesselScopeMode;
  vesselTypeScopes: string[];
  includeInMorning: boolean;
  latestStatus: string;
  statusLogs: StatusLog[];
};

type ScopeFilter = 'any' | MeetingVesselScopeMode;

const statuses: TemporaryMeetingStatus[] = ['待召開', '追蹤中', '已完成'];
const statusOf = (meeting: TemporaryMeeting): TemporaryMeetingStatus => meeting.status || '追蹤中';
const scopeModeOf = (meeting: TemporaryMeeting): MeetingVesselScopeMode => meeting.vesselScopeMode || 'vessels';
const scopeModeLabel = (mode: MeetingVesselScopeMode) => mode === 'all' ? '全部船舶' : mode === 'types' ? '按船舶類型' : '逐船選擇';
const meetingScopeLabel = (meeting: TemporaryMeeting) => {
  const mode = scopeModeOf(meeting);
  if (mode === 'all') return '全部船舶';
  if (mode === 'types') return `船型：${(meeting.vesselTypeScopes || []).join('、') || '未指定'}`;
  return meeting.vessels.length ? `逐船：${meeting.vessels.length} 艘` : '未指定船舶';
};

const blankDraft = (): MeetingDraft => ({
  subject: '',
  status: '待召開',
  meetingDate: todayDate(),
  vesselScopeMode: 'vessels',
  vesselTypeScopes: [],
  vessels: [],
  reason: '',
  departments: [],
  participantUserIds: [],
  trackingUserIds: [],
  responsibleUserIds: [],
  resolution: '',
  taskItems: [{ id: uid('meeting-task-item'), description: '', categories: [], distributeToVessels: false }],
  expectedDate: todayDate(),
  priority: '中',
  includeInMorning: false,
  latestStatus: '',
  statusLogs: [],
});

const draftFrom = (meeting?: TemporaryMeeting, tasks = [] as AppData['tasks']): MeetingDraft => meeting ? {
  subject: meeting.subject,
  status: statusOf(meeting),
  meetingDate: meeting.meetingDate,
  vesselScopeMode: scopeModeOf(meeting),
  vesselTypeScopes: [...(meeting.vesselTypeScopes || [])],
  vessels: [...meeting.vessels],
  reason: meeting.reason,
  departments: [...meeting.departments],
  participantUserIds: [...meeting.participantUserIds],
  trackingUserIds: [...(meeting.trackingUserIds || meeting.responsibleUserIds || [])],
  responsibleUserIds: [...meeting.responsibleUserIds],
  resolution: meeting.resolution,
  taskItems: meetingTaskItems(meeting, tasks).length ? meetingTaskItems(meeting, tasks) : [{ id: uid('meeting-task-item'), description: '', categories: [], distributeToVessels: false }],
  expectedDate: meeting.expectedDate,
  priority: meeting.priority,
  includeInMorning: meeting.includeInMorning === true,
  latestStatus: meeting.latestStatus || '',
  statusLogs: [...(meeting.statusLogs || [])],
} : blankDraft();

export default function TemporaryMeetingsPage({ data, visibleVessels, currentUser, canExportReports, setData, commit }: Props) {
  const canViewAllMeetings = currentUser.role === 'owner' || currentUser.role === 'admin' || hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const editable = canEditTemporaryMeetings(data.settings.rolePermissions, currentUser);
  const visibleIds = new Set(visibleVessels.map(vessel => vessel.id));
  const visibleVesselKey = [...visibleIds].sort().join('\u0000');
  const appliesToUser = (meeting: TemporaryMeeting) => meetingAppliesToUser(meeting, visibleVessels, canViewAllMeetings, currentUser.id);
  const accessibleMeetings = data.meetings.filter(appliesToUser);
  const initialMeeting = accessibleMeetings[0];
  const [selectedId, setSelectedId] = useState(initialMeeting?.id || '');
  const [creating, setCreating] = useState(editable && !initialMeeting);
  const [draft, setDraft] = useState<MeetingDraft>(() => draftFrom(initialMeeting, data.tasks));
  const [baseMeetingUpdatedAt,setBaseMeetingUpdatedAt]=useState(initialMeeting?.updatedAt||'');
  const [baseRevision,setBaseRevision]=useState(data.revision);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部' | TemporaryMeetingStatus>('全部');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('any');
  const [typeFilter, setTypeFilter] = useState('all');
  const [meetingPage, setMeetingPage] = useState(1);
  const [viewMode, setViewMode] = useState<'workspace' | 'register'>('workspace');
  const [meetingExportSelection, setMeetingExportSelection] = useState<string[]>([]);
  const [printMeetingIds, setPrintMeetingIds] = useState<string[]>([]);
  const [printMode, setPrintMode] = useState<'meetings' | 'register' | ''>('');
  const [notice, setNotice] = useState('');
  const [quickStatus, setQuickStatus] = useState('');
  const savingRef = useRef(false);
  const printInFlightRef = useRef(false);

  const selected = accessibleMeetings.find(meeting => meeting.id === selectedId);
  const linkedTasks = selected ? data.tasks.filter(task => task.sourceMeetingId === selectedId && taskVesselIds(task).some(id => visibleIds.has(id))) : [];
  const users = useMemo(() => Object.fromEntries(data.users.map(user => [user.id, user])), [data.users]);
  const meetingPeople = useMemo(() => data.users.filter(user => user.isActive && user.role !== 'vessel'), [data.users]);
  const peopleNames = (ids: string[]) => ids.map(id => users[id]?.name).filter(Boolean).join('、') || '-';
  const vesselById = useMemo(() => Object.fromEntries(visibleVessels.map(vessel => [vessel.id, vessel])), [visibleVessels]);
  const shipTypes = useMemo(
    () => Array.from(new Set(visibleVessels.map(vessel => vessel.shipType.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'zh-TW')),
    [visibleVessels],
  );

  const meetingVesselTypes = (meeting: TemporaryMeeting) => {
    if (scopeModeOf(meeting) === 'all') return shipTypes;
    if (scopeModeOf(meeting) === 'types') return meeting.vesselTypeScopes || [];
    return Array.from(new Set(meeting.vessels.map(id => vesselById[id]?.shipType).filter((value): value is string => Boolean(value))));
  };

  const filtered = accessibleMeetings.filter(meeting => {
    const q = query.trim().toLowerCase();
    if (statusFilter !== '全部' && statusOf(meeting) !== statusFilter) return false;
    if (scopeFilter !== 'any' && scopeModeOf(meeting) !== scopeFilter) return false;
    if (typeFilter !== 'all') {
      if (scopeModeOf(meeting)==='all') return !q || `${meeting.subject} ${richTextToPlainText(meeting.reason)} ${richTextToPlainText(meeting.resolution)} ${meetingTaskItems(meeting, data.tasks).map(item => richTextToPlainText(item.description)).join(' ')} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
      if (!meetingVesselTypes(meeting).includes(typeFilter)) return false;
    }
    return !q || `${meeting.subject} ${richTextToPlainText(meeting.reason)} ${richTextToPlainText(meeting.resolution)} ${[...meeting.participantUserIds, ...(meeting.trackingUserIds || []), ...meeting.responsibleUserIds].map(id => users[id]?.name || '').join(' ')} ${meetingTaskItems(meeting, data.tasks).map(item => richTextToPlainText(item.description)).join(' ')} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
  });
  const pagedMeetings = paginateItems(filtered, meetingPage);

  useEffect(() => setMeetingPage(1), [query, statusFilter, scopeFilter, typeFilter]);

  const resolvedVesselIds = useMemo(() => {
    if (draft.vesselScopeMode === 'all') return visibleVessels.map(vessel => vessel.id);
    if (draft.vesselScopeMode === 'types') return visibleVessels.filter(vessel => draft.vesselTypeScopes.includes(vessel.shipType)).map(vessel => vessel.id);
    return draft.vessels.filter(id => visibleVessels.some(vessel => vessel.id === id));
  }, [draft.vesselScopeMode, draft.vesselTypeScopes, draft.vessels, visibleVessels]);
  const responsiblePeople = useMemo(() => {
    const scopeVessels = resolvedVesselIds.map(id => data.vessels.find(vessel => vessel.id === id)).filter((vessel): vessel is Vessel => Boolean(vessel));
    return meetingPeople.filter(user => isEligibleTaskOwner(data.settings.rolePermissions, user, scopeVessels));
  }, [meetingPeople, resolvedVesselIds, data.vessels, data.settings.rolePermissions]);

  const cleanTaskItems = (items: MeetingTaskItem[]) => {
    const seen = new Set<string>();
    return items.map((item, index) => {
      const rawId = item.id || `meeting-task-item-${index + 1}`;
      const id = seen.has(rawId) ? `${rawId}-duplicate-${index + 1}` : rawId;
      seen.add(id);
      return { id, description: item.description.trim(), categories: normalizeMeetingTaskCategoryList(item.categories, data.settings.meetingTaskCategories), distributeToVessels: item.distributeToVessels === true };
    }).filter(item => !isRichTextEmpty(item.description));
  };

  useEffect(() => {
    if (creating && !editable) {
      const next = accessibleMeetings[0];
      setCreating(false);
      setSelectedId(next?.id || '');
      setDraft(draftFrom(next, data.tasks));
      setBaseMeetingUpdatedAt(next?.updatedAt||'');
      setBaseRevision(data.revision);
      return;
    }
    if (creating) return;
    const meeting = accessibleMeetings.find(item => item.id === selectedId);
    if (meeting) {
      setDraft(draftFrom(meeting, data.tasks));
      setBaseMeetingUpdatedAt(meeting.updatedAt||'');
      setBaseRevision(data.revision);
      return;
    }
    const next = accessibleMeetings[0];
    setSelectedId(next?.id || '');
    setDraft(draftFrom(next, data.tasks));
    setBaseMeetingUpdatedAt(next?.updatedAt||'');
    setBaseRevision(data.revision);
  }, [selectedId, creating, editable, canViewAllMeetings, visibleVesselKey, currentUser.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!printMode) return;
    printInFlightRef.current = true;
    const modeClass = printMode === 'meetings' ? 'printing-meeting-detail' : 'printing-meeting-register';
    document.body.classList.add('printing-meetings', modeClass);
    let cleaned = false;
    let frame = 0;
    let fallback = 0;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.body.classList.remove('printing-meetings', modeClass);
      window.removeEventListener('afterprint', cleanup);
      if (frame) window.cancelAnimationFrame(frame);
      if (fallback) window.clearTimeout(fallback);
      printInFlightRef.current = false;
      setPrintMeetingIds([]);
      setPrintMode('');
    };
    window.addEventListener('afterprint', cleanup);
    frame = window.requestAnimationFrame(() => {
      try {
        window.print();
        fallback = window.setTimeout(cleanup, 60000);
      } catch {
        cleanup();
      }
    });
    return cleanup;
  }, [printMode]);

  const selectMeeting = (meeting: TemporaryMeeting) => {
    setCreating(false);
    setSelectedId(meeting.id);
    setDraft(draftFrom(meeting, data.tasks));
    setBaseMeetingUpdatedAt(meeting.updatedAt||'');
    setBaseRevision(data.revision);
    setQuickStatus('');
    setViewMode('workspace');
  };
  const startNew = () => {
    if (!editable) return alert('修改臨會/專題需同時具備「新增及修改臨會/專題」與「查看全部船舶」權限');
    setCreating(true);
    setSelectedId('');
    setDraft(blankDraft());
    setBaseMeetingUpdatedAt('');
    setBaseRevision(data.revision);
    setQuickStatus('');
    setViewMode('workspace');
  };
  const toggleVessel = (id: string) => setDraft(previous => ({
    ...previous,
    vessels: previous.vessels.includes(id) ? previous.vessels.filter(value => value !== id) : [...previous.vessels, id],
  }));
  const toggleVesselType = (shipType: string) => setDraft(previous => ({
    ...previous,
    vesselTypeScopes: previous.vesselTypeScopes.includes(shipType)
      ? previous.vesselTypeScopes.filter(value => value !== shipType)
      : [...previous.vesselTypeScopes, shipType],
  }));
  const toggleDepartment = (name: string) => setDraft(previous => ({
    ...previous,
    departments: previous.departments.includes(name)
      ? previous.departments.filter(value => value !== name)
      : [...previous.departments, name],
  }));
  const addTaskItem = () => setDraft(previous => ({ ...previous, taskItems: [...previous.taskItems, { id: uid('meeting-task-item'), description: '', categories: normalizeMeetingTaskCategoryList([], data.settings.meetingTaskCategories), distributeToVessels: false }] }));
  const updateTaskItem = (id: string, description: string) => setDraft(previous => ({ ...previous, taskItems: previous.taskItems.map(item => item.id === id ? { ...item, description } : item) }));
  const updateTaskItemCategories = (id: string, categories: string[]) => setDraft(previous => ({ ...previous, taskItems: previous.taskItems.map(item => item.id === id ? { ...item, categories: normalizeMeetingTaskCategoryList(categories, data.settings.meetingTaskCategories) } : item) }));
  const toggleTaskItemDistribution = (id: string, distributeToVessels: boolean) => setDraft(previous => ({ ...previous, taskItems: previous.taskItems.map(item => item.id === id ? { ...item, distributeToVessels } : item) }));
  const removeTaskItem = (id: string) => setDraft(previous => ({
    ...previous,
    taskItems: previous.taskItems.length > 1
      ? previous.taskItems.filter(item => item.id !== id)
      : previous.taskItems.map(item => item.id === id ? { ...item, description: '', categories: normalizeMeetingTaskCategoryList([], data.settings.meetingTaskCategories), distributeToVessels: false } : item),
  }));

  const addStatus = () => {
    if (!editable) return alert('您無權修改臨會/專題');
    if (creating) return alert('請先建立會議，再加入狀態紀錄');
    const next = addMeetingStatusRecord(draft, quickStatus, currentUser.name, nowIso(), uid('meeting-log'), currentUser.id);
    if (!next) return;
    setDraft(previous => ({ ...previous, ...next }));
    setQuickStatus('');
  };

  const canDeleteMeetingStatusLog = (log: StatusLog) => currentUser.role === 'owner' || currentUser.role === 'admin' || log.byUserId === currentUser.id || (!log.byUserId && log.by === currentUser.name);
  const deleteStatusLog = (logId: string) => {
    const log = draft.statusLogs.find(item => item.id === logId);
    if (!log) return;
    if (!canDeleteMeetingStatusLog(log)) return alert('只有 Owner／管理員或該狀態記錄添加人可以刪除');
    setDraft(previous => {
      const statusLogs = previous.statusLogs.filter(item => item.id !== logId);
      return { ...previous, statusLogs, latestStatus: statusLogs[0]?.text || '' };
    });
  };

  const save = () => {
    if (!editable) return alert('您無權修改臨會/專題');
    if (savingRef.current) return;
    if (!draft.subject.trim()) return alert('請填寫會議主題');
    if (!statuses.includes(draft.status)) return alert('請選擇會議狀態');
    if (!draft.meetingDate) return alert('請選擇召開日期');
    if (!draft.expectedDate) return alert('請選擇預計完成日期');
    if (isRichTextEmpty(draft.resolution)) return alert('請填寫會議決議');
    if (draft.vesselScopeMode === 'types' && !draft.vesselTypeScopes.length) return alert('請至少選擇一個船舶類型');
    if (!resolvedVesselIds.length) return alert('請至少選擇一艘船舶');
    if (!draft.departments.length) return alert('請至少選擇一個涉及部門');
    if (!draft.participantUserIds.length) return alert('請至少選擇一位與會人員');
    if (!draft.trackingUserIds.length) return alert('請至少選擇一位追蹤窗口');
    savingRef.current = true;
    const wasCreating=creating;
    const id = wasCreating ? uid('meet') : selectedId;
    const requestedDraft: MeetingDraft = {
      ...draft,
      vesselTypeScopes: draft.vesselScopeMode === 'types' ? [...draft.vesselTypeScopes] : [],
      vessels: [...resolvedVesselIds],
      taskItems: cleanTaskItems(draft.taskItems),
    };
    let applied=false;
    let failure='會議已變更或權限已更新，請重新整理後再試';
    let persistedDraft:MeetingDraft|undefined;
    let persistedUpdatedAt='';
    let persistedRevision=0;
    flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser){failure='登入身份已失效，請重新登入';return prev;}
      if(!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)){failure='您已無權修改臨會/專題';return prev;}
      const canViewAll=liveUser.role==='owner'||liveUser.role==='admin'||hasPermission(prev.settings.rolePermissions,liveUser,'viewAllVessels');
      const liveVisibleVessels=prev.vessels.filter(vessel=>vessel.isActive&&(
        canViewAll||vessel.assignedUserIds.includes(liveUser.id)||liveUser.managedVesselIds.includes(vessel.id)
      ));
      const liveVesselIds=requestedDraft.vesselScopeMode==='all'
        ?liveVisibleVessels.map(vessel=>vessel.id)
        :requestedDraft.vesselScopeMode==='types'
          ?liveVisibleVessels.filter(vessel=>requestedDraft.vesselTypeScopes.includes(vessel.shipType)).map(vessel=>vessel.id)
          :requestedDraft.vessels.filter(id=>liveVisibleVessels.some(vessel=>vessel.id===id));
      if(!liveVesselIds.length||requestedDraft.vesselScopeMode==='vessels'&&liveVesselIds.length!==requestedDraft.vessels.length){failure='涉船範圍權限已變更，請重新選擇';return prev;}
      const liveScopeVessels=liveVisibleVessels.filter(vessel=>liveVesselIds.includes(vessel.id));
      if(!canAccessAllVessels(prev.settings.rolePermissions,liveUser,liveScopeVessels)){failure='必須具備全部涉船範圍權限才能保存會議';return prev;}
      const invalidParticipant=requestedDraft.participantUserIds.some(id=>!prev.users.some(user=>user.id===id&&user.isActive&&user.role!=='vessel'));
      if(invalidParticipant){failure='與會人員已停用或不存在，請重新選擇';return prev;}
      const invalidTracking=requestedDraft.trackingUserIds.some(id=>!prev.users.some(user=>user.id===id&&user.isActive&&user.role!=='vessel'));
      if(invalidTracking){failure='追蹤窗口已停用或不存在，請重新選擇';return prev;}
      const invalidResponsible=requestedDraft.responsibleUserIds.some(id=>!isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),liveScopeVessels));
      if(invalidResponsible){failure='负责人已停用或不具备全部涉船范围权限，请重新选择';return prev;}
      const liveMeeting=prev.meetings.find(item=>item.id===id);
      if(wasCreating&&liveMeeting){failure='會議識別碼已存在，請重新建立';return prev;}
      if(!wasCreating&&(!liveMeeting||!meetingAppliesToUser(liveMeeting,liveVisibleVessels,canViewAll,liveUser.id))){failure='會議已被刪除或不再可存取，未保存任何變更';return prev;}
      if(!wasCreating&&liveMeeting!.updatedAt!==baseMeetingUpdatedAt){failure='會議已由其他操作更新，為避免覆蓋最新內容，本次未保存';return prev;}
      if(!wasCreating&&prev.revision!==baseRevision){failure='主資料版本已更新，為避免覆蓋其他操作，本次未保存；請重新選擇會議';return prev;}
      const at=nowIso();
      const effectiveDraft={...requestedDraft,vessels:liveVesselIds};
      const taskDescription=effectiveDraft.taskItems[0]?.description||'';
      const preserveExistingDescriptionItemIds=unchangedMeetingTaskItemIds(liveMeeting,prev.tasks,effectiveDraft.taskItems);
      const draftData=structuredClone(prev);
      const previousTasks=new Map(draftData.tasks.filter(task=>task.sourceMeetingId===id).map(task=>[task.id,structuredClone(task)]));
      let meeting=draftData.meetings.find(item=>item.id===id);
      if(wasCreating){
        meeting={id,...effectiveDraft,taskDescription,createdBy:liveUser.id,createdAt:at,updatedAt:at};
        draftData.meetings.unshift(meeting);
      }else if(meeting){
        Object.assign(meeting,{...effectiveDraft,taskDescription,updatedAt:at});
      }else{return prev;}
      const reconciliation=reconcileMeetingTasks({
        tasks:draftData.tasks,meetingId:id,vesselIds:effectiveDraft.vessels,vesselScopeMode:effectiveDraft.vesselScopeMode,
        vesselTypeScopes:effectiveDraft.vesselTypeScopes,followUps:effectiveDraft.taskItems,priority:effectiveDraft.priority,
        meetingTaskCategories:prev.settings.meetingTaskCategories,
        expectedDate:effectiveDraft.expectedDate,departments:effectiveDraft.departments,ownerUserIds:effectiveDraft.trackingUserIds,
        initialStatus:effectiveDraft.resolution,actorId:liveUser.id,actorName:liveUser.name,at,preserveExistingDescriptionItemIds,
      });
      meetingTaskNotificationEvents(draftData.tasks,reconciliation).forEach(({task,kind})=>{
        const previousTask=previousTasks.get(task.id)||null;
        const previousVessels=previousTask?draftData.vessels.filter(vessel=>taskVesselIds(previousTask).includes(vessel.id)):[];
        const nextVessels=draftData.vessels.filter(vessel=>taskVesselIds(task).includes(vessel.id));
        const previousNoticeTask=previousTask?{...previousTask,ownerUserIds:previousTask.ownerUserIds.filter(ownerId=>isEligibleTaskOwner(draftData.settings.rolePermissions,draftData.users.find(user=>user.id===ownerId),previousVessels))}:null;
        const nextNoticeTask={...task,ownerUserIds:task.ownerUserIds.filter(ownerId=>isEligibleTaskOwner(draftData.settings.rolePermissions,draftData.users.find(user=>user.id===ownerId),nextVessels))};
        const notices=buildTaskScopeChangeNotifications(
          draftData.users,
          previousNoticeTask?{task:previousNoticeTask,vessels:previousVessels}:null,
          {task:nextNoticeTask,vessels:nextVessels},
          liveUser.id,kind,liveUser.name,draftData.settings.rolePermissions,
        );
        draftData.notifications.unshift(...notices);
      });
      draftData.notifications=draftData.notifications.slice(0,1000);
      applied=true;
      persistedDraft=effectiveDraft;
      persistedUpdatedAt=at;
      const audited=withAudit(draftData,liveUser,wasCreating?'新增臨會/專題':'更新臨會/專題','meeting',id,`${effectiveDraft.subject.trim()}｜${scopeModeLabel(effectiveDraft.vesselScopeMode)}`);
      persistedRevision=audited.revision;
      return audited;
    }));
    if(!applied||!persistedDraft){
      savingRef.current=false;
      alert(failure);
      return;
    }
    setDraft({...persistedDraft,taskItems:persistedDraft.taskItems.length?persistedDraft.taskItems:[{id:uid('meeting-task-item'),description:'',categories:normalizeMeetingTaskCategoryList([],data.settings.meetingTaskCategories),distributeToVessels:false}]});
    setBaseMeetingUpdatedAt(persistedUpdatedAt);
    setBaseRevision(persistedRevision);
    setCreating(false);
    setSelectedId(id);
    setNotice(`✓ ${wasCreating?'臨會/專題已建立':'臨會/專題已保存'}`);
    window.setTimeout(()=>{savingRef.current=false;},0);
  };

  const counts = Object.fromEntries(statuses.map(status => [status, accessibleMeetings.filter(meeting => statusOf(meeting) === status).length])) as Record<TemporaryMeetingStatus, number>;
  const meetingVesselIds = (meeting: TemporaryMeeting) => {
    const saved = meeting.vessels.filter(id => visibleIds.has(id));
    if (saved.length) return saved;
    if (scopeModeOf(meeting) === 'all') return visibleVessels.map(vessel => vessel.id);
    if (scopeModeOf(meeting) === 'types') return visibleVessels.filter(vessel => (meeting.vesselTypeScopes || []).includes(vessel.shipType)).map(vessel => vessel.id);
    return saved;
  };
  const meetingTaskCount = (meetingId: string) => data.tasks.filter(task => task.sourceMeetingId === meetingId && taskVesselIds(task).some(id => visibleIds.has(id))).length;
  const selectedExportMeetings = accessibleMeetings.filter(meeting => meetingExportSelection.includes(meeting.id));
  const printableMeetings = accessibleMeetings.filter(meeting => printMeetingIds.includes(meeting.id));
  const toggleMeetingExport = (id: string) => setMeetingExportSelection(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const printMeetings = (mode: 'meetings' | 'register', requestedIds = meetingExportSelection) => {
    if (!canExportReports) return alert('目前角色未获授权导出会议资料');
    if (printInFlightRef.current || printMode) return alert('正在準備列印，請稍候');
    const allowedIds = requestedIds.filter(id => accessibleMeetings.some(meeting => meeting.id === id));
    if (mode === 'meetings' && !allowedIds.length) return alert('請先勾選至少一筆會議');
    setPrintMeetingIds(mode === 'meetings' ? allowedIds : []);
    setPrintMode(mode);
  };
  const printMeetingDetail = (meetingId: string) => printMeetings('meetings', [meetingId]);
  const creator = selected ? users[selected.createdBy] : undefined;
  const selectedTaskItemNumbers = new Map((selected ? meetingTaskItems(selected, data.tasks) : []).map((item, index) => [item.id, index + 1]));

  if (creating && !editable) return <section className="temporary-meeting-page"><div className="page-heading"><div><h1>臨會/專題</h1><p>目前身份沒有建立臨會/專題權限，已停止顯示先前的新增草稿。</p></div></div><div className="empty-state">目前沒有可編輯的臨會/專題草稿</div></section>;
  if (!creating && !selected) return <section className="temporary-meeting-page"><div className="page-heading"><div><h1>臨會/專題</h1><p>目前沒有可檢視的臨會/專題，或原選取會議已不在目前權限範圍。</p></div>{editable&&<div className="heading-actions no-print"><button className="btn primary" onClick={startNew}>＋ 新增臨會/專題</button></div>}</div><div className="empty-state">目前沒有可檢視的臨會/專題</div></section>;

  return <><section className="temporary-meeting-page meeting-screen">
    <div className="page-heading">
      <div><h1>臨會/專題</h1><p>建立突發議題會議，可按全部船舶、船舶類型或逐船設定範圍。</p></div>
      <div className="heading-actions no-print"><button className="btn ghost" onClick={() => setViewMode(viewMode === 'register' ? 'workspace' : 'register')}>{viewMode === 'register' ? '返回會議詳情' : '臨會/專題總清單'}</button>{editable?<button className="btn primary" onClick={startNew}>＋ 新增臨會/專題</button>:<span className="badge">操作員唯讀</span>}</div>
    </div>
    {viewMode === 'register' ? <section className="panel meeting-register">
      <div className="panel-title"><div><h2>臨會/專題總清單</h2><p className="muted">共 {accessibleMeetings.length} 筆，目前篩選顯示 {filtered.length} 筆{canExportReports ? `｜已選 ${selectedExportMeetings.length} 筆` : ''}</p></div>{canExportReports&&<div className="heading-actions no-print"><button className="btn small ghost" onClick={() => setMeetingExportSelection(Array.from(new Set([...meetingExportSelection, ...pagedMeetings.items.map(meeting => meeting.id)])))}>全選本頁</button><button className="btn small ghost" onClick={() => setMeetingExportSelection([])}>清空</button><button className="btn small primary" onClick={() => printMeetings('meetings')}>匯出所選會議 PDF</button><button className="btn small green" onClick={() => printMeetings('register')}>匯出總清單 PDF</button></div>}</div>
      <div className="meeting-register-filters no-print">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、人員、待辦、船型…" />
        <select aria-label="總清單會議狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
        <select aria-label="總清單會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
        <select aria-label="總清單船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
      </div>
      {filtered.length ? <div className="table-wrap"><table className="compact meeting-register-table"><thead><tr>{canExportReports&&<th className="no-print">選取</th>}<th>召開日期</th><th>狀態</th><th>會議主題</th><th>會議範圍</th><th>船舶</th><th>部門</th><th>與會人員／追蹤窗口／負責人</th><th>待辦</th><th>期限</th><th className="no-print">操作</th></tr></thead><tbody>{pagedMeetings.items.map(meeting => { const vesselIds = meetingVesselIds(meeting); const vesselNames = vesselIds.map(id => vesselDisplayName(vesselById[id])); return <tr key={meeting.id}>{canExportReports&&<td className="no-print"><input aria-label={`選取會議 ${meeting.subject}`} type="checkbox" checked={meetingExportSelection.includes(meeting.id)} onChange={() => toggleMeetingExport(meeting.id)}/></td>}<td>{meeting.meetingDate || '-'}</td><td><span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span></td><td><b>{meeting.subject}</b><RichTextContent compact className="muted" value={meeting.reason} fallback="未填召開緣由"/></td><td>{meetingScopeLabel(meeting)}</td><td title={vesselNames.join('、')}>{vesselIds.length} 艘<br/><span className="muted">{vesselNames.slice(0, 3).join('、')}{vesselNames.length > 3 ? '…' : ''}</span></td><td>{meeting.departments.join('、') || '-'}</td><td><b>與會：{peopleNames(meeting.participantUserIds)}</b><br/><span className="muted">追蹤：{peopleNames(meeting.trackingUserIds || [])}</span><br/><span className="muted">負責：{peopleNames(meeting.responsibleUserIds)}</span></td><td><span className="task-source-badge source-temporary">{meetingTaskCount(meeting.id)} 件</span></td><td>{meeting.expectedDate || '-'}</td><td className="no-print"><button className="btn small primary" onClick={() => selectMeeting(meeting)}>進入詳情</button></td></tr>; })}</tbody></table></div> : <div className="empty-state">目前沒有符合條件的臨會/專題</div>}
      <PaginationControls ariaLabel="臨會清單分頁" page={pagedMeetings.page} pageCount={pagedMeetings.pageCount} total={pagedMeetings.total} from={pagedMeetings.from} to={pagedMeetings.to} onPageChange={setMeetingPage}/>
    </section> : <div className="temporary-meeting-workspace">
      <aside className="meeting-column temporary-list-column">
        <div className="column-title"><div><h2>基本資訊清單</h2><span>{filtered.length} 筆</span></div>{editable&&<button className="btn small primary" onClick={startNew}>新增</button>}</div>
        <div className="temporary-list-tools">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、人員、待辦、船型…" />
          <select aria-label="會議狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <select aria-label="會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
          <select aria-label="船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
        </div>
        <div className="column-scroll">
          {pagedMeetings.items.map(meeting => <button key={meeting.id} className={`temporary-meeting-item ${!creating && selectedId === meeting.id ? 'active' : ''}`} onClick={() => selectMeeting(meeting)}>
            <span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span><b>{meeting.subject}</b>
            <small>{meeting.meetingDate}｜{meetingScopeLabel(meeting)}｜{meeting.departments.length} 部門</small><p>{richTextToPlainText(meeting.reason)||'尚未填寫召開緣由'}</p>
          </button>)}
          {!filtered.length && <div className="empty-state compact">目前沒有符合條件的臨會/專題</div>}
        </div>
        <PaginationControls compact ariaLabel="臨會清單分頁" page={pagedMeetings.page} pageCount={pagedMeetings.pageCount} total={pagedMeetings.total} from={pagedMeetings.from} to={pagedMeetings.to} onPageChange={setMeetingPage}/>
      </aside>

      <section className="meeting-column temporary-editor-column">
        <div className="column-title"><div><h2>{creating ? '新增臨會/專題' : draft.subject || '會議資料'}</h2><span>{editable?(creating ? '建立基本資訊與會議範圍' : '修改後請按保存變更'):'唯讀檢視'}</span></div><div className="heading-actions no-print">{canExportReports&&selected&&<button className="btn primary" onClick={() => printMeetingDetail(selected.id)}>導出本次會議 PDF</button>}{editable&&<button className="btn green" onClick={save}>{creating ? '建立會議' : '保存變更'}</button>}</div></div>
        <fieldset disabled={!editable} className={`column-scroll temporary-form ${!editable?'readonly-form':''}`} aria-readonly={!editable}>
          <div className="grid cols-3">
            <div className="field span-2"><label>會議主題 <span className="required-mark">*</span></label><input required aria-required="true" value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="例如：颱風避風臨時協調會" /></div>
            <div className="field"><label>狀態 <span className="required-mark">*</span></label><select required aria-required="true" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as TemporaryMeetingStatus })}>{statuses.map(status => <option key={status}>{status}</option>)}</select></div>
            <div className="field"><label>召開日期 <span className="required-mark">*</span></label><input required aria-required="true" type="date" value={draft.meetingDate} onChange={event => setDraft({ ...draft, meetingDate: event.target.value })} /></div>
            <div className="field"><label>預計完成日期 <span className="required-mark">*</span></label><input required aria-required="true" type="date" value={draft.expectedDate} onChange={event => setDraft({ ...draft, expectedDate: event.target.value })} /></div>
            <div className="field"><label>會議議題關注程度</label><select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select><small>同步至本會議待辦，不影響船舶看板關注程度</small></div><label className="aware-toggle meeting-morning-toggle"><input type="checkbox" checked={draft.includeInMorning} onChange={event=>setDraft({...draft,includeInMorning:event.target.checked})}/><span><b>納入早會</b><small>勾選後，本會議待辦才會進入早會討論與早會報告</small></span></label>
            <div className="field span-3"><label>召開緣由</label><RichTextEditor ariaLabel="召開緣由" readOnly={!editable} value={draft.reason} onChange={reason=>setDraft({...draft,reason})} placeholder="說明為何召開本次臨會/專題" /></div>
            <div className="field span-3"><label>決議／會議結論 <span className="required-mark">*</span></label><RichTextEditor ariaLabel="決議／會議結論" required readOnly={!editable} value={draft.resolution} onChange={resolution=>setDraft({...draft,resolution})} placeholder="記錄本次會議決議或結論" /></div>
            <div className="field span-3 meeting-task-items-editor">
              <div className="meeting-task-items-title"><label>待辦事項</label><button type="button" className="btn small primary" onClick={addTaskItem}>＋ 增加待辦事項</button></div>
              {draft.taskItems.map((item, index) => <div className="meeting-task-item" key={item.id}>
                <div><label htmlFor={`meeting-task-${item.id}`}>待辦事項 {index + 1}</label><button type="button" className="btn small ghost" onClick={() => removeTaskItem(item.id)}>移除此事項</button></div>
                <RichTextEditor id={`meeting-task-${item.id}`} ariaLabel={`待辦事項 ${index+1}`} readOnly={!editable} value={item.description} onChange={description=>updateTaskItem(item.id,description)} placeholder="填寫後保存，預設作為公司層決議待辦" />
                <div className="meeting-task-category-picker"><b>臨會/專題待辦分類</b><span>已選 {normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories).length}</span><div className="temporary-chip-grid">{data.settings.meetingTaskCategories.map(category=>{const checked=normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories).includes(category);return <label key={category} className={`meeting-task-category-chip ${checked?'selected':''}`}><input type="checkbox" checked={checked} onChange={()=>{const current=normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories);updateTaskItemCategories(item.id,checked?current.filter(value=>value!==category):[...current,category]);}}/><span>{category}</span></label>;})}</div></div>
                <label className="aware-toggle meeting-vessel-distribution-toggle"><input type="checkbox" checked={item.distributeToVessels===true} onChange={event=>toggleTaskItemDistribution(item.id,event.target.checked)}/><span><b>分派到涉及船舶單船跟蹤：</b><small>勾選後，該會議待辦會分派到所有涉及船舶並出現在單船待辦清單；各船分別更新進度，只有全部涉及船舶完成，該待辦才記為完成。未勾選則只在臨會/專題、我的待辦、待辦總表與已結案中流轉。</small></span></label>
              </div>)}
            </div>
          </div>

          <div className="temporary-picker meeting-scope-picker">
            <div className="temporary-picker-title"><b>涉會船舶範圍 <span className="required-mark">*</span></b><span>{resolvedVesselIds.length} 艘</span></div>
            <div className="meeting-scope-modes">
              {(['all', 'types', 'vessels'] as MeetingVesselScopeMode[]).map(mode => <button key={mode} type="button" className={`scope-mode-card ${draft.vesselScopeMode === mode ? 'active' : ''}`} aria-pressed={draft.vesselScopeMode === mode} onClick={() => setDraft(previous => ({ ...previous, vesselScopeMode: mode }))}><b>{scopeModeLabel(mode)}</b><small>{mode === 'all' ? '目前可見的所有船舶' : mode === 'types' ? '可同時選一個或多個船型' : '逐艘勾選特定船舶'}</small></button>)}
            </div>
            {draft.vesselScopeMode === 'all' && <div className="scope-result-note"><b>全部船舶</b><span>本次會議涵蓋目前可見的 {resolvedVesselIds.length} 艘船舶。</span></div>}
            {draft.vesselScopeMode === 'types' && <>
              <div className="temporary-picker-title scope-subtitle"><b>選擇船舶類型</b><span>已選 {draft.vesselTypeScopes.length} 類</span><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vesselTypeScopes: [...shipTypes] }))}>全選類型</button><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vesselTypeScopes: [] }))}>清空</button></div>
              <div className="vessel-type-scope-grid">{shipTypes.map(shipType => { const count = visibleVessels.filter(vessel => vessel.shipType === shipType).length; const active = draft.vesselTypeScopes.includes(shipType); return <button type="button" key={shipType} className={`vessel-type-scope ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => toggleVesselType(shipType)}><span className={`meeting-check ${active ? 'on' : ''}`}>{active ? '✓' : ''}</span><b>{shipType}</b><small>{count} 艘</small></button>; })}</div>
              <div className="scope-result-note"><b>實際範圍</b><span>{draft.vesselTypeScopes.length ? `${draft.vesselTypeScopes.join('、')}，共 ${resolvedVesselIds.length} 艘` : '請至少選擇一個船舶類型'}</span></div>
            </>}
            {draft.vesselScopeMode === 'vessels' && <>
              <div className="temporary-picker-title scope-subtitle"><b>逐船選擇</b><span>{draft.vessels.length} 艘</span><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vessels: visibleVessels.map(vessel => vessel.id) }))}>全選</button><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vessels: [] }))}>清空</button></div>
              <div className="temporary-chip-grid">{visibleVessels.map(vessel => <button type="button" key={vessel.id} className={`chip ${draft.vessels.includes(vessel.id) ? 'on' : ''}`} onClick={() => toggleVessel(vessel.id)}>{vesselDisplayName(vessel)}</button>)}</div>
            </>}
          </div>

          <div className="temporary-picker"><div className="temporary-picker-title"><b>涉及部門 <span className="required-mark">*</span></b><span>{draft.departments.length} 個</span></div><div className="temporary-chip-grid departments">{data.settings.departments.map(department => <button type="button" key={department} className={`chip ${draft.departments.includes(department) ? 'on' : ''}`} onClick={() => toggleDepartment(department)}>{department}</button>)}</div></div>
          <div className="meeting-people-section">
            <MeetingPeoplePicker label="與會人員" required users={meetingPeople} departments={data.settings.departments} selectedIds={draft.participantUserIds} onChange={participantUserIds => setDraft(previous => ({ ...previous, participantUserIds }))} />
            <MeetingPeoplePicker label="追蹤窗口" required users={meetingPeople} departments={data.settings.departments} selectedIds={draft.trackingUserIds} onChange={trackingUserIds => setDraft(previous => ({ ...previous, trackingUserIds }))} actions={<button type="button" className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, trackingUserIds: [...previous.participantUserIds] }))}>同與會人員</button>} />
            <MeetingPeoplePicker label="負責人" users={responsiblePeople} departments={data.settings.departments} selectedIds={draft.responsibleUserIds} onChange={responsibleUserIds => setDraft(previous => ({ ...previous, responsibleUserIds }))} />
          </div>
          {!creating && <section className="meeting-status-update">
            <div className="meeting-status-update-title"><div><h3>加入狀態記錄</h3><p>快速更新本次臨會／專題的最新進度；加入後請按「保存變更」。</p></div>{draft.latestStatus&&<span>最新：{draft.latestStatus}</span>}</div>
            <div className="quick-status-bar"><input aria-label="會議最新狀態" value={quickStatus} onChange={event=>setQuickStatus(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addStatus();}}} placeholder="快速輸入最新狀態…"/><button type="button" className="btn primary" onClick={addStatus}>加入狀態紀錄</button></div>
          </section>}
          {!creating && <section className="status-history meeting-status-history"><h3>狀態歷程</h3>{draft.statusLogs.length?draft.statusLogs.map(log=><article key={log.id}><b>{log.text}</b><small>{new Date(log.at).toLocaleString('zh-TW')}｜{log.by}</small>{canDeleteMeetingStatusLog(log)&&<button type="button" className="btn small ghost no-print" onClick={()=>deleteStatusLog(log.id)}>刪除記錄</button>}</article>):<p className="muted">尚無狀態紀錄</p>}</section>}
        </fieldset>
      </section>

      <aside className="meeting-column temporary-summary-column">
        <div className="column-title"><h2>會議狀態</h2></div>
        <div className="column-scroll">
          <div className="temporary-status-grid">{statuses.map(status => <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}><span>{status}</span><b>{counts[status]}</b></button>)}</div>
          <div className="summary-card blue"><h3>目前會議</h3><div className="summary-line"><span>狀態</span><b>{draft.status}</b></div><div className="summary-line"><span>範圍</span><b>{scopeModeLabel(draft.vesselScopeMode)}</b></div><div className="summary-line"><span>船舶</span><b>{resolvedVesselIds.length}</b></div><div className="summary-line"><span>部門</span><b>{draft.departments.length}</b></div><div className="summary-line"><span>與會人員</span><b>{draft.participantUserIds.length}</b></div><div className="summary-line"><span>追蹤窗口</span><b>{draft.trackingUserIds.length}</b></div><div className="summary-line"><span>負責人</span><b>{draft.responsibleUserIds.length}</b></div><div className="summary-line"><span>關注</span><b>{draft.priority}</b></div><div className="summary-line"><span>早會</span><b>{draft.includeInMorning?'納入':'不納入'}</b></div><div className="summary-line"><span>最新狀態</span><b>{draft.latestStatus||'尚無記錄'}</b></div></div>
          <div className="summary-card"><h3>建立資訊</h3><p>{selected ? new Date(selected.createdAt).toLocaleString() : '尚未建立'}</p><small>{creator ? `${creator.department}｜${creator.name}｜${roleLabel(creator.role)}` : '建立後顯示建立者'}</small></div>
          <div className="summary-card mint"><h3>關聯待辦事項</h3>{linkedTasks.length ? <div className="meeting-linked-tasks">{linkedTasks.map(task => <article key={task.id}><b>{taskVesselLabel(task, visibleVessels)}</b><small>船種：{taskShipTypeLabel(task, visibleVessels)}</small><RichTextContent compact value={task.description} fallback="尚未填寫事項內容"/><small>{task.sourceMeetingItemId && selectedTaskItemNumbers.get(task.sourceMeetingItemId) ? `待辦事項 ${selectedTaskItemNumbers.get(task.sourceMeetingItemId)}｜` : ''}{task.isClosed ? '已結案' : richTextToPlainText(task.status) || '待執行'}｜期限 {task.expectedDate || '未設定'}</small></article>)}</div> : <p>{draft.taskItems.some(item => !isRichTextEmpty(item.description)) ? '保存後每個事項會依合併船舶範圍建立一筆待辦。' : '尚未填寫待辦事項。'}</p>}</div>
          <div className="summary-card blue"><h3>待辦同步規則</h3><p>每個已填寫的待辦事項只建立一筆待辦；船舶欄會顯示「全部船舶」或合併船名，船種欄同步顯示全部或涉及類型。</p></div>
        </div>
      </aside>
    </div>}
    {notice && <div className="management-save-toast" role="status" aria-live="polite">{notice}</div>}
  </section>
  {printMode&&<section className="meeting-print print-only">
    {printMode==='meetings'&&printableMeetings.map(meeting=>{const items=meetingTaskItems(meeting,data.tasks);return <article className="meeting-print-page" key={meeting.id}><header><div><span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span><h1>{meeting.subject||'臨會／專題會議報告'}</h1><p>匯出時間：{new Date().toLocaleString('zh-TW')}｜匯出人：{currentUser.name}</p></div><b>臨會／專題</b></header><div className="meeting-print-meta"><div><small>召開日期</small><b>{meeting.meetingDate||'-'}</b></div><div><small>預計完成</small><b>{meeting.expectedDate||'-'}</b></div><div><small>關注程度</small><b>{meeting.priority}</b></div><div><small>會議範圍</small><b>{meetingScopeLabel(meeting)}</b></div><div><small>涉會船舶</small><b>{meetingVesselIds(meeting).length} 艘</b></div></div><div className="meeting-print-grid"><section className="meeting-print-section card-like"><h2>會議範圍</h2><p>{meetingPdfVesselSummary(meeting, visibleVessels)}</p></section><section className="meeting-print-section card-like"><h2>涉及部門</h2><p>{meeting.departments.join('、')||'未指定'}</p></section><section className="meeting-print-section card-like"><h2>與會人員</h2><p>{peopleNames(meeting.participantUserIds)}</p></section><section className="meeting-print-section card-like"><h2>追蹤窗口</h2><p>{peopleNames(meeting.trackingUserIds || [])}</p></section><section className="meeting-print-section card-like"><h2>負責人</h2><p>{peopleNames(meeting.responsibleUserIds)}</p></section></div><section className="meeting-print-section card-like wide"><h2>召開緣由</h2><RichTextContent value={meeting.reason} fallback="未填寫"/></section><section className="meeting-print-section card-like wide"><h2>決議／會議結論</h2><RichTextContent value={meeting.resolution} fallback="未填寫"/></section><section className="meeting-print-section card-like wide"><h2>待辦事項</h2>{items.length?<ol className="meeting-print-task-list">{items.map((item,index)=><li key={item.id}><span>待辦 {index+1}</span><RichTextContent value={item.description} fallback="未填寫"/><small>{normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories).join('、')}｜{item.distributeToVessels?'分派到涉及船舶單船跟蹤':'公司層決議待辦'}</small></li>)}</ol>:<p>尚無待辦事項</p>}</section><section className="meeting-print-section card-like wide meeting-print-status-history"><h2>狀態歷程</h2>{(meeting.statusLogs||[]).length?(meeting.statusLogs||[]).map(log=><article key={log.id}><b>{log.text}</b><small>{new Date(log.at).toLocaleString('zh-TW')}｜{log.by}</small></article>):<p>尚無狀態紀錄</p>}</section></article>;})}
    {printMode==='register'&&<article className="meeting-print-register"><header><h1>臨會／專題總清單</h1><p>匯出時間：{new Date().toLocaleString('zh-TW')}｜匯出人：{currentUser.name}｜共 {accessibleMeetings.length} 筆</p></header><table><thead><tr><th>召開日期</th><th>狀態</th><th>主題</th><th>範圍</th><th>船舶</th><th>部門</th><th>與會人員／追蹤窗口／負責人</th><th>待辦</th><th>期限</th></tr></thead><tbody>{accessibleMeetings.map(meeting=>{return <tr key={meeting.id}><td>{meeting.meetingDate||'-'}</td><td>{statusOf(meeting)}</td><td><b>{meeting.subject||'-'}</b><br/>{richTextToPlainText(meeting.reason)||'未填召開緣由'}</td><td>{meetingScopeLabel(meeting)}</td><td>{meetingPdfVesselSummary(meeting, visibleVessels)}</td><td>{meeting.departments.join('、')||'-'}</td><td>{peopleNames(meeting.participantUserIds)}<br/>追蹤：{peopleNames(meeting.trackingUserIds || [])}<br/>負責：{peopleNames(meeting.responsibleUserIds)}</td><td>{meetingTaskCount(meeting.id)} 件</td><td>{meeting.expectedDate||'-'}</td></tr>;})}</tbody></table></article>}
  </section>}
  </>;
}
