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
import { formatTaipeiDateTime } from './taipeiTime';
import { canAccessAllVessels, hasPermission, isEligibleTaskOwner } from './permissions';
import { buildTaskNotificationsForVessels, buildTaskScopeChangeNotifications, canCancelInternalControl, FLOW_INTERNAL_CONTROL_REMINDER, trustedClosureDate } from './taskWorkflow';
import { meetingDecisionCompletionSummary, planUnlinkedMeetingDecisionTransition, reconcileMeetingTasks, meetingTaskClosedLinkConflict, meetingTaskItems, meetingTaskInternalControlTransitionRequired, meetingTaskLinkResolutionConflict, meetingTaskNotificationEvents, unchangedMeetingTaskItemIds } from './meetingTaskWorkflow';
import { canEditTemporaryMeetings, meetingAppliesToUser } from './meetingAccess';
import { vesselDisplayName } from './vesselDisplay';
import { taskHasVessel, taskShipTypeLabel, taskVesselIds, taskVesselLabel } from './taskVesselScope';
import { taskIsClosedForScope } from './taskVesselProgress';
import { canonicalizeMeetingTaskItemIds } from './meetingTaskItemIds';
import { sortRecordsNewestCreated } from './recordSorting';
import MeetingPeoplePicker from './MeetingPeoplePicker';
import { paginateItems } from './pagination';
import PaginationControls from './PaginationControls';
import { meetingPdfDocumentTitle, meetingPdfVesselSummary } from './meetingPdf';
import { addMeetingStatusRecord, sanitizeMeetingStatusMutation } from './meetingStatusWorkflow';
import RichTextEditor from './RichTextEditor';
import RichTextContent from './RichTextContent';
import { richTextToPlainText, isRichTextEmpty } from './richText';
import { normalizeMeetingTaskCategoryList } from './taskCategories';
import { meetingCreationLockKey, meetingEditLockKey } from './exclusiveItemEditLock';
import {
  meetingBelongsToRegisterList,
  meetingRegisterAriaSort,
  nextMeetingRegisterSort,
  sortMeetingRegisterEntries,
} from './meetingRegister';
import type { MeetingRegisterListMode, MeetingRegisterSortKey, MeetingRegisterSortState } from './meetingRegister';

type Props = {
  data: AppData;
  visibleVessels: Vessel[];
  currentUser: UserAccount;
  canExportReports: boolean;
  canCloseTasks: boolean;
  onOpenDecisionTask: (taskId:string)=>Promise<unknown>;
  onTransitionDecisionTask: (taskId:string,transition:'complete'|'reopen',closedDate?:string,closureStatus?:string)=>Promise<boolean>;
  setData: Dispatch<SetStateAction<AppData>>;
  commit: (mutate: (draft: AppData) => void, action: string, entityType: string, entityId: string, detail: string) => void;
  claimItemLease: (sectionKey:string,label:string)=>Promise<AppData|null>;
  requireItemLease: (sectionKey:string)=>boolean;
  releaseItemLease: (sectionKey:string)=>Promise<boolean>;
  runDurableRelatedMutation: (sectionKey:string,label:string,apply:()=>boolean)=>Promise<boolean>;
  activeItemLeaseKey: string;
};

type MeetingDraft = Pick<
  TemporaryMeeting,
  'subject' | 'meetingDate' | 'vessels' | 'reason' | 'departments' | 'participantUserIds' | 'trackingUserIds' | 'responsibleUserIds' | 'resolution' | 'taskItems' | 'expectedDate' | 'completedDate' | 'completedBy' | 'priority' | 'isAbnormal' | 'isInternalControl'
> & {
  status: TemporaryMeetingStatus;
  vesselScopeMode: MeetingVesselScopeMode;
  vesselTypeScopes: string[];
  includeInMorning: boolean;
  latestStatus: string;
  statusLogs: StatusLog[];
};

type ScopeFilter = 'any' | MeetingVesselScopeMode;
type MeetingDecisionClosureTarget =
  | { kind:'linked'; taskId:string; label:string }
  | { kind:'unlinked'; meetingId:string; itemId:string; label:string };

const statuses: TemporaryMeetingStatus[] = ['待召開', '追蹤中', '已完成'];
const statusOf = (meeting: TemporaryMeeting): TemporaryMeetingStatus => meeting.status || '追蹤中';
const askMeetingCompletionDate = (current = todayDate()) => {
  const value = window.prompt('請選擇完成日期（YYYY-MM-DD）', current || todayDate());
  if (value === null) return null;
  const normalized = trustedClosureDate(value,'');
  if (!normalized) {
    alert('完成日期必須是真實的 YYYY-MM-DD 日曆日期');
    return null;
  }
  return normalized;
};
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
  expectedDate: '',
  completedDate: '',
  completedBy: '',
  priority: '中',
  isAbnormal: false,
  isInternalControl: false,
  includeInMorning: false,
  latestStatus: '',
  statusLogs: [],
});

const draftFrom = (meeting?: TemporaryMeeting, tasks = [] as AppData['tasks'], meetingTaskCategories = [] as string[]): MeetingDraft => meeting ? {
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
  taskItems: meetingTaskItems(meeting, tasks, meetingTaskCategories).length ? meetingTaskItems(meeting, tasks, meetingTaskCategories) : [{ id: uid('meeting-task-item'), description: '', categories: [], distributeToVessels: false }],
  expectedDate: meeting.expectedDate,
  completedDate: meeting.completedDate || '',
  completedBy: meeting.completedBy || '',
  priority: meeting.priority,
  isAbnormal: meeting.isAbnormal === true || meeting.isInternalControl === true,
  isInternalControl: meeting.isInternalControl === true,
  includeInMorning: meeting.includeInMorning === true,
  latestStatus: meeting.latestStatus || '',
  statusLogs: [...(meeting.statusLogs || [])],
} : blankDraft();

