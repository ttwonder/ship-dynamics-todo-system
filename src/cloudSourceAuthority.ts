import { getSupabaseClient, fetchCloudData, type ResolvedSupabaseConfig } from './cloud';
import type { AppData } from './types';
import type { RecordReadScope } from './cloudRecordScopes';

export type BrowserAuthority = Readonly<{workspace:string;managed:boolean;source:'legacy'|'records-v1';epoch:number;pauseState:'unmanaged'|'paused'|'resumed';admitted:boolean}>;
export class BrowserAuthorityError extends Error {
  constructor(code:string){super(code);this.name='BrowserAuthorityError';}
}
export function parseBrowserAuthority(value:unknown, config:ResolvedSupabaseConfig):BrowserAuthority {
  const v=value as Record<string,unknown>|null;
  if(!v||v.workspace!==config.workspaceKey||typeof v.managed!=='boolean'||typeof v.admitted!=='boolean'
    ||!['unmanaged','paused','resumed'].includes(String(v.pauseState))
    ||(v.managed?((v.source!=='legacy'&&v.source!=='records-v1')||!Number.isSafeInteger(v.epoch)||(v.epoch as number)<1||v.pauseState==='unmanaged'):(v.source!==null||v.epoch!==0))
    ||(v.pauseState==='paused'&&v.admitted)||(!v.managed&&v.admitted!==(v.pauseState!=='paused')))
    throw new BrowserAuthorityError('browser-authority-invalid-response');
  const source=v.managed?v.source:config.storageMode??'legacy';
  if(source!=='legacy'&&source!=='records-v1')throw new BrowserAuthorityError('browser-authority-invalid-source');
  return Object.freeze({workspace:config.workspaceKey,managed:v.managed,source,epoch:v.epoch as number,pauseState:v.pauseState as BrowserAuthority['pauseState'],admitted:v.admitted});
}
export const sameAuthority=(a:BrowserAuthority,b:BrowserAuthority)=>a.workspace===b.workspace&&a.managed===b.managed&&a.source===b.source&&a.epoch===b.epoch;
export const authorityFloorIdentity=(identity:string,binding:BrowserAuthority|null)=>binding?.managed?`${identity}|authority:${binding.source}:${binding.epoch}`:identity;
export function authorityConfig(config:ResolvedSupabaseConfig,binding:BrowserAuthority):ResolvedSupabaseConfig {
  if(config.workspaceKey!==binding.workspace)throw new BrowserAuthorityError('browser-authority-workspace-mismatch');
  // A route parameter, never a replacement connection/config/actor identity.
  return {...config,storageMode:binding.source,readMode:binding.managed?(binding.source==='records-v1'?'scoped-v1':'snapshot'):config.readMode};
}
export async function readBrowserAuthority(config:ResolvedSupabaseConfig,signal?:AbortSignal):Promise<BrowserAuthority>{
  const client=getSupabaseClient(config);
  if(!client)throw new BrowserAuthorityError('browser-authority-unavailable');
  let request=client.rpc('read_ship_dynamics_browser_authority_v1',{p_workspace_key:config.workspaceKey});
  if(signal)request=request.abortSignal(signal);
  const {data,error}=await request;signal?.throwIfAborted();
  if(error)throw error; // No missing-RPC/read-error => unmanaged fallback.
  return parseBrowserAuthority(data,config);
}
export async function assertAuthorityAdmission(config:ResolvedSupabaseConfig,binding:BrowserAuthority){
  const latest=await readBrowserAuthority(config);
  if(!sameAuthority(binding,latest)||!latest.admitted)throw new BrowserAuthorityError('browser-authority-not-admitted');
}
export async function readBoundCloudData(config:ResolvedSupabaseConfig,binding:BrowserAuthority,signal?:AbortSignal,confirmed?:AppData,scope:RecordReadScope='full'){
  if(!sameAuthority(binding,await readBrowserAuthority(config,signal)))throw new BrowserAuthorityError('browser-authority-changed');
  const data=await fetchCloudData(authorityConfig(config,binding),signal,confirmed,scope);
  if(!sameAuthority(binding,await readBrowserAuthority(config,signal)))throw new BrowserAuthorityError('browser-authority-changed');
  return data;
}
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)])):v;
export function assertAuthorityBridge(source:AppData,target:AppData){
  const content=({revision:_revision,updatedAt:_at,...rest}:AppData)=>JSON.stringify(canonical(rest));
  // This first slice only adopts an unchanged staged target. Later target writes
  // or uncertain queued snapshots need a separate provenance/recovery contract.
  if(content(source)!==content(target))throw new BrowserAuthorityError('browser-authority-continuity-unproven');
}
