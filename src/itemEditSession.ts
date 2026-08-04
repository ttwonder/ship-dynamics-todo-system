import type { AppData } from './types';

type ResolveItemEditSessionInput<T>={
  live:AppData;
  confirmed:AppData|null;
  remote:AppData;
  select:(snapshot:AppData)=>T|undefined;
  authorize:(snapshot:AppData,entity:T)=>boolean;
  equals:(left:AppData,right:AppData)=>boolean;
};

type ItemEditSessionResult<T>=
  |{status:'ready';snapshot:AppData;entity:T}
  |{status:'local-dirty'|'remote-rollback'|'missing'|'unauthorized'};

export function resolveItemEditSession<T>(input:ResolveItemEditSessionInput<T>):ItemEditSessionResult<T>{
  if(!input.confirmed||!input.equals(input.live,input.confirmed))return{status:'local-dirty'};
  if(input.remote.revision<input.confirmed.revision)return{status:'remote-rollback'};
  const entity=input.select(input.remote);
  if(!entity)return{status:'missing'};
  if(!input.authorize(input.remote,entity))return{status:'unauthorized'};
  return{status:'ready',snapshot:input.remote,entity};
}
