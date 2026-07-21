import type { AppData, UserRole, ShipStatus, TaskPriority } from '../types';
import { localDate } from '../utils';
import { DEFAULT_ROLE_PERMISSIONS } from '../permissions';
import { REQUIRED_MEETING_TASK_CATEGORIES, REQUIRED_TASK_CATEGORIES } from '../taskCategories';

const rawPersonnel = [
  {
    "department": "管理層",
    "name": "呂學修副總"
  },
  {
    "department": "管理層",
    "name": "蔡宏仁協理"
  },
  {
    "department": "管理層",
    "name": "李勻寧協理"
  },
  {
    "department": "管理組",
    "name": "陳治先"
  },
  {
    "department": "管理組",
    "name": "王昱民"
  },
  {
    "department": "管理組",
    "name": "方憲鵬組長"
  },
  {
    "department": "管理組",
    "name": "陳韋自"
  },
  {
    "department": "管理組",
    "name": "紀煒邦"
  },
  {
    "department": "管理組",
    "name": "李雅雯"
  },
  {
    "department": "管理組",
    "name": "曾湘柔"
  },
  {
    "department": "管理組",
    "name": "周麗如"
  },
  {
    "department": "資材組",
    "name": "林建瑋"
  },
  {
    "department": "資材組",
    "name": "鄧兆修"
  },
  {
    "department": "資材組",
    "name": "鄧浚宏"
  },
  {
    "department": "資材組",
    "name": "徐永兆"
  },
  {
    "department": "資材組",
    "name": "王梓名"
  },
  {
    "department": "資材組",
    "name": "林大詠"
  },
  {
    "department": "資材組",
    "name": "周瑞廉組長"
  },
  {
    "department": "資材組",
    "name": "楊延興"
  },
  {
    "department": "資材組",
    "name": "許政子"
  },
  {
    "department": "資材組",
    "name": "楊絜崴"
  },
  {
    "department": "營業處",
    "name": "王慈芬"
  },
  {
    "department": "營業處",
    "name": "劉小萍"
  },
  {
    "department": "營業處",
    "name": "翁敏芳"
  },
  {
    "department": "營業處",
    "name": "李純瑛"
  },
  {
    "department": "營業處",
    "name": "魏利育"
  },
  {
    "department": "營業處",
    "name": "賴思妤"
  },
  {
    "department": "營業處",
    "name": "陳建中"
  },
  {
    "department": "營業處",
    "name": "粘家萍"
  },
  {
    "department": "營業處",
    "name": "邱義泰"
  },
  {
    "department": "營業處",
    "name": "倪嘉"
  },
  {
    "department": "營業處",
    "name": "李耿志"
  },
  {
    "department": "船工處",
    "name": "廖晥妤"
  },
  {
    "department": "船工處",
    "name": "吳燕桂"
  },
  {
    "department": "船工處",
    "name": "楊弘羽"
  },
  {
    "department": "船工處",
    "name": "王威譯"
  },
  {
    "department": "船工處",
    "name": "李曜均"
  },
  {
    "department": "船工處",
    "name": "劉煥章處長"
  },
  {
    "department": "船工處",
    "name": "林冠辰"
  },
  {
    "department": "船工處",
    "name": "盧玉玫"
  },
  {
    "department": "船工處",
    "name": "林儀婷"
  },
  {
    "department": "船工處",
    "name": "王昱斌"
  },
  {
    "department": "船工處",
    "name": "賴朝瑜"
  },
  {
    "department": "船工處",
    "name": "陳思翰"
  },
  {
    "department": "船工處",
    "name": "顏仲楷"
  },
  {
    "department": "安衛處",
    "name": "楊順婷"
  },
  {
    "department": "安衛處",
    "name": "施品帆"
  },
  {
    "department": "安衛處",
    "name": "紀芳琪"
  },
  {
    "department": "安衛處",
    "name": "蘇上銘"
  },
  {
    "department": "安衛處",
    "name": "韓竹雅"
  },
  {
    "department": "安衛處",
    "name": "劉定淮"
  },
  {
    "department": "安衛處",
    "name": "江佳勳"
  },
  {
    "department": "安衛處",
    "name": "張鼎東"
  },
  {
    "department": "航運處",
    "name": "吳建泰處長"
  },
  {
    "department": "航運處",
    "name": "肖紅林處長"
  },
  {
    "department": "督導",
    "name": "尹德垿"
  },
  {
    "department": "督導",
    "name": "蔡繼來"
  },
  {
    "department": "督導",
    "name": "翁振傑"
  },
  {
    "department": "督導",
    "name": "黃傑治"
  },
  {
    "department": "督導",
    "name": "陳寰頤"
  },
  {
    "department": "督導",
    "name": "李幸龍"
  },
  {
    "department": "督導",
    "name": "廖麗蓁"
  },
  {
    "department": "督導",
    "name": "張議榮"
  },
  {
    "department": "督導",
    "name": "林滄龍"
  },
  {
    "department": "督導",
    "name": "蔡明哲"
  },
  {
    "department": "督導",
    "name": "陳昱宏"
  },
  {
    "department": "督導",
    "name": "陳思慧"
  },
  {
    "department": "督導",
    "name": "張雅琪"
  },
  {
    "department": "督導",
    "name": "張和中"
  },
  {
    "department": "督導",
    "name": "張志林"
  },
  {
    "department": "督導",
    "name": "餘雙"
  },
  {
    "department": "督導",
    "name": "唐洪新"
  },
  {
    "department": "督導",
    "name": "秦冰"
  },
  {
    "department": "督導",
    "name": "黃燕華"
  },
  {
    "department": "督導",
    "name": "潘獻波"
  },
  {
    "department": "督導",
    "name": "毛剛"
  },
  {
    "department": "船員組",
    "name": "徐意倫"
  },
  {
    "department": "船員組",
    "name": "古美雪"
  },
  {
    "department": "船員組",
    "name": "薛英林"
  },
  {
    "department": "船員組",
    "name": "張育菁"
  },
  {
    "department": "船員組",
    "name": "謝嘉穎"
  },
  {
    "department": "船員組",
    "name": "王鈺婷"
  },
  {
    "department": "船員組",
    "name": "湯雅帆"
  },
  {
    "department": "船員組",
    "name": "陳必恆"
  },
  {
    "department": "船員組",
    "name": "林竺諼"
  },
  {
    "department": "船員組",
    "name": "鄭詩璇"
  },
  {
    "department": "船員組",
    "name": "陳昱勳"
  },
  {
    "department": "船員組",
    "name": "胡峻瑋"
  },
  {
    "department": "船員組",
    "name": "吳思葦"
  },
  {
    "department": "航運組",
    "name": "陳秀玉"
  },
  {
    "department": "航運組",
    "name": "黃駿達"
  },
  {
    "department": "航運組",
    "name": "江嘉卿"
  },
  {
    "department": "航運組",
    "name": "陳秋縈"
  },
  {
    "department": "航運組",
    "name": "溫雅媛"
  },
  {
    "department": "航運組",
    "name": "王聖傑"
  },
  {
    "department": "航運組",
    "name": "楊治華"
  },
  {
    "department": "航運組",
    "name": "謝侑糖"
  },
  {
    "department": "航運組",
    "name": "劉彥輝"
  },
  {
    "department": "航運組",
    "name": "陳芮蓁"
  },
  {
    "department": "海技組",
    "name": "朱世毅"
  },
  {
    "department": "海技組",
    "name": "陳宜斌"
  },
  {
    "department": "海技組",
    "name": "柯香吟"
  },
  {
    "department": "海技組",
    "name": "陳思樺"
  },
  {
    "department": "海技組",
    "name": "林建志"
  },
  {
    "department": "海技組",
    "name": "張嘉珈"
  },
  {
    "department": "海技組",
    "name": "吳易安"
  }
] as const;