export default function TemporaryMeetingsPage({ data, visibleVessels, currentUser, canExportReports, canCloseTasks, onOpenDecisionTask, onTransitionDecisionTask, setData, commit, claimItemLease, requireItemLease, releaseItemLease, runDurableRelatedMutation, activeItemLeaseKey }: Props) {
  const canViewAllMeetings = currentUser.role === 'owner' || currentUser.role === 'admin' || hasPermission(data.settings.rolePermissions, currentUser, 'viewAllVessels');
  const editable = canEditTemporaryMeetings(data.settings.rolePermissions, currentUser);
  const canDeleteMeetings = (currentUser.role === 'owner' || currentUser.role === 'admin') && editable;
  const visibleIds = new Set(visibleVessels.map(vessel => vessel.id));
  const visibleVesselKey = [...visibleIds].sort().join('\u0000');
  const appliesToUser = (meeting: TemporaryMeeting) => meetingAppliesToUser(meeting, visibleVessels, canViewAllMeetings, currentUser.id);
  const accessibleMeetings = sortRecordsNewestCreated(data.meetings.filter(appliesToUser));
  const initialMeeting = accessibleMeetings[0];
  const [selectedId, setSelectedId] = useState(initialMeeting?.id || '');
  const [creating, setCreating] = useState(false);
  const [creatingId,setCreatingId]=useState('');
  const [draft, setDraft] = useState<MeetingDraft>(() => draftFrom(initialMeeting, data.tasks, data.settings.meetingTaskCategories));
  const [baseMeetingUpdatedAt,setBaseMeetingUpdatedAt]=useState(initialMeeting?.updatedAt||'');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部' | TemporaryMeetingStatus>('全部');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('any');
  const [typeFilter, setTypeFilter] = useState('all');
  const [meetingPage, setMeetingPage] = useState(1);
  const [viewMode, setViewMode] = useState<'workspace' | 'register'>('workspace');
  const [registerListMode,setRegisterListMode]=useState<MeetingRegisterListMode>('unfinished');
  const [registerSort,setRegisterSort]=useState<MeetingRegisterSortState>({key:'meetingDate',direction:'desc'});
  const [meetingExportSelection, setMeetingExportSelection] = useState<string[]>([]);
  const [printMeetingIds, setPrintMeetingIds] = useState<string[]>([]);
  const [printMode, setPrintMode] = useState<'meetings' | 'register' | ''>('');
  const [printRegisterListMode,setPrintRegisterListMode]=useState<MeetingRegisterListMode>('unfinished');
  const [notice, setNotice] = useState('');
  const [quickStatus, setQuickStatus] = useState('');
  const [editingSessionActive, setEditingSessionActive] = useState(false);
  const [lifecycleBusy,setLifecycleBusy]=useState(false);
  const [decisionClosureTarget,setDecisionClosureTarget]=useState<MeetingDecisionClosureTarget|null>(null);
  const [decisionClosureDate,setDecisionClosureDate]=useState(todayDate());
  const [decisionClosureStatus,setDecisionClosureStatus]=useState('');
  const savingRef = useRef(false);
  const editBaselineRef = useRef<MeetingDraft | null>(null);
  const saveReachedLocalStateRef = useRef(false);
  const printInFlightRef = useRef(false);
  const liveDataRef=useRef(data);
  liveDataRef.current=data;
  const activeItemLeaseKeyRef=useRef(activeItemLeaseKey);
  activeItemLeaseKeyRef.current=activeItemLeaseKey;

  const selected = accessibleMeetings.find(meeting => meeting.id === selectedId);
  const editorWritable=Boolean(
    editingSessionActive && (creating
      ?creatingId&&activeItemLeaseKey===meetingCreationLockKey(creatingId)
      :editable&&selected&&activeItemLeaseKey===meetingEditLockKey(selected.id)
    )
  );
  const linkedTasks = selected ? data.tasks.filter(task => task.sourceMeetingId === selectedId && taskVesselIds(task).some(id => visibleIds.has(id))) : [];
  const selectedCompletionSummary=selected?meetingDecisionCompletionSummary(selected,data.tasks):null;
  const selectedDecisionStateByItemId=new Map(selectedCompletionSummary?.items.map(item=>[item.item.id,item])||[]);
  const persistedInternalControlTasks = selected ? data.tasks.filter(task => task.sourceMeetingId === selected.id && task.isInternalControl) : [];
  const persistedInternalControlVesselIds = new Set([
    ...(selected?.isInternalControl ? selected.vessels : []),
    ...persistedInternalControlTasks.flatMap(task => taskVesselIds(task)),
  ]);
  const canCancelSelectedInternalControl = persistedInternalControlVesselIds.size === 0 || (
    data.vessels.filter(vessel => persistedInternalControlVesselIds.has(vessel.id)).length === persistedInternalControlVesselIds.size
    && data.vessels.filter(vessel => persistedInternalControlVesselIds.has(vessel.id)).every(vessel => canCancelInternalControl(currentUser, vessel))
  );
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

  const registerMeetings=accessibleMeetings.filter(meeting=>meetingBelongsToRegisterList(statusOf(meeting),registerListMode));
  const filterSourceMeetings=viewMode==='register'?registerMeetings:accessibleMeetings;
  const filtered = filterSourceMeetings.filter(meeting => {
    const q = query.trim().toLowerCase();
    if (statusFilter !== '全部' && statusOf(meeting) !== statusFilter) return false;
    if (scopeFilter !== 'any' && scopeModeOf(meeting) !== scopeFilter) return false;
    if (typeFilter !== 'all') {
      if (scopeModeOf(meeting)==='all') return !q || `${meeting.subject} ${richTextToPlainText(meeting.reason)} ${richTextToPlainText(meeting.resolution)} ${meetingTaskItems(meeting, data.tasks, data.settings.meetingTaskCategories).map(item => richTextToPlainText(item.description)).join(' ')} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
      if (!meetingVesselTypes(meeting).includes(typeFilter)) return false;
    }
    return !q || `${meeting.subject} ${richTextToPlainText(meeting.reason)} ${richTextToPlainText(meeting.resolution)} ${[...meeting.participantUserIds, ...(meeting.trackingUserIds || []), ...meeting.responsibleUserIds].map(id => users[id]?.name || '').join(' ')} ${meetingTaskItems(meeting, data.tasks, data.settings.meetingTaskCategories).map(item => richTextToPlainText(item.description)).join(' ')} ${meeting.meetingDate} ${meetingScopeLabel(meeting)}`.toLowerCase().includes(q);
  });
  useEffect(() => setMeetingPage(1), [query, statusFilter, scopeFilter, typeFilter]);

  const resolvedVesselIds = useMemo(() => {
    if (draft.vesselScopeMode === 'all') return visibleVessels.map(vessel => vessel.id);
    if (draft.vesselScopeMode === 'types') return visibleVessels.filter(vessel => draft.vesselTypeScopes.includes(vessel.shipType)).map(vessel => vessel.id);
    return draft.vessels.filter(id => visibleVessels.some(vessel => vessel.id === id));
  }, [draft.vesselScopeMode, draft.vesselTypeScopes, draft.vessels, visibleVessels]);
  const responsiblePeople = useMemo(() => {
    const scopeVessels = resolvedVesselIds.map(id => data.vessels.find(vessel => vessel.id === id)).filter((vessel): vessel is Vessel => Boolean(vessel));
    return scopeVessels.length ? meetingPeople.filter(user => isEligibleTaskOwner(data.settings.rolePermissions, user, scopeVessels)) : meetingPeople;
  }, [meetingPeople, resolvedVesselIds, data.vessels, data.settings.rolePermissions]);

  const cleanTaskItems = (items: MeetingTaskItem[]) => canonicalizeMeetingTaskItemIds(items.map((item,index)=>({
    id:item.id||`meeting-task-item-${index + 1}`,
    description:item.description.trim(),
    categories:normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories),
    distributeToVessels:item.distributeToVessels===true,
    isClosed:item.isClosed===true,
    closedDate:item.isClosed===true&&item.closedDate?item.closedDate:undefined,
    closedBy:item.isClosed===true&&item.closedBy?item.closedBy:undefined,
  })),'meeting-task-item').filter(item => !isRichTextEmpty(item.description));

  useEffect(() => {
    if (creating && !editable) {
      const next = accessibleMeetings[0];
      setEditingSessionActive(false);
      editBaselineRef.current=null;
      saveReachedLocalStateRef.current=false;
      setCreating(false);
      setSelectedId(next?.id || '');
      setDraft(draftFrom(next, data.tasks, data.settings.meetingTaskCategories));
      setBaseMeetingUpdatedAt(next?.updatedAt||'');
      return;
    }
    if (creating) return;
    const meeting = accessibleMeetings.find(item => item.id === selectedId);
    if (meeting) {
      setDraft(draftFrom(meeting, data.tasks, data.settings.meetingTaskCategories));
      setBaseMeetingUpdatedAt(meeting.updatedAt||'');
      return;
    }
    const next = accessibleMeetings[0];
    setSelectedId(next?.id || '');
    setDraft(draftFrom(next, data.tasks, data.settings.meetingTaskCategories));
    setBaseMeetingUpdatedAt(next?.updatedAt||'');
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
    const originalTitle=document.title;
    const singleMeeting=printMode==='meetings'&&printMeetingIds.length===1
      ?accessibleMeetings.find(meeting=>meeting.id===printMeetingIds[0])
      :undefined;
    if(singleMeeting)document.title=meetingPdfDocumentTitle(singleMeeting.subject,singleMeeting.meetingDate||todayDate());
    document.body.classList.add('printing-meetings', modeClass);
    let cleaned = false;
    let frame = 0;
    let fallback = 0;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      document.title=originalTitle;
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

  const viewMeeting = (meeting: TemporaryMeeting) => {
    if(editingSessionActive){
      if(!creating&&selectedId===meeting.id)return;
      alert('請先保存或取消目前編輯，再查看其他會議');
      return;
    }
    const nextDraft=draftFrom(meeting,data.tasks,data.settings.meetingTaskCategories);
    editBaselineRef.current=null;
    saveReachedLocalStateRef.current=false;
    setEditingSessionActive(false);
    setCreating(false);
    setCreatingId('');
    setSelectedId(meeting.id);
    setDraft(nextDraft);
    setBaseMeetingUpdatedAt(meeting.updatedAt||'');
    setQuickStatus('');
    setViewMode('workspace');
  };
  const beginEditing = async (meeting: TemporaryMeeting) => {
    if(!editable)return alert('修改臨會/專題需同時具備「新增及修改臨會/專題」與「查看全部船舶」權限');
    let fresh=meeting;
    let snapshot=data;
    if(activeItemLeaseKey!==meetingEditLockKey(meeting.id)){
      const latest=await claimItemLease(meetingEditLockKey(meeting.id),`臨會/專題｜${meeting.subject||meeting.id}`);
      if(!latest)return;
      const latestMeeting=latest.meetings.find(item=>item.id===meeting.id);
      if(!latestMeeting){await releaseItemLease(meetingEditLockKey(meeting.id));return;}
      snapshot=latest;
      fresh=latestMeeting;
    }
    const nextDraft=draftFrom(fresh, snapshot.tasks, snapshot.settings.meetingTaskCategories);
    editBaselineRef.current=structuredClone(nextDraft);
    saveReachedLocalStateRef.current=false;
    setEditingSessionActive(true);
    setCreating(false);
    setCreatingId('');
    setSelectedId(fresh.id);
    setDraft(nextDraft);
    setBaseMeetingUpdatedAt(fresh.updatedAt||'');
    setQuickStatus('');
    setViewMode('workspace');
  };
  const startNew = async () => {
    if (!editable) return alert('修改臨會/專題需同時具備「新增及修改臨會/專題」與「查看全部船舶」權限');
    if(selected&&activeItemLeaseKey===meetingEditLockKey(selected.id)&&!await releaseItemLease(meetingEditLockKey(selected.id)))return;
    const draftId=uid('meet');
    const snapshot=await claimItemLease(meetingCreationLockKey(draftId),'新增臨會/專題草稿');
    if(!snapshot)return;
    const nextDraft=blankDraft();
    editBaselineRef.current=structuredClone(nextDraft);
    saveReachedLocalStateRef.current=false;
    setEditingSessionActive(true);
    setCreating(true);
    setCreatingId(draftId);
    setSelectedId('');
    setDraft(nextDraft);
    setBaseMeetingUpdatedAt('');
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
    if (!editorWritable) return alert('請先取得此臨會/專題的編輯權');
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

  const draftCompletionSummary = () => meetingDecisionCompletionSummary({
    id: creating ? creatingId : selectedId,
    taskItems: cleanTaskItems(draft.taskItems),
    vessels:[...resolvedVesselIds],
    vesselScopeMode:draft.vesselScopeMode,
    vesselTypeScopes:[...draft.vesselTypeScopes],
    isInternalControl:draft.isInternalControl,
  }, data.tasks);

  const incompleteMeetingMessage = (summary: ReturnType<typeof meetingDecisionCompletionSummary>) => summary.hasLinkConflict
    ? '會議待辦關聯缺少、重複、孤立或與會議範圍不一致，請先保存修復並確認每筆待辦狀態後再結案會議'
    : `尚有 ${summary.totalCount-summary.completedCount} 筆決議待辦未完成，請先逐筆完成後再結案會議`;

  const setMeetingStatus = (status: TemporaryMeetingStatus) => {
    if (status === '已完成' && draft.status !== '已完成') {
      const summary=draftCompletionSummary();
      if(!summary.allCompleted)return alert(incompleteMeetingMessage(summary));
      const completedDate = askMeetingCompletionDate(draft.completedDate || todayDate());
      if (!completedDate) return;
      setDraft(previous => ({ ...previous, status, completedDate, completedBy: currentUser.id }));
      return;
    }
    setDraft(previous => status === '已完成'
      ? { ...previous, status, completedDate: previous.completedDate || todayDate(), completedBy: previous.completedBy || currentUser.id }
      : { ...previous, status, completedDate: '', completedBy: '' });
  };

  const setMeetingCompletedDate = (completedDate: string) => {
    if(completedDate&&draft.status!=='已完成'){
      const summary=draftCompletionSummary();
      if(!summary.allCompleted)return alert(incompleteMeetingMessage(summary));
    }
    setDraft(previous => completedDate
      ? { ...previous, status: '已完成', completedDate, completedBy: previous.completedBy || currentUser.id }
      : { ...previous, status: previous.status === '已完成' ? '追蹤中' : previous.status, completedDate: '', completedBy: '' });
  };

  const cancelEditing = async () => {
    if (!editorWritable) return;
    if (savingRef.current) return alert('正在保存臨會/專題，請等待目前操作完成');
    if (saveReachedLocalStateRef.current) {
      alert('本次修改已進入本機待同步狀態。為避免誤刪可能已上傳但尚未回傳確認的資料，不能直接取消；請點擊「保存並退出編輯」重新完成雲端確認。');
      return;
    }
    if (!window.confirm('確定放棄本次尚未保存的修改並退出編輯？')) return;
    const wasCreating=creating;
    const id=wasCreating?creatingId:selectedId;
    const baseline=editBaselineRef.current;
    if(!id)return alert('編輯識別碼已失效，未放棄任何資料');
    if(!wasCreating&&(!selected||!baseline))return alert('找不到進入編輯前的資料，為避免誤刪，本次未退出');
    const sectionKey=wasCreating?meetingCreationLockKey(id):meetingEditLockKey(id);
    if(!await releaseItemLease(sectionKey))return;
    setEditingSessionActive(false);
    setCreating(false);
    setCreatingId('');
    saveReachedLocalStateRef.current=false;
    if(wasCreating){
      const next=accessibleMeetings[0];
      setSelectedId(next?.id||'');
      setDraft(draftFrom(next,data.tasks,data.settings.meetingTaskCategories));
      setBaseMeetingUpdatedAt(next?.updatedAt||'');
    }else{
      setSelectedId(selected!.id);
      setDraft(structuredClone(baseline));
      setBaseMeetingUpdatedAt(selected!.updatedAt||'');
    }
    editBaselineRef.current=null;
    setQuickStatus('');
    setNotice('✓ 已取消修改並退出編輯');
  };

  const save = async () => {
    if (!editorWritable) return alert('請先取得此臨會/專題的編輯權');
    if (savingRef.current) return;
    if (!draft.subject.trim()) return alert('請填寫會議主題');
    if (!statuses.includes(draft.status)) return alert('請選擇會議狀態');
    if (!draft.meetingDate) return alert('請選擇召開日期');
    if (isRichTextEmpty(draft.reason)) return alert('請填寫召開緣由');
    if (!draft.departments.length) return alert('請至少選擇一個涉及部門');
    if (!draft.participantUserIds.length) return alert('請至少選擇一位與會人員');
    if (!draft.trackingUserIds.length) return alert('請至少選擇一位追蹤窗口');
    const preflightCompletionSummary=draftCompletionSummary();
    if(draft.status==='已完成'&&!preflightCompletionSummary.allCompleted)return alert(incompleteMeetingMessage(preflightCompletionSummary));
    savingRef.current = true;
    const wasCreating=creating;
    const id = wasCreating ? creatingId : selectedId;
    if(!id){savingRef.current=false;return alert('新增會議草稿識別碼已失效，請重新開始');}
    const sectionKey=wasCreating?meetingCreationLockKey(id):meetingEditLockKey(id);
    if(!requireItemLease(sectionKey)){savingRef.current=false;return;}
    const completionFields = draft.status === '已完成'
      ? { completedDate: draft.completedDate || todayDate(), completedBy: draft.completedBy || currentUser.id }
      : { completedDate: '', completedBy: '' };
    const requestedDraft: MeetingDraft = {
      ...draft,
      ...completionFields,
      vesselTypeScopes: draft.vesselScopeMode === 'types' ? [...draft.vesselTypeScopes] : [],
      vessels: [...resolvedVesselIds],
      taskItems: cleanTaskItems(draft.taskItems),
    };
    let applied=false;
    let failure='會議已變更或權限已更新，請重新整理後再試';
    let persistedDraft:MeetingDraft|undefined;
    let persistedUpdatedAt='';
    let attempted=false;
    const apply=()=>{
      attempted=true;
      flushSync(()=>setData(prev=>{
      const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
      if(!liveUser){failure='登入身份已失效，請重新登入';return prev;}
      if(!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)){failure='您已無權修改臨會/專題';return prev;}
      const canViewAll=liveUser.role==='owner'||liveUser.role==='admin'||hasPermission(prev.settings.rolePermissions,liveUser,'viewAllVessels');
      const liveVisibleVessels=prev.vessels.filter(vessel=>vessel.isActive&&(
        canViewAll||vessel.assignedUserIds.includes(liveUser.id)||liveUser.managedVesselIds.includes(vessel.id)
      ));
      const allowedScopeModes:MeetingVesselScopeMode[]=['all','types','vessels'];
      if(!allowedScopeModes.includes(requestedDraft.vesselScopeMode)){failure='涉船範圍模式無效，請重新選擇';return prev;}
      const liveVesselIds=requestedDraft.vesselScopeMode==='all'
        ?liveVisibleVessels.map(vessel=>vessel.id)
        :requestedDraft.vesselScopeMode==='types'
          ?liveVisibleVessels.filter(vessel=>requestedDraft.vesselTypeScopes.includes(vessel.shipType)).map(vessel=>vessel.id)
          :requestedDraft.vessels.filter(id=>liveVisibleVessels.some(vessel=>vessel.id===id));
      const validShipTypes=new Set(liveVisibleVessels.map(vessel=>vessel.shipType));
      if(requestedDraft.vesselScopeMode==='types'&&requestedDraft.vesselTypeScopes.some(shipType=>!validShipTypes.has(shipType))){failure='涉船船種範圍無效，請重新選擇';return prev;}
      if(requestedDraft.vesselScopeMode==='vessels'&&liveVesselIds.length!==requestedDraft.vessels.length){failure='涉船範圍權限已變更，請重新選擇';return prev;}
      const liveScopeVessels=liveVisibleVessels.filter(vessel=>liveVesselIds.includes(vessel.id));
      if(liveScopeVessels.length&&!canAccessAllVessels(prev.settings.rolePermissions,liveUser,liveScopeVessels)){failure='必須具備全部涉船範圍權限才能保存會議';return prev;}
      const invalidParticipant=requestedDraft.participantUserIds.some(id=>!prev.users.some(user=>user.id===id&&user.isActive&&user.role!=='vessel'));
      if(invalidParticipant){failure='與會人員已停用或不存在，請重新選擇';return prev;}
      const invalidTracking=requestedDraft.trackingUserIds.some(id=>!prev.users.some(user=>user.id===id&&user.isActive&&user.role!=='vessel'));
      if(invalidTracking){failure='追蹤窗口已停用或不存在，請重新選擇';return prev;}
      const invalidResponsible=requestedDraft.responsibleUserIds.some(id=>liveScopeVessels.length
        ? !isEligibleTaskOwner(prev.settings.rolePermissions,prev.users.find(user=>user.id===id),liveScopeVessels)
        : !prev.users.some(user=>user.id===id&&user.isActive&&user.role!=='vessel'));
      if(invalidResponsible){failure='负责人已停用或不具备全部涉船范围权限，请重新选择';return prev;}
      const liveMeeting=prev.meetings.find(item=>item.id===id);
      if(wasCreating&&liveMeeting){failure='會議識別碼已存在，請重新建立';return prev;}
      if(!wasCreating&&(!liveMeeting||!meetingAppliesToUser(liveMeeting,liveVisibleVessels,canViewAll,liveUser.id))){failure='會議已被刪除或不再可存取，未保存任何變更';return prev;}
      if(!wasCreating&&liveMeeting!.updatedAt!==baseMeetingUpdatedAt){failure='會議已由其他操作更新，為避免覆蓋最新內容，本次未保存';return prev;}

      const at=nowIso();
      const trustedStatus=sanitizeMeetingStatusMutation(requestedDraft.statusLogs,liveMeeting?.statusLogs||[],liveUser,at,()=>uid('meeting-log'));
      if(!trustedStatus.ok){failure='會議狀態歷程包含未授權刪除、既有紀錄改寫或無效新增，本次未保存';return prev;}
      const previousCompleted=Boolean(liveMeeting&&statusOf(liveMeeting)==='已完成');
      const trustedCompletion=requestedDraft.status==='已完成'
        ?{completedDate:trustedClosureDate(requestedDraft.completedDate,todayDate()),completedBy:previousCompleted?(liveMeeting?.completedBy||liveUser.id):liveUser.id}
        :{completedDate:'',completedBy:''};
      const effectiveDraft={
        ...requestedDraft,
        ...trustedCompletion,
        vessels:liveVesselIds,
        vesselTypeScopes:requestedDraft.vesselScopeMode==='types'?Array.from(new Set(requestedDraft.vesselTypeScopes)):[],
        isAbnormal:requestedDraft.isAbnormal||requestedDraft.isInternalControl,
        statusLogs:trustedStatus.logs,
        latestStatus:trustedStatus.latestStatus,
      };
      const completionSummary=meetingDecisionCompletionSummary({
        id,
        taskItems:effectiveDraft.taskItems,
        vessels:effectiveDraft.vessels,
        vesselScopeMode:effectiveDraft.vesselScopeMode,
        vesselTypeScopes:effectiveDraft.vesselTypeScopes,
        isInternalControl:effectiveDraft.isInternalControl,
      },prev.tasks);
      if(effectiveDraft.status==='已完成'&&!completionSummary.allCompleted){failure=incompleteMeetingMessage(completionSummary);return prev;}
      const lifecycleStatusText=effectiveDraft.status==='已完成'&&(!liveMeeting||statusOf(liveMeeting)!=='已完成')
        ?'會議已結案'
        :liveMeeting&&statusOf(liveMeeting)==='已完成'&&effectiveDraft.status!=='已完成'
          ?'會議重新開啟'
          :'';
      if(lifecycleStatusText){
        effectiveDraft.statusLogs=[{id:uid('meeting-log'),at,by:liveUser.name,byUserId:liveUser.id,text:lifecycleStatusText},...effectiveDraft.statusLogs];
        effectiveDraft.latestStatus=lifecycleStatusText;
      }
      const previousMeetingItems=liveMeeting?meetingTaskItems(liveMeeting,prev.tasks,prev.settings.meetingTaskCategories):[];
      if(meetingTaskLinkResolutionConflict({tasks:prev.tasks,meetingId:id,nextItems:effectiveDraft.taskItems,previousItems:previousMeetingItems})){
        failure='既有會議待辦的父事項關聯損壞或不明確，為避免遺失歷史，本次未保存';return prev;
      }
      if(meetingTaskClosedLinkConflict({
        tasks:prev.tasks,meetingId:id,nextVesselIds:effectiveDraft.vessels,nextItems:effectiveDraft.taskItems,previousItems:previousMeetingItems,
        nextVesselScopeMode:effectiveDraft.vesselScopeMode,nextVesselTypeScopes:effectiveDraft.vesselTypeScopes,nextIsInternalControl:effectiveDraft.isInternalControl,
      })){failure='已結案會議待辦與新的涉船範圍、內部管控或分船設定衝突；請保留原設定或另建新事項';return prev;}
      const linkedInternalControlTasks=prev.tasks.filter(task=>task.sourceMeetingId===id&&(task.isInternalControl||liveMeeting?.isInternalControl)&&!taskIsClosedForScope(task,taskVesselIds(task)));
      const nextVesselIdSet=new Set(effectiveDraft.vessels);
      const nextMeetingItemIds=new Set(effectiveDraft.taskItems.map(item=>item.id));
      const parentAuthoritativeTaskTransition=Boolean(liveMeeting?.isInternalControl&&linkedInternalControlTasks.some(task=>!task.isInternalControl&&(
        !effectiveDraft.isInternalControl||taskVesselIds(task).some(vesselId=>!nextVesselIdSet.has(vesselId))||!task.sourceMeetingItemId||!nextMeetingItemIds.has(task.sourceMeetingItemId)
      )));
      const meetingInternalControlTransition=Boolean(liveMeeting?.isInternalControl&&(
        !effectiveDraft.isInternalControl||liveMeeting.vessels.some(vesselId=>!nextVesselIdSet.has(vesselId))
      ));
      const taskInternalControlTransition=meetingTaskInternalControlTransitionRequired({
        tasks:prev.tasks,meetingId:id,nextVesselIds:effectiveDraft.vessels,nextItemIds:effectiveDraft.taskItems.map(item=>item.id),nextItems:effectiveDraft.taskItems,previousItems:previousMeetingItems,nextIsInternalControl:effectiveDraft.isInternalControl,
      });
      if(effectiveDraft.isInternalControl&&!effectiveDraft.vessels.length){failure='內部管控臨會必須至少指定一艘涉會船舶';return prev;}
      const persistedInternalControlExists=Boolean(liveMeeting?.isInternalControl||linkedInternalControlTasks.length);
      const protectedScopeSources=[
        ...(liveMeeting?.isInternalControl?[{label:'臨會/專題',vesselIds:[...liveMeeting.vessels]}]:[]),
        ...linkedInternalControlTasks.map(task=>({label:`待辦 ${task.id}`,vesselIds:taskVesselIds(task)})),
      ];
      const sourceHasMissingScope=protectedScopeSources.some(source=>!source.vesselIds.length||source.vesselIds.some(vesselId=>!prev.vessels.some(vessel=>vessel.id===vesselId)));
      const internalControlCancellationRequested=meetingInternalControlTransition||taskInternalControlTransition||parentAuthoritativeTaskTransition||(persistedInternalControlExists&&sourceHasMissingScope);
      let historicalInternalControlVessels:Vessel[]=[];
      if(internalControlCancellationRequested){
        if(sourceHasMissingScope){failure='既有內部管控有個別來源缺少歷史涉船範圍，為避免越權取消，本次未保存';return prev;}
        const cancellationVesselIds=new Set(protectedScopeSources.flatMap(source=>source.vesselIds));
        historicalInternalControlVessels=prev.vessels.filter(vessel=>cancellationVesselIds.has(vessel.id));
        if(historicalInternalControlVessels.length!==cancellationVesselIds.size){failure='內部管控涉船資料不完整，請聯絡管理員處理';return prev;}
        if(!historicalInternalControlVessels.every(vessel=>canCancelInternalControl(liveUser,vessel))){failure='目前帳戶無權取消全部原有涉船範圍的內部管控';return prev;}
      }
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
      if(internalControlCancellationRequested){
        meeting.internalControlCancelledAt=at;
        meeting.internalControlCancelledBy=liveUser.id;
      }
      let reconciliation:ReturnType<typeof reconcileMeetingTasks>;
      try{reconciliation=reconcileMeetingTasks({
          tasks:draftData.tasks,meetingId:id,vesselIds:effectiveDraft.vessels,vesselScopeMode:effectiveDraft.vesselScopeMode,
          vesselTypeScopes:effectiveDraft.vesselTypeScopes,followUps:effectiveDraft.taskItems,priority:effectiveDraft.priority,
          isAbnormal:effectiveDraft.isAbnormal,isInternalControl:effectiveDraft.isInternalControl,
          meetingTaskCategories:prev.settings.meetingTaskCategories,
          expectedDate:effectiveDraft.expectedDate,departments:effectiveDraft.departments,ownerUserIds:effectiveDraft.trackingUserIds,
          initialStatus:effectiveDraft.resolution,actorId:liveUser.id,actorName:liveUser.name,at,preserveExistingDescriptionItemIds,previousMeetingItems,
          internalControlCancellation:internalControlCancellationRequested?{authorized:true,at,by:liveUser.id}:undefined,
        });
      }catch(error:any){failure=error.message||'會議待辦對帳失敗，未保存任何變更';return prev;}
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
      if(meetingInternalControlTransition&&liveMeeting?.isInternalControl){
        const meetingHistoricalVessels=draftData.vessels.filter(vessel=>liveMeeting.vessels.includes(vessel.id));
        const meetingCancellationNotices=buildTaskNotificationsForVessels(
          draftData.users,meetingHistoricalVessels,liveUser.id,
          {id:`meeting:${id}`,description:`臨會/專題：${effectiveDraft.subject.trim()}`,isInternalControl:false,ownerUserIds:effectiveDraft.trackingUserIds},
          'internal_control_cancelled',liveUser.name,draftData.settings.rolePermissions,
        );
        draftData.notifications.unshift(...meetingCancellationNotices);
      }
      draftData.notifications=draftData.notifications.slice(0,1000);
      applied=true;
      persistedDraft=effectiveDraft;
      persistedUpdatedAt=at;
      let auditedDraft=draftData;
      reconciliation.internalControlCancelledIds.forEach(taskId=>{
        const cancelledTask=draftData.tasks.find(task=>task.id===taskId);
        auditedDraft=withAudit(auditedDraft,liveUser,'取消內部管控','task',taskId,`${cancelledTask?.description||taskId}｜由臨會/專題同步取消｜已記錄取消人、時間及FLOW申報提醒`);
      });
      const audited=withAudit(
        auditedDraft,
        liveUser,
        internalControlCancellationRequested?'取消臨會/專題內部管控':wasCreating?'新增臨會/專題':'更新臨會/專題',
        'meeting',id,`${effectiveDraft.subject.trim()}｜${scopeModeLabel(effectiveDraft.vesselScopeMode)}${internalControlCancellationRequested?'｜已記錄取消人、時間及FLOW申報提醒':''}`,
      );
      return audited;
      }));
      return applied;
    };
    const durable=await runDurableRelatedMutation(sectionKey,'臨會/專題保存',apply);
    if(!durable||!applied||!persistedDraft){
      if(applied)saveReachedLocalStateRef.current=true;
      savingRef.current=false;
      if(attempted&&!applied)alert(failure);
      return;
    }
    const persistedEditorDraft={...persistedDraft,taskItems:persistedDraft.taskItems.length?persistedDraft.taskItems:[{id:uid('meeting-task-item'),description:'',categories:normalizeMeetingTaskCategoryList([],data.settings.meetingTaskCategories),distributeToVessels:false}]};
    setDraft(persistedEditorDraft);
    setBaseMeetingUpdatedAt(persistedUpdatedAt);
    editBaselineRef.current=structuredClone(persistedEditorDraft);
    saveReachedLocalStateRef.current=false;
    const released=await releaseItemLease(sectionKey);
    setEditingSessionActive(false);
    setCreating(false);
    setCreatingId('');
    setSelectedId(id);
    editBaselineRef.current=null;
    if(released)setNotice(`✓ ${wasCreating?'臨會/專題已建立並退出編輯':'臨會/專題已保存並退出編輯'}`);
    else setNotice(`✓ ${wasCreating?'臨會/專題已建立':'臨會/專題已保存'}；雲端已確認，編輯鎖將自動釋放`);
    window.setTimeout(()=>{savingRef.current=false;},0);
    return true;
  };

  const openDecisionTask = async (taskId:string) => {
    if(lifecycleBusy)return;
    if(editorWritable){const saved=await save();if(!saved)return;}
    await onOpenDecisionTask(taskId);
  };

  const transitionDecisionTask = async (taskId:string,transition:'complete'|'reopen',repairing=false,requestedClosedDate?:string,requestedClosureStatus?:string) => {
    if(lifecycleBusy)return;
    if(!editable||!canCloseTasks)return alert('目前身份需同時具備管理會議與結案待辦權限');
    const selectedClosedDate=transition==='complete'&&!repairing?trustedClosureDate(requestedClosedDate,''):'';
    const selectedClosureStatus=transition==='complete'&&!repairing?requestedClosureStatus?.trim()||'':'';
    if(transition==='complete'&&!repairing&&!selectedClosedDate)return alert('請先選擇有效的待辦完成日期');
    if(transition==='complete'&&!repairing&&!selectedClosureStatus)return alert('請填寫結案狀態');
    if(editorWritable){const saved=await save();if(!saved)return;}
    setLifecycleBusy(true);
    try{
      const completed=await onTransitionDecisionTask(taskId,transition,selectedClosedDate||undefined,selectedClosureStatus||undefined);
      if(completed)setNotice(repairing?'✓ 關聯狀態已同步':transition==='complete'?'✓ 待辦事項已完成':'✓ 待辦事項已重新開啟');
    }finally{setLifecycleBusy(false);}
  };

  const transitionUnlinkedDecisionItem = async (meeting:TemporaryMeeting,itemId:string,transition:'complete'|'reopen',requestedClosedDate?:string,requestedClosureStatus?:string) => {
    if(lifecycleBusy)return;
    if(!editable||!canCloseTasks)return alert('目前身份需同時具備管理會議與結案待辦權限');
    const selectedClosedDate=transition==='complete'?trustedClosureDate(requestedClosedDate,''):'';
    const selectedClosureStatus=transition==='complete'?requestedClosureStatus?.trim()||'':'';
    if(transition==='complete'&&!selectedClosedDate)return alert('請先選擇有效的待辦完成日期');
    if(transition==='complete'&&!selectedClosureStatus)return alert('請填寫結案狀態');
    let savedBeforeTransition=false;
    if(editorWritable){const saved=await save();if(!saved)return;savedBeforeTransition=true;}
    const sectionKey=meetingEditLockKey(meeting.id);
    let plan=planUnlinkedMeetingDecisionTransition({
      meetings:liveDataRef.current.meetings,
      tasks:liveDataRef.current.tasks,
      meetingId:meeting.id,
      itemId,
      transition,
      sectionKey,
      activeItemLeaseKey:activeItemLeaseKeyRef.current,
      savedBeforeTransition,
    });
    if(plan.ok===false){
      if(plan.reason==='already-applied')return;
      if(plan.reason==='meeting-closed')return alert('請先重新開啟整場會議');
      return alert(plan.reason==='meeting-missing-or-duplicate'?'會議不存在或識別碼重複，未變更待辦狀態':'此待辦已有Task關聯或資料狀態已改變，請重新整理後再試');
    }
    if(transition==='reopen'&&!window.confirm('確定重新開啟此待辦事項？'))return;
    setLifecycleBusy(true);
    let applied=false;
    let claimedForTransition=false;
    try{
      if(plan.mustClaimLease){
        const latest=await claimItemLease(sectionKey,`臨會/專題｜${meeting.subject||meeting.id}`);
        if(!latest)return;
        claimedForTransition=true;
        plan=planUnlinkedMeetingDecisionTransition({
          meetings:latest.meetings,
          tasks:latest.tasks,
          meetingId:meeting.id,
          itemId,
          transition,
          sectionKey,
          activeItemLeaseKey:sectionKey,
          savedBeforeTransition:false,
        });
      }else{
        plan=planUnlinkedMeetingDecisionTransition({
          meetings:liveDataRef.current.meetings,
          tasks:liveDataRef.current.tasks,
          meetingId:meeting.id,
          itemId,
          transition,
          sectionKey,
          activeItemLeaseKey:activeItemLeaseKeyRef.current,
          savedBeforeTransition:false,
        });
      }
      if(plan.ok===false){
        if(claimedForTransition)await releaseItemLease(sectionKey);
        if(plan.reason==='already-applied')return;
        if(plan.reason==='meeting-closed')return alert('請先重新開啟整場會議');
        return alert(plan.reason==='meeting-missing-or-duplicate'?'會議不存在或識別碼重複，未變更待辦狀態':'此待辦已有Task關聯或資料狀態已改變，請重新整理後再試');
      }
      if(!requireItemLease(sectionKey)){if(claimedForTransition)await releaseItemLease(sectionKey);return;}
      const expectedUpdatedAt=plan.expectedUpdatedAt;
      let failure='待辦或會議已變更，請重新確認最新內容';
      let persistedMeeting:TemporaryMeeting|undefined;
      const apply=()=>{
        flushSync(()=>setData(prev=>{
          const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
          if(!liveUser||!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)||!hasPermission(prev.settings.rolePermissions,liveUser,'closeTasks')){failure='目前身份已無權變更此待辦狀態';return prev;}
          const canViewAll=liveUser.role==='owner'||liveUser.role==='admin'||hasPermission(prev.settings.rolePermissions,liveUser,'viewAllVessels');
          const liveVisibleVessels=prev.vessels.filter(vessel=>vessel.isActive&&(canViewAll||vessel.assignedUserIds.includes(liveUser.id)||liveUser.managedVesselIds.includes(vessel.id)));
          const matches=prev.meetings.filter(item=>item.id===meeting.id);
          const liveMeeting=matches.length===1?matches[0]:undefined;
          if(!liveMeeting||!meetingAppliesToUser(liveMeeting,liveVisibleVessels,canViewAll,liveUser.id)||liveMeeting.updatedAt!==expectedUpdatedAt){return prev;}
          if(statusOf(liveMeeting)==='已完成'){failure='請先重新開啟整場會議';return prev;}
          const summary=meetingDecisionCompletionSummary(liveMeeting,prev.tasks);
          const liveItem=summary.items.find(item=>item.item.id===itemId);
          if(!liveItem||liveItem.task||summary.hasLinkConflict||liveMeeting.vessels.length){failure='此待辦已有Task關聯或關聯狀態不明確';return prev;}
          if((transition==='complete'&&liveItem.state==='closed')||(transition==='reopen'&&liveItem.state!=='closed')){failure=transition==='complete'?'待辦已完成':'待辦已重新開啟';return prev;}
          const at=nowIso();
          const statusText=transition==='complete'?selectedClosureStatus:'待辦事項重新開啟';
          let draftData=structuredClone(prev);
          const target=draftData.meetings.find(item=>item.id===meeting.id)!;
          const targetItem=target.taskItems.find(item=>item.id===itemId);
          if(!targetItem){failure='待辦事項不存在';return prev;}
          targetItem.isClosed=transition==='complete';
          if(transition==='complete'){
            targetItem.closedDate=selectedClosedDate;
            targetItem.closedBy=liveUser.id;
          }else{
            delete targetItem.closedDate;
            delete targetItem.closedBy;
          }
          target.latestStatus=statusText;
          target.statusLogs=[{id:uid('meeting-log'),at,by:liveUser.name,byUserId:liveUser.id,text:statusText},...(target.statusLogs||[])];
          target.updatedAt=at;
          persistedMeeting=structuredClone(target);
          applied=true;
          draftData=withAudit(draftData,liveUser,transition==='complete'?'完成臨會/專題待辦':'重新開啟臨會/專題待辦','meeting',meeting.id,richTextToPlainText(targetItem.description)||itemId);
          return draftData;
        }));
        return applied;
      };
      const durable=transition==='complete'
        ?await runDurableRelatedMutation(sectionKey,'臨會/專題待辦完成',apply)
        :await runDurableRelatedMutation(sectionKey,'臨會/專題待辦重新開啟',apply);
      if(!durable||!applied||!persistedMeeting){
        if(!applied)await releaseItemLease(sectionKey);
        if(!applied)alert(failure);
        return;
      }
      const released=await releaseItemLease(sectionKey);
      setDraft(draftFrom(persistedMeeting,liveDataRef.current.tasks,liveDataRef.current.settings.meetingTaskCategories));
      setBaseMeetingUpdatedAt(persistedMeeting.updatedAt||'');
      setNotice(released
        ?transition==='complete'?'✓ 待辦事項已完成':'✓ 待辦事項已重新開啟'
        :`${transition==='complete'?'待辦事項已完成':'待辦事項已重新開啟'}；雲端已確認，協作鎖將自動釋放`);
    }finally{setLifecycleBusy(false);}
  };

  const requestDecisionCompletion=(target:MeetingDecisionClosureTarget)=>{
    if(lifecycleBusy)return;
    setDecisionClosureDate(todayDate());
    setDecisionClosureStatus('');
    setDecisionClosureTarget(target);
  };

  const confirmDecisionCompletion=async()=>{
    const target=decisionClosureTarget;
    if(!target||lifecycleBusy)return;
    const closedDate=trustedClosureDate(decisionClosureDate,'');
    const closureStatus=decisionClosureStatus.trim();
    if(!closedDate)return alert('請選擇有效的待辦完成日期');
    if(!closureStatus)return alert('請填寫結案狀態');
    setDecisionClosureTarget(null);
    if(target.kind==='linked'){
      await transitionDecisionTask(target.taskId,'complete',false,closedDate,closureStatus);
      return;
    }
    const meetings=liveDataRef.current.meetings.filter(meeting=>meeting.id===target.meetingId);
    if(meetings.length!==1)return alert('會議不存在或識別碼重複，未變更待辦狀態');
    await transitionUnlinkedDecisionItem(meetings[0],target.itemId,'complete',closedDate,closureStatus);
  };

  const transitionMeetingLifecycle = async (meeting:TemporaryMeeting,transition:'close'|'reopen') => {
    if(lifecycleBusy)return;
    if(!editable)return alert('目前身份無權結案或重新開啟臨會/專題');
    if(editorWritable)return alert('請先保存或取消目前會議內容修改，再變更整場會議狀態');
    const initialSummary=meetingDecisionCompletionSummary(meeting,data.tasks);
    if(transition==='close'&&!initialSummary.allCompleted)return alert(incompleteMeetingMessage(initialSummary));
    if(!window.confirm(transition==='close'
      ?`確定結案會議「${meeting.subject||'未命名會議'}」？結案後表示不再需要後續追蹤。`
      :`確定重新開啟會議「${meeting.subject||'未命名會議'}」並恢復追蹤？`))return;
    setLifecycleBusy(true);
    const sectionKey=meetingEditLockKey(meeting.id);
    let applied=false;
    try{
      let freshMeeting=meeting;
      if(activeItemLeaseKey!==sectionKey){
        const latest=await claimItemLease(sectionKey,`臨會/專題｜${meeting.subject||meeting.id}`);
        if(!latest)return;
        const matches=latest.meetings.filter(item=>item.id===meeting.id);
        if(matches.length!==1){await releaseItemLease(sectionKey);return alert('會議不存在或識別碼重複，未變更狀態');}
        freshMeeting=matches[0];
      }
      if(!requireItemLease(sectionKey))return;
      const expectedUpdatedAt=freshMeeting.updatedAt;
      let failure='會議已變更或權限已更新，請重新整理後再試';
      let persistedMeeting:TemporaryMeeting|undefined;
      const apply=()=>{
        flushSync(()=>setData(prev=>{
          const liveUser=prev.users.find(user=>user.id===currentUser.id&&user.isActive);
          if(!liveUser||!canEditTemporaryMeetings(prev.settings.rolePermissions,liveUser)){failure='目前身份已無權結案或重新開啟臨會/專題';return prev;}
          const canViewAll=liveUser.role==='owner'||liveUser.role==='admin'||hasPermission(prev.settings.rolePermissions,liveUser,'viewAllVessels');
          const liveVisibleVessels=prev.vessels.filter(vessel=>vessel.isActive&&(canViewAll||vessel.assignedUserIds.includes(liveUser.id)||liveUser.managedVesselIds.includes(vessel.id)));
          const matches=prev.meetings.filter(item=>item.id===meeting.id);
          const liveMeeting=matches.length===1?matches[0]:undefined;
          if(!liveMeeting||!meetingAppliesToUser(liveMeeting,liveVisibleVessels,canViewAll,liveUser.id)){failure='會議不存在或已不在目前可存取範圍';return prev;}
          if(liveMeeting.updatedAt!==expectedUpdatedAt){failure='會議已由其他人更新，請重新確認最新內容';return prev;}
          const currentlyClosed=statusOf(liveMeeting)==='已完成';
          if((transition==='close'&&currentlyClosed)||(transition==='reopen'&&!currentlyClosed)){failure=transition==='close'?'會議已結案':'會議尚未結案';return prev;}
          if(transition==='close'){
            const completionSummary=meetingDecisionCompletionSummary(liveMeeting,prev.tasks);
            if(!completionSummary.allCompleted){failure=incompleteMeetingMessage(completionSummary);return prev;}
          }
          const at=nowIso();
          const statusText=transition==='close'?'會議已結案':'會議重新開啟';
          let draftData=structuredClone(prev);
          const target=draftData.meetings.find(item=>item.id===meeting.id)!;
          target.status=transition==='close'?'已完成':'追蹤中';
          if(transition==='close'){
            target.completedDate=todayDate();
            target.completedBy=liveUser.id;
          }else{
            delete target.completedDate;
            delete target.completedBy;
          }
          target.latestStatus=statusText;
          target.statusLogs=[{id:uid('meeting-log'),at,by:liveUser.name,byUserId:liveUser.id,text:statusText},...(target.statusLogs||[])];
          target.updatedAt=at;
          persistedMeeting=structuredClone(target);
          applied=true;
          draftData=withAudit(draftData,liveUser,transition==='close'?'結案臨會/專題':'重新開啟臨會/專題','meeting',meeting.id,meeting.subject||meeting.id);
          return draftData;
        }));
        return applied;
      };
      const durable=transition==='close'
        ?await runDurableRelatedMutation(meetingEditLockKey(meeting.id),'臨會/專題結案',apply)
        :await runDurableRelatedMutation(meetingEditLockKey(meeting.id),'臨會/專題重新開啟',apply);
      if(!durable||!applied||!persistedMeeting){
        if(!applied)await releaseItemLease(sectionKey);
        if(!applied)alert(failure);
        return;
      }
      const released=await releaseItemLease(sectionKey);
      setDraft(draftFrom(persistedMeeting,data.tasks,data.settings.meetingTaskCategories));
      setBaseMeetingUpdatedAt(persistedMeeting.updatedAt||'');
      setNotice(released
        ?transition==='close'?'✓ 會議已結案，不再列為持續追蹤':'✓ 會議已重新開啟並恢復追蹤'
        :`${transition==='close'?'會議已結案':'會議已重新開啟'}；雲端已確認，協作鎖將自動釋放`);
    }finally{setLifecycleBusy(false);}
  };

  const deleteMeeting = async (meeting: TemporaryMeeting) => {
    if (!canDeleteMeetings) return alert('只有 Owner／管理員可以刪除臨會/專題');
    if (!window.confirm(`確定刪除臨會/專題「${meeting.subject || '未命名會議'}」？\n此操作會同步刪除本會議產生的待辦。`)) return;
    let deleteSnapshot=data;
    if(activeItemLeaseKey!==meetingEditLockKey(meeting.id)){
      const latest=await claimItemLease(meetingEditLockKey(meeting.id),`臨會/專題｜${meeting.subject||meeting.id}`);
      if(!latest)return;
      const latestMeeting=latest.meetings.find(item=>item.id===meeting.id);
      if(!latestMeeting){await releaseItemLease(meetingEditLockKey(meeting.id));return;}
      deleteSnapshot=latest;
      meeting=latestMeeting;
    }
    if(!requireItemLease(meetingEditLockKey(meeting.id)))return;
    let applied = false;
    let failure = '會議已變更或權限已更新，請重新整理後再試';
    let nextMeeting: TemporaryMeeting | undefined;
    let attempted=false;
    const apply=()=>{
      attempted=true;
      flushSync(() => setData(prev => {
      const liveUser = prev.users.find(user => user.id === currentUser.id && user.isActive);
      if (!liveUser) { failure = '登入身份已失效，請重新登入'; return prev; }
      if (!(liveUser.role === 'owner' || liveUser.role === 'admin') || !canEditTemporaryMeetings(prev.settings.rolePermissions, liveUser)) {
        failure = '只有 Owner／管理員可以刪除臨會/專題';
        return prev;
      }
      const canViewAll = liveUser.role === 'owner' || liveUser.role === 'admin' || hasPermission(prev.settings.rolePermissions, liveUser, 'viewAllVessels');
      const liveVisibleVessels = prev.vessels.filter(vessel => vessel.isActive && (
        canViewAll || vessel.assignedUserIds.includes(liveUser.id) || liveUser.managedVesselIds.includes(vessel.id)
      ));
      const liveMeeting = prev.meetings.find(item => item.id === meeting.id);
      if (!liveMeeting || !meetingAppliesToUser(liveMeeting, liveVisibleVessels, canViewAll, liveUser.id)) {
        failure = '會議已被刪除或不再可存取';
        return prev;
      }
      if (liveMeeting.updatedAt !== meeting.updatedAt) {
        failure = '會議已由其他人更新，為避免刪除最新變更，本次未執行';
        return prev;
      }
      const linkedTasks = prev.tasks.filter(task => task.sourceMeetingId === meeting.id);
      if(linkedTasks.some(task=>{
        const ids=taskVesselIds(task);
        return !ids.length||ids.some(id=>!prev.vessels.some(vessel=>vessel.id===id));
      })){
        failure='有關聯待辦缺少完整涉船範圍，無法保證刪除通知與稽核完整，本次未執行';
        return prev;
      }
      const activeInternalTasks = linkedTasks.filter(task => (task.isInternalControl||liveMeeting.isInternalControl) && !taskIsClosedForScope(task, taskVesselIds(task)));
      const protectedSources = [
        ...(liveMeeting.isInternalControl ? [{ label:'臨會/專題', vesselIds:[...liveMeeting.vessels] }] : []),
        ...activeInternalTasks.map(task => ({ label:`待辦 ${task.id}`, vesselIds:taskVesselIds(task) })),
      ];
      if (protectedSources.some(source => !source.vesselIds.length || source.vesselIds.some(vesselId => !prev.vessels.some(vessel => vessel.id === vesselId)))) {
        failure = '內部管控有個別來源缺少完整歷史涉船範圍，本次未執行刪除';
        return prev;
      }
      const protectedVesselIds = new Set(protectedSources.flatMap(source => source.vesselIds));
      const protectedVessels = prev.vessels.filter(vessel => protectedVesselIds.has(vessel.id));
      if (!protectedVessels.every(vessel => canCancelInternalControl(liveUser, vessel))) {
        failure = '目前帳戶無權取消全部原有涉船範圍的內部管控';
        return prev;
      }
      const at = nowIso();
      let draftData = structuredClone(prev);
      const removedTaskIds = new Set(linkedTasks.map(task => task.id));
      const activeInternalTaskIds=new Set(activeInternalTasks.map(task=>task.id));
      const deletionNotices = linkedTasks.flatMap(task => {
        const vessels = prev.vessels.filter(vessel => taskVesselIds(task).includes(vessel.id));
        const cancelling=activeInternalTaskIds.has(task.id);
        return buildTaskNotificationsForVessels(prev.users, vessels, liveUser.id, {...task,isInternalControl:cancelling?false:task.isInternalControl}, cancelling?'internal_control_cancelled':'task_deleted', liveUser.name, prev.settings.rolePermissions);
      });
      if (liveMeeting.isInternalControl) {
        const meetingHistoricalVessels=prev.vessels.filter(vessel=>liveMeeting.vessels.includes(vessel.id));
        deletionNotices.push(...buildTaskNotificationsForVessels(
          prev.users, meetingHistoricalVessels, liveUser.id,
          {id:`meeting:${meeting.id}`,description:`臨會/專題：${liveMeeting.subject}`,isInternalControl:false,ownerUserIds:liveMeeting.trackingUserIds},
          'internal_control_cancelled',liveUser.name,prev.settings.rolePermissions,
        ));
      }
      draftData.meetings = draftData.meetings.filter(item => item.id !== meeting.id);
      draftData.tasks = draftData.tasks.filter(task => task.sourceMeetingId !== meeting.id);
      draftData.notifications = [...deletionNotices, ...draftData.notifications.filter(notice => !removedTaskIds.has(notice.taskId))].slice(0,1000);
      linkedTasks.forEach(task => {
        if(activeInternalTaskIds.has(task.id))draftData = withAudit(draftData, liveUser, '取消內部管控', 'task', task.id, `${task.description || task.id}｜刪除臨會/專題時同步取消｜取消人 ${liveUser.id}｜${at}`);
        draftData = withAudit(draftData, liveUser, '刪除事項', 'task', task.id, `${task.description || task.id}｜隨臨會/專題刪除`);
      });
      nextMeeting = draftData.meetings.find(item => meetingAppliesToUser(item, liveVisibleVessels, canViewAll, liveUser.id));
      applied = true;
      const audited = withAudit(draftData, liveUser, '刪除臨會/專題', 'meeting', meeting.id, `${liveMeeting.subject || meeting.id}｜同步刪除 ${removedTaskIds.size} 件待辦${protectedSources.length?'｜已驗證並記錄內部管控取消':''}`);
      return audited;
      }));
      return applied;
    };
    const durable=await runDurableRelatedMutation(meetingEditLockKey(meeting.id),'臨會/專題刪除',apply);
    if (!durable||!applied) {if(attempted&&!applied)alert(failure);return;}
    if(!await releaseItemLease(meetingEditLockKey(meeting.id)))return;
    setEditingSessionActive(false);
    editBaselineRef.current=null;
    saveReachedLocalStateRef.current=false;
    setCreating(false);
    setSelectedId(nextMeeting?.id || '');
    setDraft(draftFrom(nextMeeting, deleteSnapshot.tasks, deleteSnapshot.settings.meetingTaskCategories));
    setBaseMeetingUpdatedAt(nextMeeting?.updatedAt || '');
    setMeetingExportSelection(previous => previous.filter(id => id !== meeting.id));
    setNotice('✓ 臨會/專題已刪除');
  };

  const counts = Object.fromEntries(statuses.map(status => [status, accessibleMeetings.filter(meeting => statusOf(meeting) === status).length])) as Record<TemporaryMeetingStatus, number>;
  const registerStatusOptions:TemporaryMeetingStatus[]=registerListMode==='completed'?['已完成']:['待召開','追蹤中'];
  const registerListLabel=registerListMode==='completed'?'已完成':'未完成';
  const meetingVesselIds = (meeting: TemporaryMeeting) => {
    const saved = meeting.vessels.filter(id => visibleIds.has(id));
    if (saved.length) return saved;
    if (scopeModeOf(meeting) === 'all') return visibleVessels.map(vessel => vessel.id);
    if (scopeModeOf(meeting) === 'types') return visibleVessels.filter(vessel => (meeting.vesselTypeScopes || []).includes(vessel.shipType)).map(vessel => vessel.id);
    return saved;
  };
  const meetingRegisterSortValues=(meeting:TemporaryMeeting)=>{
    const vesselIds=meetingVesselIds(meeting);
    return {
      id:meeting.id,
      meetingDate:meeting.meetingDate||'',
      status:statusOf(meeting),
      scope:meetingScopeLabel(meeting),
      vesselCount:vesselIds.length,
      vesselLabel:vesselIds.map(id=>vesselDisplayName(vesselById[id])).join('、'),
      expectedDate:meeting.expectedDate||'',
    };
  };
  const orderedMeetings=viewMode==='register'?sortMeetingRegisterEntries(filtered,registerSort,meetingRegisterSortValues):filtered;
  const pagedMeetings=paginateItems(orderedMeetings,meetingPage);
  const meetingTaskCount = (meetingId: string) => data.tasks.filter(task => task.sourceMeetingId === meetingId && taskVesselIds(task).some(id => visibleIds.has(id))).length;
  const meetingTaskProgressLabel=(meeting:TemporaryMeeting)=>{
    const summary=meetingDecisionCompletionSummary(meeting,data.tasks);
    return summary.hasLinkConflict?'關聯待修復':`${summary.completedCount}/${summary.totalCount} 完成`;
  };
  const selectedExportMeetings = registerMeetings.filter(meeting => meetingExportSelection.includes(meeting.id));
  const printableMeetings = accessibleMeetings.filter(meeting => printMeetingIds.includes(meeting.id));
  const registerPrintMeetings=sortMeetingRegisterEntries(
    accessibleMeetings.filter(meeting=>meetingBelongsToRegisterList(statusOf(meeting),printRegisterListMode)),
    registerSort,
    meetingRegisterSortValues,
  );
  const toggleMeetingExport = (id: string) => setMeetingExportSelection(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const openMeetingRegister=(mode:MeetingRegisterListMode)=>{
    setRegisterListMode(mode);
    setStatusFilter('全部');
    setMeetingExportSelection([]);
    setMeetingPage(1);
    setViewMode('register');
  };
  const changeMeetingRegisterSort=(key:MeetingRegisterSortKey)=>{
    setRegisterSort(current=>nextMeetingRegisterSort(current,key));
    setMeetingPage(1);
  };
  const meetingRegisterSortIndicator=(key:MeetingRegisterSortKey)=>registerSort.key===key?(registerSort.direction==='asc'?'▲':'▼'):'↕';
  const printMeetings = (mode: 'meetings' | 'register', requestedIds = meetingExportSelection) => {
    if (!canExportReports) return alert('目前角色未获授权导出会议资料');
    if (printInFlightRef.current || printMode) return alert('正在準備列印，請稍候');
    const allowedIds = requestedIds.filter(id => accessibleMeetings.some(meeting => meeting.id === id));
    if (mode === 'meetings' && !allowedIds.length) return alert('請先勾選至少一筆會議');
    if(mode==='register')setPrintRegisterListMode(registerListMode);
    setPrintMeetingIds(mode === 'meetings' ? allowedIds : []);
    setPrintMode(mode);
  };
  const printMeetingDetail = (meetingId: string) => printMeetings('meetings', [meetingId]);
  const creator = selected ? users[selected.createdBy] : undefined;
  const selectedTaskItemNumbers = new Map((selected ? meetingTaskItems(selected, data.tasks, data.settings.meetingTaskCategories) : []).map((item, index) => [item.id, index + 1]));

  if (creating && !editable) return <section className="temporary-meeting-page"><div className="page-heading"><div><h1>臨會/專題</h1><p>目前身份沒有建立臨會/專題權限，已停止顯示先前的新增草稿。</p></div></div><div className="empty-state">目前沒有可編輯的臨會/專題草稿</div></section>;
  if (!creating && !selected) return <section className="temporary-meeting-page"><div className="page-heading"><div><h1>臨會/專題</h1><p>目前沒有可檢視的臨會/專題，或原選取會議已不在目前權限範圍。</p></div>{editable&&<div className="heading-actions no-print"><button className="btn primary" onClick={() => void startNew()}>＋ 新增臨會/專題</button></div>}</div><div className="empty-state">目前沒有可檢視的臨會/專題</div></section>;

  return <><section className="temporary-meeting-page meeting-screen">
    <div className="page-heading">
      <div><h1>臨會/專題</h1><p>建立突發議題會議，可按全部船舶、船舶類型或逐船設定範圍。</p></div>
      <div className="heading-actions no-print">
        <button aria-pressed={viewMode==='register'&&registerListMode==='unfinished'} className={`btn ghost meeting-register-entry ${viewMode==='register'&&registerListMode==='unfinished'?'active':''}`} onClick={()=>openMeetingRegister('unfinished')}>未完成清單</button>
        <button aria-pressed={viewMode==='register'&&registerListMode==='completed'} className={`btn ghost meeting-register-entry ${viewMode==='register'&&registerListMode==='completed'?'active':''}`} onClick={()=>openMeetingRegister('completed')}>已完成清單</button>
        {editable?<button className="btn primary" onClick={() => void startNew()}>＋ 新增臨會/專題</button>:<span className="badge">操作員唯讀</span>}
      </div>
    </div>
    {viewMode === 'register' ? <section className="panel meeting-register">
      <div className="panel-title"><div><h2>{registerListMode==='completed'?'臨會/專題已完成清單':'臨會/專題未完成清單'}</h2><p className="muted">共 {registerMeetings.length} 筆，目前篩選顯示 {filtered.length} 筆{canExportReports ? `｜已選 ${selectedExportMeetings.length} 筆` : ''}</p></div><div className="heading-actions no-print"><button className="btn small ghost" onClick={()=>setViewMode('workspace')}>返回會議詳情</button>{canExportReports&&<><button className="btn small ghost" onClick={() => setMeetingExportSelection(Array.from(new Set([...meetingExportSelection, ...pagedMeetings.items.map(meeting => meeting.id)])))}>全選本頁</button><button className="btn small ghost" onClick={() => setMeetingExportSelection([])}>清空</button><button className="btn small primary" onClick={() => printMeetings('meetings')}>匯出所選會議 PDF</button><button className="btn small green" onClick={() => printMeetings('register')}>{registerListMode==='completed'?'匯出已完成清單 PDF':'匯出未完成清單 PDF'}</button></>}</div></div>
      <div className="meeting-register-filters no-print">
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、人員、待辦、船型…" />
        <select aria-label={`${registerListLabel}清單會議狀態篩選`} value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{registerStatusOptions.map(status => <option key={status}>{status}</option>)}</select>
        <select aria-label="總清單會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
        <select aria-label="總清單船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
      </div>
      {filtered.length ? <div className="table-wrap"><table className="compact meeting-register-table"><thead><tr>{canExportReports&&<th className="no-print">選取</th>}<th aria-sort={meetingRegisterAriaSort(registerSort,'meetingDate')}><button type="button" className="meeting-register-sort-button" onClick={()=>changeMeetingRegisterSort('meetingDate')}>召開日期 <span aria-hidden="true">{meetingRegisterSortIndicator('meetingDate')}</span></button></th><th aria-sort={meetingRegisterAriaSort(registerSort,'status')}><button type="button" className="meeting-register-sort-button" onClick={()=>changeMeetingRegisterSort('status')}>狀態 <span aria-hidden="true">{meetingRegisterSortIndicator('status')}</span></button></th><th className="meeting-register-subject">會議主題</th><th aria-sort={meetingRegisterAriaSort(registerSort,'scope')}><button type="button" className="meeting-register-sort-button" onClick={()=>changeMeetingRegisterSort('scope')}>會議範圍 <span aria-hidden="true">{meetingRegisterSortIndicator('scope')}</span></button></th><th aria-sort={meetingRegisterAriaSort(registerSort,'vessels')}><button type="button" className="meeting-register-sort-button" onClick={()=>changeMeetingRegisterSort('vessels')}>船舶 <span aria-hidden="true">{meetingRegisterSortIndicator('vessels')}</span></button></th><th>部門</th><th>追蹤窗口／負責人</th><th>待辦</th><th aria-sort={meetingRegisterAriaSort(registerSort,'expectedDate')}><button type="button" className="meeting-register-sort-button" onClick={()=>changeMeetingRegisterSort('expectedDate')}>期限 <span aria-hidden="true">{meetingRegisterSortIndicator('expectedDate')}</span></button></th><th className="no-print">操作</th></tr></thead><tbody>{pagedMeetings.items.map(meeting => { const vesselIds = meetingVesselIds(meeting); const vesselNames = vesselIds.map(id => vesselDisplayName(vesselById[id])); return <tr key={meeting.id}>{canExportReports&&<td className="no-print"><input aria-label={`選取會議 ${meeting.subject}`} type="checkbox" checked={meetingExportSelection.includes(meeting.id)} onChange={() => toggleMeetingExport(meeting.id)}/></td>}<td>{meeting.meetingDate || '-'}</td><td><span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span></td><td className="meeting-register-subject"><b>{meeting.subject}</b><RichTextContent compact className="muted" value={meeting.reason} fallback="未填召開緣由"/></td><td>{meetingScopeLabel(meeting)}</td><td title={vesselNames.join('、')}>{vesselIds.length} 艘<br/><span className="muted">{vesselNames.slice(0, 3).join('、')}{vesselNames.length > 3 ? '…' : ''}</span></td><td>{meeting.departments.join('、') || '-'}</td><td><b>追蹤：{peopleNames(meeting.trackingUserIds || [])}</b><br/><span className="muted">負責：{peopleNames(meeting.responsibleUserIds)}</span></td><td><span className="task-source-badge source-temporary">{meetingTaskProgressLabel(meeting)}</span></td><td>{meeting.expectedDate || '-'}</td><td className="no-print"><div className="heading-actions"><button className="btn small primary" onClick={() => viewMeeting(meeting)}>進入詳情</button>{canDeleteMeetings&&<button className="btn small red" onClick={() => void deleteMeeting(meeting)}>刪除</button>}</div></td></tr>; })}</tbody></table></div> : <div className="empty-state">目前沒有符合條件的{registerListLabel}臨會/專題</div>}
      <PaginationControls ariaLabel="臨會清單分頁" page={pagedMeetings.page} pageCount={pagedMeetings.pageCount} total={pagedMeetings.total} from={pagedMeetings.from} to={pagedMeetings.to} onPageChange={setMeetingPage}/>
    </section> : <div className="temporary-meeting-workspace">
      <aside className="meeting-column temporary-list-column">
        <div className="column-title"><div><h2>基本資訊清單</h2><span>{filtered.length} 筆</span></div>{editable&&<button className="btn small primary" onClick={() => void startNew()}>新增</button>}</div>
        <div className="temporary-list-tools">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋主題、人員、待辦、船型…" />
          <select aria-label="會議狀態篩選" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option>全部</option>{statuses.map(status => <option key={status}>{status}</option>)}</select>
          <select aria-label="會議範圍篩選" value={scopeFilter} onChange={event => setScopeFilter(event.target.value as ScopeFilter)}><option value="any">全部範圍</option><option value="all">全部船舶</option><option value="types">按船舶類型</option><option value="vessels">逐船選擇</option></select>
          <select aria-label="船舶類型篩選" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="all">全部船型</option>{shipTypes.map(shipType => <option key={shipType}>{shipType}</option>)}</select>
        </div>
        <div className="column-scroll">
          {pagedMeetings.items.map(meeting => <button key={meeting.id} className={`temporary-meeting-item ${!creating && selectedId === meeting.id ? 'active' : ''}`} onClick={() => viewMeeting(meeting)}>
            <span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span>{meeting.isAbnormal&&<span className="inline-abnormal">異常</span>}{meeting.isInternalControl&&<span className="internal-control-tag">內部管控</span>}<b>{meeting.subject}</b>
            <small>{meeting.meetingDate}｜{meetingScopeLabel(meeting)}｜{meeting.departments.length} 部門</small><p>{richTextToPlainText(meeting.reason)||'尚未填寫召開緣由'}</p>
          </button>)}
          {!filtered.length && <div className="empty-state compact">目前沒有符合條件的臨會/專題</div>}
        </div>
        <PaginationControls compact ariaLabel="臨會清單分頁" page={pagedMeetings.page} pageCount={pagedMeetings.pageCount} total={pagedMeetings.total} from={pagedMeetings.from} to={pagedMeetings.to} onPageChange={setMeetingPage}/>
      </aside>

      <section className="meeting-column temporary-editor-column">
        <div className="column-title">
          <div><h2>{creating ? '新增臨會/專題' : draft.subject || '會議資料'}</h2><span>{editorWritable?(creating ? '建立基本資訊與會議範圍' : '修改後請按保存並退出編輯'):'唯讀檢視；同一項目只允許一人編輯'}</span></div>
          <div className="heading-actions no-print">
            {editable&&!creating&&selected&&!editorWritable&&<button className="btn primary" disabled={lifecycleBusy} onClick={()=>void beginEditing(selected)}>取得編輯權</button>}
            {editable&&!creating&&selected&&!editorWritable&&(statusOf(selected)==='已完成'
              ?<button className="btn ghost meeting-reopen-button" disabled={lifecycleBusy} onClick={()=>void transitionMeetingLifecycle(selected,'reopen')}>重新開啟會議</button>
              :<button className="btn green meeting-close-button" disabled={lifecycleBusy||!selectedCompletionSummary?.allCompleted} title={selectedCompletionSummary?.allCompleted?'全部決議待辦已完成，可結案會議':selectedCompletionSummary?incompleteMeetingMessage(selectedCompletionSummary):''} onClick={()=>void transitionMeetingLifecycle(selected,'close')}>結案會議</button>)}
            {!creating&&selected&&canDeleteMeetings&&<button className="btn red" disabled={lifecycleBusy} onClick={() => void deleteMeeting(selected)}>刪除會議</button>}
            {canExportReports&&selected&&<button className="btn primary" onClick={() => printMeetingDetail(selected.id)}>導出本次會議 PDF</button>}
            {editorWritable&&<button type="button" className="btn small ghost" onClick={()=>void cancelEditing()}>取消修改退出編輯</button>}
            {editorWritable&&<button type="button" className="btn small green" onClick={()=>void save()}>{creating ? '建立並退出編輯' : '保存並退出編輯'}</button>}
          </div>
        </div>
        <div className={`column-scroll temporary-form ${!editorWritable?'readonly-form':''}`} aria-readonly={!editorWritable}>
          <fieldset disabled={!editorWritable} className="temporary-form-fields">
          <div className="grid cols-3">
            <div className="field span-2"><label>會議主題 <span className="required-mark">*</span></label><input required aria-required="true" value={draft.subject} onChange={event => setDraft({ ...draft, subject: event.target.value })} placeholder="例如：颱風避風臨時協調會" /></div>
            <div className="field"><label>狀態 <span className="required-mark">*</span></label><select required aria-required="true" value={draft.status} onChange={event => setMeetingStatus(event.target.value as TemporaryMeetingStatus)}>{statuses.map(status => <option key={status}>{status}</option>)}</select></div>
            <div className="field"><label>召開日期 <span className="required-mark">*</span></label><input required aria-required="true" type="date" value={draft.meetingDate} onChange={event => setDraft({ ...draft, meetingDate: event.target.value })} /></div>
            <div className="field"><label>預計完成日期</label><input type="date" value={draft.expectedDate} onChange={event => setDraft({ ...draft, expectedDate: event.target.value })} /><small>選填，可留空</small></div>
            <div className="field"><label>完成日期</label><input type="date" value={draft.completedDate || ''} onChange={event => setMeetingCompletedDate(event.target.value)} /><small>{draft.status === '已完成' ? '與切換「已完成」時彈出的日期同步' : '選擇日期會同步標記為已完成'}</small></div>
            <div className="field"><label>會議議題關注程度</label><select value={draft.priority} onChange={event => setDraft({ ...draft, priority: event.target.value as TaskPriority })}>{data.settings.priorities.map(priority => <option key={priority}>{priority}</option>)}</select><small>同步至本會議待辦</small></div>
            <label className="aware-toggle abnormal-toggle meeting-abnormal-toggle"><input type="checkbox" checked={draft.isAbnormal} disabled={draft.isInternalControl} onChange={event=>setDraft(previous=>({...previous,isAbnormal:event.target.checked}))}/><span><b>異常</b><small>勾選後，如會議不是全部船舶且有具體涉船，對應船舶看板顯示「異常存在」</small></span></label>
            <label className="aware-toggle internal-control-toggle meeting-internal-control-toggle"><input type="checkbox" checked={draft.isInternalControl} disabled={!creating&&persistedInternalControlVesselIds.size>0&&!canCancelSelectedInternalControl} onChange={event=>{const value=event.target.checked;if(draft.isInternalControl&&!value)alert(FLOW_INTERNAL_CONTROL_REMINDER);setDraft(previous=>({...previous,isInternalControl: value, isAbnormal: value ? true : previous.isAbnormal}));}}/><span><b>內部管控</b><small>勾選後同步視為異常</small></span></label>
            <label className="aware-toggle meeting-morning-toggle"><input type="checkbox" checked={draft.includeInMorning} onChange={event=>setDraft({...draft,includeInMorning:event.target.checked})}/><span><b>納入早會</b><small>勾選後，本會議待辦才會進入早會討論與早會報告</small></span></label>
            <div className="field span-3"><label>召開緣由 <span className="required-mark">*</span></label><RichTextEditor ariaLabel="召開緣由" required readOnly={!editorWritable} value={draft.reason} onChange={reason=>setDraft({...draft,reason})} placeholder="說明為何召開本次臨會/專題" /></div>
            <div className="field span-3"><label>決議／會議結論</label><RichTextEditor ariaLabel="決議／會議結論" readOnly={!editorWritable} value={draft.resolution} onChange={resolution=>setDraft({...draft,resolution})} placeholder="記錄本次會議決議或結論" /></div>
          </div>
          </fieldset>
            <div className="field meeting-task-items-editor">
              <div className="meeting-task-items-title"><label>待辦事項</label><button type="button" className="btn small primary" disabled={!editorWritable} onClick={addTaskItem}>＋ 增加待辦事項</button></div>
              {draft.taskItems.map((item, index) => {
                const completion=selectedDecisionStateByItemId.get(item.id);
                const inlineLifecycleAction=Boolean(
                  editable&&selected&&statusOf(selected)!=='已完成'&&canCloseTasks
                  &&completion&&!completion.lifecycleConflict&&!completion.distributed
                  &&(completion.state==='open'||completion.state==='closed')
                );
                const itemLabel=richTextToPlainText(item.description)||`待辦事項 ${index+1}`;
                return <div className="meeting-task-item" key={item.id}>
                  <div className="meeting-task-item-heading">
                    <label htmlFor={`meeting-task-${item.id}`}>待辦事項 {index + 1}</label>
                    <span className={`meeting-decision-state state-${completion?.state||'pending'}`}>{completion?.lifecycleConflict?'狀態待同步':completion?.state==='closed'?'已完成':completion?.state==='open'?(completion.distributed?`分船完成 ${completion.completedVesselCount}/${completion.vesselCount}`:'未完成'):completion?.state==='duplicate'?'關聯重複':completion?.state==='missing'?'關聯待修復':completion?.state==='invalid'?'關聯異常':'保存後追蹤'}</span>
                    <span className="meeting-task-item-actions no-print">
                      {editable&&selected&&completion?.task&&!completion.lifecycleConflict&&(completion.state==='open'||completion.state==='closed')&&<button type="button" className="btn small primary meeting-inline-decision-update" disabled={lifecycleBusy} onClick={()=>void openDecisionTask(completion.task.id)}>更新</button>}
                      {inlineLifecycleAction&&(completion?.state==='closed'
                        ?<button type="button" className="btn small ghost meeting-inline-decision-transition" disabled={lifecycleBusy} onClick={()=>{if(completion.task)void transitionDecisionTask(completion.task.id,'reopen');else if(selected)void transitionUnlinkedDecisionItem(selected,item.id,'reopen');}}>重新開啟此待辦</button>
                        :<button type="button" className="btn small green meeting-inline-decision-transition" disabled={lifecycleBusy} onClick={()=>requestDecisionCompletion(completion?.task?{kind:'linked',taskId:completion.task.id,label:itemLabel}:{kind:'unlinked',meetingId:selectedId,itemId:item.id,label:itemLabel})}>快速結案</button>)}
                      <button type="button" className="btn small ghost" disabled={!editorWritable} onClick={() => removeTaskItem(item.id)}>移除此事項</button>
                    </span>
                  </div>
                  <RichTextEditor id={`meeting-task-${item.id}`} ariaLabel={`待辦事項 ${index+1}`} readOnly={!editorWritable} value={item.description} onChange={description=>updateTaskItem(item.id,description)} placeholder="填寫後保存，預設作為公司層決議待辦" />
                  <div className="meeting-task-category-picker"><b>臨會/專題待辦分類</b><span>已選 {normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories).length}</span><div className="temporary-chip-grid">{data.settings.meetingTaskCategories.map(category=>{const checked=normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories).includes(category);return <label key={category} className={`meeting-task-category-chip ${checked?'selected':''}`}><input type="checkbox" disabled={!editorWritable} checked={checked} onChange={()=>{const current=normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories);updateTaskItemCategories(item.id,checked?current.filter(value=>value!==category):[...current,category]);}}/><span>{category}</span></label>;})}</div></div>
                  <label className="aware-toggle meeting-vessel-distribution-toggle"><input type="checkbox" disabled={!editorWritable} checked={item.distributeToVessels===true} onChange={event=>toggleTaskItemDistribution(item.id,event.target.checked)}/><span><b>分派到涉及船舶單船跟蹤：</b><small>勾選後，該會議待辦會分派到所有涉及船舶並出現在單船待辦清單；各船分別更新進度，只有全部涉及船舶完成，該待辦才記為完成。未勾選則只在臨會/專題、我的待辦、待辦總表與已結案中流轉。</small></span></label>
                </div>;
              })}
            </div>
          <fieldset disabled={!editorWritable} className="temporary-form-fields">
          <div className="temporary-picker meeting-scope-picker">
            <div className="temporary-picker-title"><b>涉會船舶範圍</b><span>{resolvedVesselIds.length} 艘</span></div>
            <div className="meeting-scope-modes">
              {(['all', 'types', 'vessels'] as MeetingVesselScopeMode[]).map(mode => <button key={mode} type="button" className={`scope-mode-card ${draft.vesselScopeMode === mode ? 'active' : ''}`} aria-pressed={draft.vesselScopeMode === mode} onClick={() => setDraft(previous => ({ ...previous, vesselScopeMode: mode }))}><b>{scopeModeLabel(mode)}</b><small>{mode === 'all' ? '目前可見的所有船舶' : mode === 'types' ? '可同時選一個或多個船型' : '逐艘勾選特定船舶'}</small></button>)}
            </div>
            {draft.vesselScopeMode === 'all' && <div className="scope-result-note"><b>全部船舶</b><span>本次會議涵蓋目前可見的 {resolvedVesselIds.length} 艘船舶。</span></div>}
            {draft.vesselScopeMode === 'types' && <>
              <div className="temporary-picker-title scope-subtitle"><b>選擇船舶類型</b><span>已選 {draft.vesselTypeScopes.length} 類</span><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vesselTypeScopes: [...shipTypes] }))}>全選類型</button><button className="btn small ghost" onClick={() => setDraft(previous => ({ ...previous, vesselTypeScopes: [] }))}>清空</button></div>
              <div className="vessel-type-scope-grid">{shipTypes.map(shipType => { const count = visibleVessels.filter(vessel => vessel.shipType === shipType).length; const active = draft.vesselTypeScopes.includes(shipType); return <button type="button" key={shipType} className={`vessel-type-scope ${active ? 'active' : ''}`} aria-pressed={active} onClick={() => toggleVesselType(shipType)}><span className={`meeting-check ${active ? 'on' : ''}`}>{active ? '✓' : ''}</span><b>{shipType}</b><small>{count} 艘</small></button>; })}</div>
              <div className="scope-result-note"><b>實際範圍</b><span>{draft.vesselTypeScopes.length ? `${draft.vesselTypeScopes.join('、')}，共 ${resolvedVesselIds.length} 艘` : '未指定船舶類型；可直接保存為未指定船舶範圍'}</span></div>
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
            <div className="meeting-status-update-title"><div><h3>加入狀態記錄</h3><p>快速更新本次臨會／專題的最新進度；加入後請按「保存並退出編輯」。</p></div>{draft.latestStatus&&<span>最新：{draft.latestStatus}</span>}</div>
            <div className="quick-status-bar"><textarea aria-label="會議最新狀態" value={quickStatus} onChange={event=>setQuickStatus(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();addStatus();}}} placeholder="快速輸入最新狀態…"/><button type="button" className="btn primary" onClick={addStatus}>加入狀態紀錄</button></div>
          </section>}
          {!creating && <section className="status-history meeting-status-history"><h3>狀態歷程</h3>{draft.statusLogs.length?draft.statusLogs.map(log=><article key={log.id}><b>{log.text}</b><small>{formatTaipeiDateTime(log.at)}｜{log.by}</small>{canDeleteMeetingStatusLog(log)&&<button type="button" className="btn small ghost no-print" onClick={()=>deleteStatusLog(log.id)}>刪除記錄</button>}</article>):<p className="muted">尚無狀態紀錄</p>}</section>}
          </fieldset>
        </div>
      </section>

      <aside className="meeting-column temporary-summary-column">
        <div className="column-title"><h2>會議狀態</h2></div>
        <div className="column-scroll">
          <div className="temporary-status-grid">{statuses.map(status => <button key={status} className={statusFilter === status ? 'active' : ''} onClick={() => setStatusFilter(status)}><span>{status}</span><b>{counts[status]}</b></button>)}</div>
          <div className="summary-card blue"><h3>目前會議</h3><div className="summary-line"><span>狀態</span><b>{draft.status}</b></div><div className="summary-line"><span>會議追蹤</span><b>{draft.status==='已完成'?'已結案':'持續追蹤'}</b></div><div className="summary-line"><span>待辦進度</span><b>{selectedCompletionSummary?`${selectedCompletionSummary.completedCount}/${selectedCompletionSummary.totalCount}`:'尚未建立'}</b></div><div className="summary-line"><span>完成日期</span><b>{draft.completedDate||'未完成'}</b></div><div className="summary-line"><span>範圍</span><b>{scopeModeLabel(draft.vesselScopeMode)}</b></div><div className="summary-line"><span>船舶</span><b>{resolvedVesselIds.length}</b></div><div className="summary-line"><span>部門</span><b>{draft.departments.length}</b></div><div className="summary-line"><span>與會人員</span><b>{draft.participantUserIds.length}</b></div><div className="summary-line"><span>追蹤窗口</span><b>{draft.trackingUserIds.length}</b></div><div className="summary-line"><span>負責人</span><b>{draft.responsibleUserIds.length}</b></div><div className="summary-line"><span>關注</span><b>{draft.priority}</b></div><div className="summary-line"><span>異常</span><b>{draft.isAbnormal?'是':'否'}</b></div><div className="summary-line"><span>內部管控</span><b>{draft.isInternalControl?'是':'否'}</b></div><div className="summary-line"><span>早會</span><b>{draft.includeInMorning?'納入':'不納入'}</b></div><div className="summary-line"><span>最新狀態</span><b>{draft.latestStatus||'尚無記錄'}</b></div></div>
          <div className="summary-card"><h3>建立資訊</h3><p>{selected ? formatTaipeiDateTime(selected.createdAt) : '尚未建立'}</p><small>{creator ? `${creator.department}｜${creator.name}｜${roleLabel(creator.role)}` : '建立後顯示建立者'}</small></div>
          <div className="summary-card mint"><h3>關聯待辦事項</h3>{selectedCompletionSummary?.hasLinkConflict&&<p className="meeting-decision-warning">待辦關聯缺少、重複或孤立，結案前必須先保存修復。</p>}{linkedTasks.length ? <div className="meeting-linked-tasks">{linkedTasks.map(task => {const completion=task.sourceMeetingItemId?selectedDecisionStateByItemId.get(task.sourceMeetingItemId):undefined;const closed=taskIsClosedForScope(task,taskVesselIds(task));return <article key={task.id} className={closed?'decision-completed':''}><div className="meeting-linked-task-heading"><b>{taskVesselLabel(task, visibleVessels)}</b><span className={`meeting-decision-state state-${completion?.state||'missing'}`}>{completion?.lifecycleConflict?'父子狀態不一致':completion?.distributed?`分船完成 ${completion.completedVesselCount}/${completion.vesselCount}`:closed?'已完成':completion?'未完成':'關聯待修復'}</span></div><small>船種：{taskShipTypeLabel(task, visibleVessels)}</small><RichTextContent compact value={task.description} fallback="尚未填寫事項內容"/><small>{task.sourceMeetingItemId && selectedTaskItemNumbers.get(task.sourceMeetingItemId) ? `待辦事項 ${selectedTaskItemNumbers.get(task.sourceMeetingItemId)}｜` : ''}{closed ? '已結案' : richTextToPlainText(task.status) || '待執行'}｜期限 {task.expectedDate || '未設定'}</small>{completion?.task?.id===task.id&&(completion.lifecycleConflict||(!completion.distributed&&(completion.state==='open'||completion.state==='closed')))&&editable&&canCloseTasks&&selected&&statusOf(selected)!=='已完成'&&<button type="button" className={`btn small ${completion.lifecycleConflict||closed?'ghost':'green'} meeting-decision-transition`} disabled={lifecycleBusy} onClick={()=>{if(completion.lifecycleConflict){void transitionDecisionTask(task.id,closed?'complete':'reopen',true);return;}if(closed){void transitionDecisionTask(task.id,'reopen');return;}requestDecisionCompletion({kind:'linked',taskId:task.id,label:richTextToPlainText(task.description)||'此待辦'});}}>{completion.lifecycleConflict?'同步關聯狀態':closed?'重新開啟此待辦':'完成此待辦'}</button>}{completion?.distributed&&!completion.lifecycleConflict&&<small className="meeting-distributed-guidance">請在各船進度分別完成；全部完成後此項自動完成。</small>}{closed&&selected&&statusOf(selected)==='已完成'&&<small>如需重新開啟此待辦，請先重新開啟會議。</small>}</article>;})}</div> : !selectedCompletionSummary?.items.some(item=>!item.task)?<p>{draft.taskItems.some(item => !isRichTextEmpty(item.description)) ? '保存後每個事項會依合併船舶範圍建立一筆待辦。' : '尚未填寫待辦事項。'}</p>:null}{selectedCompletionSummary?.items.some(item=>!item.task)&&<div className="meeting-linked-tasks meeting-unlinked-decisions">{selectedCompletionSummary.items.filter(item=>!item.task).map((completion,index)=><article key={completion.item.id} className={completion.state==='closed'?'decision-completed':''}><div className="meeting-linked-task-heading"><b>待辦事項 {index+1}</b><span className={`meeting-decision-state state-${completion.state}`}>{completion.state==='closed'?'已完成':completion.state==='open'?'未完成':'關聯待修復'}</span></div><RichTextContent compact value={completion.item.description} fallback="尚未填寫事項內容"/>{completion.state!=='missing'&&completion.state!=='duplicate'&&canCloseTasks&&editable&&selected&&statusOf(selected)!=='已完成'&&<button type="button" className={`btn small ${completion.state==='closed'?'ghost':'green'} meeting-decision-transition`} disabled={lifecycleBusy} onClick={()=>{if(completion.state==='closed'){void transitionUnlinkedDecisionItem(selected,completion.item.id,'reopen');return;}requestDecisionCompletion({kind:'unlinked',meetingId:selected.id,itemId:completion.item.id,label:richTextToPlainText(completion.item.description)||`待辦事項 ${index+1}`});}}>{completion.state==='closed'?'重新開啟此待辦':'完成此待辦'}</button>}{completion.state==='missing'&&<small>此會議已有涉船範圍，但缺少唯一Task關聯，請取得編輯權後保存修復。</small>}{completion.state==='closed'&&selected&&statusOf(selected)==='已完成'&&<small>如需重新開啟此待辦，請先重新開啟會議。</small>}</article>)}</div>}</div>
          <div className="summary-card blue"><h3>待辦同步規則</h3><p>每個已填寫的待辦事項只建立一筆待辦；船舶欄會顯示「全部船舶」或合併船名，船種欄同步顯示全部或涉及類型。</p></div>
        </div>
      </aside>
    </div>}
    {notice && <div className="management-save-toast" role="status" aria-live="polite">{notice}</div>}
  </section>
  {decisionClosureTarget&&<div className="modal-backdrop meeting-decision-date-backdrop" role="presentation">
    <form className="modal meeting-decision-date-modal" role="dialog" aria-modal="true" aria-labelledby="meeting-decision-date-title" onSubmit={event=>{event.preventDefault();void confirmDecisionCompletion();}}>
      <div className="modal-header"><div><h2 id="meeting-decision-date-title">快速結案</h2><p>{decisionClosureTarget.label}</p></div><button type="button" className="btn small ghost" disabled={lifecycleBusy} onClick={()=>setDecisionClosureTarget(null)}>關閉</button></div>
      <div className="field"><label htmlFor="meeting-decision-closure-date">結案日期</label><input autoFocus required id="meeting-decision-closure-date" aria-label="待辦完成日期" type="date" value={decisionClosureDate} onChange={event=>setDecisionClosureDate(event.target.value)}/></div>
      <div className="field"><label htmlFor="meeting-decision-closure-status">結案狀態／結果</label><textarea required id="meeting-decision-closure-status" aria-label="待辦結案狀態" value={decisionClosureStatus} onChange={event=>setDecisionClosureStatus(event.target.value)} placeholder="例如：改善完成並經確認有效"/><small>{decisionClosureTarget.kind==='linked'?'確認後會同步更新正式待辦、狀態歷程、會議及相關清單。':'確認後會寫入此會議待辦及會議狀態歷程。'}</small></div>
      <div className="modal-actions"><button type="button" className="btn ghost" disabled={lifecycleBusy} onClick={()=>setDecisionClosureTarget(null)}>取消</button><button type="submit" className="btn green" disabled={lifecycleBusy||!decisionClosureDate||!decisionClosureStatus.trim()}>確認結案</button></div>
    </form>
  </div>}
  {printMode&&<section className="meeting-print print-only">
    {printMode==='meetings'&&printableMeetings.map(meeting=>{const items=meetingTaskItems(meeting,data.tasks,data.settings.meetingTaskCategories);const completion=meetingDecisionCompletionSummary(meeting,data.tasks);return <article className="meeting-print-page" key={meeting.id}><header><div><span className={`meeting-status status-${statusOf(meeting)}`}>{statusOf(meeting)}</span><h1>{meeting.subject||'臨會／專題會議報告'}</h1><p>匯出時間：{formatTaipeiDateTime(new Date())}｜匯出人：{currentUser.name}</p></div><b>臨會／專題</b></header><div className="meeting-print-meta"><div><small>召開日期</small><b>{meeting.meetingDate||'-'}</b></div><div><small>預計完成</small><b>{meeting.expectedDate||'-'}</b></div><div><small>關注程度</small><b>{meeting.priority}</b></div><div><small>會議範圍</small><b>{meetingScopeLabel(meeting)}</b></div><div><small>涉會船舶</small><b>{meetingVesselIds(meeting).length} 艘</b></div><div><small>決議待辦進度</small><b>{completion.completedCount}/{completion.totalCount}</b></div><div><small>會議追蹤</small><b>{statusOf(meeting)==='已完成'?'已結案':'持續追蹤'}</b></div></div><div className="meeting-print-grid"><section className="meeting-print-section card-like"><h2>會議範圍</h2><p>{meetingPdfVesselSummary(meeting, visibleVessels)}</p></section><section className="meeting-print-section card-like"><h2>涉及部門</h2><p>{meeting.departments.join('、')||'未指定'}</p></section><section className="meeting-print-section card-like"><h2>與會人員</h2><p>{peopleNames(meeting.participantUserIds)}</p></section><section className="meeting-print-section card-like"><h2>追蹤窗口</h2><p>{peopleNames(meeting.trackingUserIds || [])}</p></section><section className="meeting-print-section card-like"><h2>負責人</h2><p>{peopleNames(meeting.responsibleUserIds)}</p></section></div><section className="meeting-print-section card-like wide"><h2>召開緣由</h2><RichTextContent value={meeting.reason} fallback="未填寫"/></section><section className="meeting-print-section card-like wide"><h2>決議／會議結論</h2><RichTextContent value={meeting.resolution} fallback="未填寫"/></section><section className="meeting-print-section card-like wide"><h2>待辦事項</h2>{items.length?<ol className="meeting-print-task-list">{items.map((item,index)=>{const itemCompletion=completion.items.find(entry=>entry.item.id===item.id);return <li key={item.id}><span>待辦 {index+1}｜{itemCompletion?.state==='closed'?'已完成':itemCompletion?.distributed?`分船完成 ${itemCompletion.completedVesselCount}/${itemCompletion.vesselCount}`:itemCompletion?.state==='open'?'未完成':'關聯待修復'}</span><RichTextContent value={item.description} fallback="未填寫"/><small>{normalizeMeetingTaskCategoryList(item.categories,data.settings.meetingTaskCategories).join('、')}｜{item.distributeToVessels?'分派到涉及船舶單船跟蹤':'公司層決議待辦'}</small></li>;})}</ol>:<p>尚無待辦事項</p>}</section><section className="meeting-print-section card-like wide meeting-print-status-history"><h2>狀態歷程</h2>{(meeting.statusLogs||[]).length?(meeting.statusLogs||[]).map(log=><article key={log.id}><b>{log.text}</b><small>{formatTaipeiDateTime(log.at)}｜{log.by}</small></article>):<p>尚無狀態紀錄</p>}</section></article>;})}
    {printMode==='register'&&<article className="meeting-print-register"><header><h1>{printRegisterListMode==='completed'?'臨會／專題已完成清單':'臨會／專題未完成清單'}</h1><p>匯出時間：{formatTaipeiDateTime(new Date())}｜匯出人：{currentUser.name}｜共 {registerPrintMeetings.length} 筆</p></header><table><colgroup><col className="meeting-print-col-date"/><col className="meeting-print-col-status"/><col className="meeting-print-col-subject"/><col className="meeting-print-col-scope"/><col className="meeting-print-col-vessels"/><col className="meeting-print-col-department"/><col className="meeting-print-col-people"/><col className="meeting-print-col-tasks"/><col className="meeting-print-col-deadline"/></colgroup><thead><tr><th>召開日期</th><th>狀態</th><th>會議主題</th><th>會議範圍</th><th>船舶</th><th>部門</th><th>追蹤窗口／負責人</th><th>待辦</th><th>期限</th></tr></thead><tbody>{registerPrintMeetings.map(meeting=>{return <tr key={meeting.id}><td>{meeting.meetingDate||'-'}</td><td>{statusOf(meeting)}</td><td><b>{meeting.subject||'-'}</b><br/>{richTextToPlainText(meeting.reason)||'未填召開緣由'}</td><td>{meetingScopeLabel(meeting)}</td><td>{meetingPdfVesselSummary(meeting, visibleVessels)}</td><td>{meeting.departments.join('、')||'-'}</td><td>追蹤：{peopleNames(meeting.trackingUserIds || [])}<br/>負責：{peopleNames(meeting.responsibleUserIds)}</td><td>{meetingTaskProgressLabel(meeting)}</td><td>{meeting.expectedDate||'-'}</td></tr>;})}</tbody></table></article>}
  </section>}
  </>;
}
