export type MeetingRegisterListMode='unfinished'|'completed';
export type MeetingRegisterSortKey='meetingDate'|'status'|'scope'|'vessels'|'expectedDate';
export type MeetingRegisterSortDirection='asc'|'desc';

export interface MeetingRegisterSortState {
  key:MeetingRegisterSortKey;
  direction:MeetingRegisterSortDirection;
}

export interface MeetingRegisterSortValues {
  id:string;
  meetingDate:string;
  status:string;
  scope:string;
  vesselCount:number;
  vesselLabel:string;
  expectedDate:string;
}

const firstDirection:Record<MeetingRegisterSortKey,MeetingRegisterSortDirection>={
  meetingDate:'desc',
  status:'asc',
  scope:'asc',
  vessels:'asc',
  expectedDate:'asc',
};

const statusOrder:Record<string,number>={待召開:0,追蹤中:1,已完成:2};

export const meetingBelongsToRegisterList=(status:string,mode:MeetingRegisterListMode)=>
  mode==='completed'?status==='已完成':status!=='已完成';

export const nextMeetingRegisterSort=(current:MeetingRegisterSortState|null,key:MeetingRegisterSortKey):MeetingRegisterSortState=>{
  if(current?.key===key)return {key,direction:current.direction==='asc'?'desc':'asc'};
  return {key,direction:firstDirection[key]};
};

export const meetingRegisterAriaSort=(current:MeetingRegisterSortState,key:MeetingRegisterSortKey):'ascending'|'descending'|'none'=>
  current.key===key?(current.direction==='asc'?'ascending':'descending'):'none';

const compareTextWithBlankLast=(left:string,right:string,direction:MeetingRegisterSortDirection)=>{
  if(!left&&!right)return 0;
  if(!left)return 1;
  if(!right)return -1;
  return left.localeCompare(right,'zh-TW')*(direction==='asc'?1:-1);
};

export function sortMeetingRegisterEntries<T>(
  entries:T[],
  sort:MeetingRegisterSortState,
  valuesOf:(entry:T)=>MeetingRegisterSortValues,
):T[]{
  return entries.map((entry,index)=>({entry,index,values:valuesOf(entry)})).sort((left,right)=>{
    const direction=sort.direction==='asc'?1:-1;
    let compared=0;
    if(sort.key==='meetingDate')compared=compareTextWithBlankLast(left.values.meetingDate,right.values.meetingDate,sort.direction);
    if(sort.key==='expectedDate')compared=compareTextWithBlankLast(left.values.expectedDate,right.values.expectedDate,sort.direction);
    if(sort.key==='status'){
      const leftRank=statusOrder[left.values.status]??Number.MAX_SAFE_INTEGER;
      const rightRank=statusOrder[right.values.status]??Number.MAX_SAFE_INTEGER;
      compared=(leftRank-rightRank)*direction||left.values.status.localeCompare(right.values.status,'zh-TW')*direction;
    }
    if(sort.key==='scope')compared=left.values.scope.localeCompare(right.values.scope,'zh-TW')*direction;
    if(sort.key==='vessels')compared=(left.values.vesselCount-right.values.vesselCount)*direction||left.values.vesselLabel.localeCompare(right.values.vesselLabel,'zh-TW')*direction;
    return compared||left.index-right.index;
  }).map(item=>item.entry);
}