const rawVessels = [
  {
    "shipType": "兩岸油化",
    "name": "安華",
    "shortName": "SA",
    "fullName": "FPMC S AMBER",
    "category": "tanker"
  },
  {
    "shipType": "兩岸油化",
    "name": "康華",
    "shortName": "SE",
    "fullName": "FPMC S EMERALD",
    "category": "tanker"
  },
  {
    "shipType": "兩岸油化",
    "name": "恆華",
    "shortName": "SR",
    "fullName": "FPMC S RUBY",
    "category": "tanker"
  },
  {
    "shipType": "兩岸油化",
    "name": "福華",
    "shortName": "SS",
    "fullName": "FPMC S SAPPHIRE",
    "category": "tanker"
  },
  {
    "shipType": "成品油",
    "name": "F25",
    "shortName": "F25",
    "fullName": "FPMC 25",
    "category": "tanker"
  },
  {
    "shipType": "成品油",
    "name": "F26",
    "shortName": "F26",
    "fullName": "FPMC 26",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F27",
    "shortName": "F27",
    "fullName": "FPMC 27",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F28",
    "shortName": "F28",
    "fullName": "FPMC 28",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F29",
    "shortName": "F29",
    "fullName": "FPMC 29",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F30",
    "shortName": "F30",
    "fullName": "FPMC 30",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F31",
    "shortName": "F31",
    "fullName": "FPMC 31",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F32",
    "shortName": "F32",
    "fullName": "FPMC 32",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F33",
    "shortName": "F33",
    "fullName": "FPMC 33",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F34",
    "shortName": "F34",
    "fullName": "FPMC 34",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F35",
    "shortName": "F35",
    "fullName": "FPMC 35",
    "category": "tanker"
  },
  {
    "shipType": "油化輪",
    "name": "F36",
    "shortName": "F36",
    "fullName": "FPMC 36",
    "category": "tanker"
  },
  {
    "shipType": "輕油輪",
    "name": "英善",
    "shortName": "PH",
    "fullName": "FPMC P HERO",
    "category": "tanker"
  },
  {
    "shipType": "輕油輪",
    "name": "理善",
    "shortName": "PI",
    "fullName": "FPMC P IDEAL",
    "category": "tanker"
  },
  {
    "shipType": "超油",
    "name": "智善",
    "shortName": "CI",
    "fullName": "FPMC C INTELLIGENCE",
    "category": "tanker"
  },
  {
    "shipType": "超油",
    "name": "真善",
    "shortName": "CJ",
    "fullName": "FPMC C JADE",
    "category": "tanker"
  },
  {
    "shipType": "超油",
    "name": "君善",
    "shortName": "CL",
    "fullName": "FPMC C LORD",
    "category": "tanker"
  },
  {
    "shipType": "超油",
    "name": "悅善",
    "shortName": "CM",
    "fullName": "FPMC C MELODY",
    "category": "tanker"
  },
  {
    "shipType": "超油",
    "name": "崇善",
    "shortName": "CN",
    "fullName": "FPMC C NOBLE",
    "category": "tanker"
  },
  {
    "shipType": "超油",
    "name": "亞善",
    "shortName": "CO",
    "fullName": "FPMC C ORIENT",
    "category": "tanker"
  },
  {
    "shipType": "海峽散貨",
    "name": "長輝",
    "shortName": "BF",
    "fullName": "FPMC B FOREVER",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "守輝",
    "shortName": "BG",
    "fullName": "FPMC B GUARD",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "和輝",
    "shortName": "BH",
    "fullName": "FPMC B HARMONY",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "映輝",
    "shortName": "BI",
    "fullName": "FPMC B IMAGE",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "正輝",
    "shortName": "BJ",
    "fullName": "FPMC B JUSTICE",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "皇輝",
    "shortName": "BK",
    "fullName": "FPMC B KINGDOM",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "祥輝",
    "shortName": "BL",
    "fullName": "FPMC B LUCK",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "君輝",
    "shortName": "BM",
    "fullName": "FPMC B MAJESTY",
    "category": "bulk"
  },
  {
    "shipType": "海峽散貨",
    "name": "純輝",
    "shortName": "BN",
    "fullName": "FPMC B NATURE",
    "category": "bulk"
  },
  {
    "shipType": "巴拿馬散",
    "name": "B104",
    "shortName": "B104",
    "fullName": "FPMC B 104",
    "category": "bulk"
  },
  {
    "shipType": "巴拿馬散",
    "name": "B105",
    "shortName": "B105",
    "fullName": "FPMC B 105",
    "category": "bulk"
  },
  {
    "shipType": "巴拿馬散",
    "name": "B106",
    "shortName": "B106",
    "fullName": "FPMC B 106",
    "category": "bulk"
  },
  {
    "shipType": "巴拿馬散",
    "name": "B107",
    "shortName": "B107",
    "fullName": "FPMC B 107",
    "category": "bulk"
  },
  {
    "shipType": "巴拿馬散",
    "name": "B108",
    "shortName": "B108",
    "fullName": "FPMC B 108",
    "category": "bulk"
  },
  {
    "shipType": "靈便型散",
    "name": "B201",
    "shortName": "B201",
    "fullName": "FPMC B 201",
    "category": "bulk"
  },
  {
    "shipType": "靈便型散",
    "name": "B202",
    "shortName": "B202",
    "fullName": "FPMC B 202",
    "category": "bulk"
  }
] as const;

export const DEPARTMENTS = Array.from(new Set(rawPersonnel.map(p => p.department)));
export const TASK_CATEGORIES = [...REQUIRED_TASK_CATEGORIES];
export const MEETING_TASK_CATEGORIES = [...REQUIRED_MEETING_TASK_CATEGORIES];
export const VESSEL_STATUSES: ShipStatus[] = ['loading', 'unloading', 'to load', 'to unload', 'waiting order', 'drydock/repiar'];
export const PRIORITIES: TaskPriority[] = ['急', '高', '中', '低'];

const ports = ['高雄', '麥寮', '新加坡', '仁川', '東京', '上海', '香港', '馬尼拉', '釜山', '杜拜'];

export function createInitialData(): AppData {
  const now = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const nextWeek = localDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  const users = rawPersonnel.map((p, index) => ({
    id: `u${String(index + 1).padStart(3, '0')}`,
    department: p.department,
    name: p.name,
    username: p.name,
    role: 'operator' as UserRole,
    passwordHash: '',
    isActive: true,
    managedVesselIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
  const vessels = rawVessels.map((v, index) => ({
    id: `v${String(index + 1).padStart(3, '0')}`,
    name: v.name,
    shortName: v.shortName,
    fullName: v.fullName,
    shipType: v.shipType,
    fleetCategory: v.category === 'bulk' ? 'bulk fleet' : 'tanker fleet',
    fleetTags: [v.category === 'bulk' ? 'bulk fleet' : 'tanker fleet', v.shipType],
    assignedUserIds: [],
    delegateManagers: [],
    isActive: true,
    position: {
      source: 'mock-smart-ship-api' as const,
      location: ports[index % ports.length],
      speedKnots: Number((10 + (index % 8) + 0.4).toFixed(1)),
      navigationStatus: '航行' as const,
      lastPort: ports[(index + 2) % ports.length],
      nextPort: ports[(index + 4) % ports.length],
      eta: localDate(new Date(Date.now() + (index % 14 + 1) * 24 * 60 * 60 * 1000)),
      etb: '',
      etd: '',
      updatedAt: now.toISOString(),
      manualRemark: '',
    },
    cargo: {
      source: 'mock-smart-ship-api' as const,
      loadStatus: index % 3 === 0 ? '滿載' as const : index % 2 === 0 ? '非空載' as const : '空載' as const,
      name: index % 2 === 0 ? '待確認' : '',
      quantity: index % 2 === 0 ? 'TBA' : '',
      items: index % 2 === 0 ? [{ name: '待確認', quantity: 'TBA' }] : [],
      updatedAt: now.toISOString(),
    },
    note: { statusList: [], recentDynamics: '', subsequentDynamics: '', updatedAt: now.toISOString() },
    weeklyAttention: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }));
  const tasks = vessels.slice(0, 6).map((v, index) => ({
    id: `t${String(index + 1).padStart(3, '0')}`,
    vesselId: v.id,
    priority: (index % 3 === 0 ? '高' : index % 3 === 1 ? '中' : '低') as TaskPriority,
    isAware: index % 2 === 0,
    isAbnormal: index === 0,
    isInternalControl: false,
    sourceType: 'morning' as const,
    category: TASK_CATEGORIES[index % TASK_CATEGORIES.length],
    categories: [TASK_CATEGORIES[index % TASK_CATEGORIES.length]],
    description: `${v.fullName} 早會跟進事項 ${index + 1}`,
    status: '昨日已更新，早會追蹤中',
    expectedDate: nextWeek,
    reportDate: yesterday.slice(0, 10),
    departments: [DEPARTMENTS[index % DEPARTMENTS.length]],
    ownerUserIds: [],
    isClosed: false,
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: yesterday,
    updatedAt: yesterday,
    statusLogs: [{ id: `log${index + 1}`, at: yesterday, by: 'system', text: '建立初始追蹤事項' }],
  }));
  return {
    revision: 1,
    settings: {
      sitePasswordHash: '',
      systemTitle: '船舶動態與會議管理系統',
      departments: [...DEPARTMENTS],
      taskCategories: [...TASK_CATEGORIES],
      taskCategorySchemaVersion: 2,
      meetingTaskCategories: [...MEETING_TASK_CATEGORIES],
      meetingTaskCategorySchemaVersion: 2,
      vesselStatuses: [...VESSEL_STATUSES],
      priorities: [...PRIORITIES],
      rolePermissions: structuredClone(DEFAULT_ROLE_PERMISSIONS),
      nonOwnerPasswordResetVersion: 2,
      lastCloudSyncAt: '',
    },
    users,
    vessels,
    tasks,
    meetings: [],
    agendaReports: [],
    auditLogs: [],
    notifications: [],
    updatedAt: now.toISOString(),
  };
}
